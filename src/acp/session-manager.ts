/**
 * Session management abstraction for VSCode ACP.
 *
 * Provides session history and persistence across agents:
 *   - `SessionInfo`: common metadata for a session entry
 *   - `StoredSessionRecord`: locally persisted session data
 *   - `LocalSessionManager`: concrete implementation managing local session history across agents
 */

import * as vscode from "vscode";
import type { SessionInfoUpdate } from "@agentclientprotocol/sdk";

// ---------------------------------------------------------------------------
// Common types
// ---------------------------------------------------------------------------

/** Lightweight descriptor for a single session, suitable for QuickPick display. */
export interface SessionInfo {
  /** Unique session identifier (used by the agent / protocol). */
  sessionId: string;
  /** Agent identifier that owns this session. */
  agentId: string;
  /** Human-readable agent display name. */
  agentName?: string;
  /** Human-readable title – may be generated from the first message or provided by the agent. */
  title: string;
  /** Working directory the session was created in. */
  cwd: string;
  /** ISO-8601 timestamp of the last activity. */
  updatedAt: string;
  /** Optional extra metadata that a concrete manager may attach. */
  meta?: Record<string, unknown>;
}

/** A locally persisted session record. */
export interface StoredSessionRecord {
  sessionId: string;
  agentId: string;
  title: string;
  cwd: string;
  /** ISO-8601 timestamp of when the session was first recorded locally. */
  createdAt: string;
  /** ISO-8601 timestamp of the last recorded activity. */
  updatedAt: string;
}

/** Result of loading a session. */
export interface LoadSessionResult {
  /** The loaded session's ID. */
  sessionId: string;
  /** Whether the agent advertised `loadSession` support. */
  supportedByAgent: boolean;
}

/** Options controlling automatic session cleanup. */
export interface SessionCleanupOptions {
  /** Remove sessions whose `updatedAt` is older than this many days. */
  retentionDays: number;
  /** Maximum number of sessions to keep per agent (keeps newest). */
  maxSessions: number;
}

/** Pluggable storage for local session records. */
export interface SessionStore {
  /** Read all sessions from the store. */
  read(): Promise<StoredSessionRecord[]>;
  /** Read a single session by ID, or undefined if not found. */
  readOne(sessionId: string): Promise<StoredSessionRecord | undefined>;
  /** Write or update a single session. */
  writeOne(session: StoredSessionRecord): Promise<void>;
  /** Delete a single session by ID. */
  deleteOne(sessionId: string): Promise<void>;
}

/**
 * Factory that creates a per-agent `SessionStore`.
 */
export type SessionStoreFactory = (agentId: string) => SessionStore;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * In-memory `SessionStore`. Data is lost when the extension host exits.
 */
export function inMemorySessionStore(defaultAgentId = "default"): SessionStore {
  const sessions = new Map<string, StoredSessionRecord>();
  return {
    async read() {
      return Array.from(sessions.values());
    },
    async readOne(sessionId: string) {
      return sessions.get(sessionId);
    },
    async writeOne(session: StoredSessionRecord) {
      if (!session.agentId) {
        session.agentId = defaultAgentId;
      }
      sessions.set(session.sessionId, session);
    },
    async deleteOne(sessionId: string) {
      sessions.delete(sessionId);
    },
  };
}

/**
 * Create a `SessionStore` backed by VS Code's `globalState` Memento.
 *
 * Each session is stored under a separate key (`<prefix>.<sessionId>`) with an
 * in-memory cache and debounced writes for high-frequency updates.
 */
export function globalStateSessionStore(
  globalState: vscode.Memento,
  prefix: string,
  cleanupOptions?: SessionCleanupOptions,
  inferredAgentId?: string
): SessionStore {
  const cache = new Map<string, StoredSessionRecord>();
  const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
  const WRITE_DEBOUNCE_MS = 1000;
  let loaded = false;

  // Infer agent ID from prefix if not provided (e.g. "vscode-acp-chat.localSessions.v1.opencode" -> "opencode")
  const agentIdFromPrefix =
    inferredAgentId ?? prefix.split(".").pop() ?? "default";

  function scheduleFlush(sessionId: string): void {
    const existing = pendingWrites.get(sessionId);
    if (existing) clearTimeout(existing);
    pendingWrites.set(
      sessionId,
      setTimeout(() => {
        pendingWrites.delete(sessionId);
        const record = cache.get(sessionId);
        if (record) {
          globalState.update(`${prefix}.${sessionId}`, record);
        }
      }, WRITE_DEBOUNCE_MS)
    );
  }

  async function cleanup(options: SessionCleanupOptions): Promise<void> {
    const now = Date.now();
    const cutoffMs = options.retentionDays * 24 * 60 * 60 * 1000;
    let sessions = Array.from(cache.values());

    // 1. Remove sessions older than retentionDays
    for (const s of sessions) {
      if (now - new Date(s.updatedAt).getTime() > cutoffMs) {
        cache.delete(s.sessionId);
        globalState.update(`${prefix}.${s.sessionId}`, undefined);
      }
    }

    // 2. Re-read after expired removal, then enforce maxSessions limit (keep newest)
    sessions = Array.from(cache.values());
    if (sessions.length > options.maxSessions) {
      sessions.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      for (const s of sessions.slice(options.maxSessions)) {
        cache.delete(s.sessionId);
        globalState.update(`${prefix}.${s.sessionId}`, undefined);
      }
    }
  }

  function ensureLoaded(): void {
    if (loaded) return;
    loaded = true;
    const keys = globalState.keys().filter((k) => k.startsWith(`${prefix}.`));
    for (const key of keys) {
      const record = globalState.get<StoredSessionRecord>(key);
      if (record) {
        if (!record.agentId) {
          record.agentId = agentIdFromPrefix;
        }
        cache.set(record.sessionId, record);
      }
    }
    if (cleanupOptions) {
      cleanup(cleanupOptions).catch((err) =>
        console.warn("[SessionStore] Cleanup failed:", err)
      );
    }
  }

  return {
    async read(): Promise<StoredSessionRecord[]> {
      ensureLoaded();
      return Array.from(cache.values());
    },

    async readOne(sessionId: string): Promise<StoredSessionRecord | undefined> {
      ensureLoaded();
      let record = cache.get(sessionId);
      if (!record) {
        record = globalState.get<StoredSessionRecord>(`${prefix}.${sessionId}`);
        if (record) {
          if (!record.agentId) {
            record.agentId = agentIdFromPrefix;
          }
          cache.set(sessionId, record);
        }
      }
      return record;
    },

    async writeOne(session: StoredSessionRecord): Promise<void> {
      ensureLoaded();
      if (!session.agentId) {
        session.agentId = agentIdFromPrefix;
      }
      cache.set(session.sessionId, session);
      scheduleFlush(session.sessionId);
    },

    async deleteOne(sessionId: string): Promise<void> {
      ensureLoaded();
      cache.delete(sessionId);
      const existing = pendingWrites.get(sessionId);
      if (existing) clearTimeout(existing);
      pendingWrites.delete(sessionId);
      globalState.update(`${prefix}.${sessionId}`, undefined);
    },
  };
}

// ---------------------------------------------------------------------------
// Local-only Multi-Agent Session Manager
/**
 * Local session history manager for VSCode ACP.
 *
 * Manages persisted and in-memory session metadata across multiple agents,
 * workspaces, and local session stores with automatic timestamp sorting and
 * key-based indexing.
 */
export class LocalSessionManager {
  private readonly stores = new Map<string, SessionStore>();

  constructor(
    private readonly storeFactory: SessionStoreFactory,
    private readonly globalState?: vscode.Memento
  ) {}

  /**
   * Retrieves or creates the session store for a specific agent.
   */
  getStore(agentId: string): SessionStore {
    let store = this.stores.get(agentId);
    if (!store) {
      store = this.storeFactory(agentId);
      this.stores.set(agentId, store);
    }
    return store;
  }

  /**
   * Records or updates a session record in the agent's store.
   */
  async recordSession(
    agentId: string,
    sessionId: string,
    cwd: string,
    title?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const store = this.getStore(agentId);
    const existing = await store.readOne(sessionId);

    if (existing) {
      existing.cwd = cwd;
      existing.updatedAt = now;
      if (title !== undefined) {
        existing.title = title;
      }
      await store.writeOne(existing);
    } else {
      await store.writeOne({
        sessionId,
        agentId,
        title: title ?? `Session ${sessionId}`,
        cwd,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /**
   * Applies an asynchronous session info update notification (e.g. title change) from an agent.
   */
  async applySessionInfoUpdate(
    agentId: string,
    sessionId: string,
    update: SessionInfoUpdate
  ): Promise<void> {
    const store = this.getStore(agentId);
    const session = await store.readOne(sessionId);
    if (!session) return;

    if (update.title !== undefined) {
      session.title = update.title ?? session.title;
    }
    if (update.updatedAt !== undefined) {
      session.updatedAt = update.updatedAt ?? session.updatedAt;
    }

    await store.writeOne(session);
  }

  /**
   * Lists stored sessions for a specific agent, optionally filtered by working directory.
   */
  async listSessions(agentId: string, cwd?: string): Promise<SessionInfo[]> {
    const store = this.getStore(agentId);
    const sessions = await store.read();
    return sessions
      .filter((s) => !cwd || s.cwd === cwd)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      .map((s) => ({
        sessionId: s.sessionId,
        agentId: s.agentId || agentId,
        title: s.title,
        cwd: s.cwd,
        updatedAt: s.updatedAt,
      }));
  }

  /**
   * Lists all stored sessions across all agents in the workspace.
   *
   * Utilizes a robust two-phase retrieval strategy:
   * 1. Phase 1 (Persistent Scan): When `globalState` is available, scans all keys
   *    matching `vscode-acp-chat.localSessions.v1.*` to retrieve sessions across all
   *    configured agents (including agents that have not yet been instantiated in this session).
   * 2. Phase 2 (Active Store Scan): Queries all active/in-memory `stores` to capture
   *    un-flushed debounced writes or memory-only sessions (when persistent storage is disabled).
   * 3. Deduplication & Ordering: Deduplicates records by `sessionId` and sorts descending by `updatedAt`.
   */
  async listAllSessions(cwd?: string): Promise<SessionInfo[]> {
    const allSessions: SessionInfo[] = [];
    const seenSessionIds = new Set<string>();

    // Phase 1: If globalState is available, scan all agent session keys directly
    if (this.globalState) {
      const prefixRoot = "vscode-acp-chat.localSessions.v1.";
      const keys = this.globalState
        .keys()
        .filter((k) => k.startsWith(prefixRoot));

      for (const key of keys) {
        const record = this.globalState.get<StoredSessionRecord>(key);
        if (record && !seenSessionIds.has(record.sessionId)) {
          if (!cwd || record.cwd === cwd) {
            seenSessionIds.add(record.sessionId);
            // Infer agentId from key if record lacks it
            const parts = key.substring(prefixRoot.length).split(".");
            const agentId = record.agentId || parts[0] || "default";
            allSessions.push({
              sessionId: record.sessionId,
              agentId,
              title: record.title,
              cwd: record.cwd,
              updatedAt: record.updatedAt,
            });
          }
        }
      }
    }

    // Phase 2: Also read from all instantiated stores in memory
    for (const [agentId, store] of this.stores.entries()) {
      const records = await store.read();
      for (const record of records) {
        if (!seenSessionIds.has(record.sessionId)) {
          if (!cwd || record.cwd === cwd) {
            seenSessionIds.add(record.sessionId);
            allSessions.push({
              sessionId: record.sessionId,
              agentId: record.agentId || agentId,
              title: record.title,
              cwd: record.cwd,
              updatedAt: record.updatedAt,
            });
          }
        }
      }
    }

    return allSessions.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Finds a session record across active stores or persistent storage.
   */
  async findSession(
    sessionId: string
  ): Promise<StoredSessionRecord | undefined> {
    for (const store of this.stores.values()) {
      const record = await store.readOne(sessionId);
      if (record) return record;
    }

    if (this.globalState) {
      const prefixRoot = "vscode-acp-chat.localSessions.v1.";
      const keys = this.globalState
        .keys()
        .filter((k) => k.startsWith(prefixRoot) && k.endsWith(`.${sessionId}`));
      for (const key of keys) {
        const record = this.globalState.get<StoredSessionRecord>(key);
        if (record) {
          if (!record.agentId) {
            const parts = key.substring(prefixRoot.length).split(".");
            record.agentId = parts[0] || "default";
          }
          return record;
        }
      }
    }
    return undefined;
  }

  /**
   * Deletes a session record from the agent's store.
   */
  async deleteSession(agentId: string, sessionId: string): Promise<void> {
    const store = this.getStore(agentId);
    await store.deleteOne(sessionId);
  }

  get supportsLoadSession(): boolean {
    return true;
  }

  get supportsDeleteSession(): boolean {
    return true;
  }
}
