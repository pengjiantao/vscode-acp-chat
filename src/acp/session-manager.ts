/**
 * Session management abstraction for VSCode ACP.
 *
 * Provides a pluggable architecture for session history:
 *   - `SessionInfo`: common metadata for a session entry
 *   - `SessionManager`: abstract base class defining the contract
 *   - `AgentSessionManager`: concrete implementation that delegates to the ACP agent
 *     and persists a local cache of sessions for agents that do not support
 *     the `session/list` capability.
 *   - Future: `LocalSessionManager`, `HybridSessionManager`, etc.
 */

import * as vscode from "vscode";
import type {
  NewSessionResponse,
  ListSessionsResponse,
  SessionNotification,
  SessionInfoUpdate,
} from "@agentclientprotocol/sdk";
import { ACPClient } from "./client";

// ---------------------------------------------------------------------------
// Common types
// ---------------------------------------------------------------------------

/** Lightweight descriptor for a single session, suitable for QuickPick display. */
export interface SessionInfo {
  /** Unique session identifier (used by the agent / protocol). */
  sessionId: string;
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
 *
 * This allows sessions recorded for different agents to be isolated from
 * each other while keeping `AgentSessionManager` agnostic of VS Code APIs.
 */
export type SessionStoreFactory = (agentId: string) => SessionStore;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * In-memory `SessionStore`. Data is lost when the extension host exits.
 * Useful when `enablePersistentSessions` is `false`.
 */
export function inMemorySessionStore(): SessionStore {
  const sessions = new Map<string, StoredSessionRecord>();
  return {
    async read() {
      return Array.from(sessions.values());
    },
    async readOne(sessionId: string) {
      return sessions.get(sessionId);
    },
    async writeOne(session: StoredSessionRecord) {
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
  cleanupOptions?: SessionCleanupOptions
): SessionStore {
  const cache = new Map<string, StoredSessionRecord>();
  const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
  const WRITE_DEBOUNCE_MS = 1000;
  let loaded = false;

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
      if (record) cache.set(record.sessionId, record);
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
        if (record) cache.set(sessionId, record);
      }
      return record;
    },

    async writeOne(session: StoredSessionRecord): Promise<void> {
      ensureLoaded();
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
// Abstract base class
// ---------------------------------------------------------------------------

/**
 * Contract that every concrete session manager must fulfil.
 *
 * Design goals:
 *   - Decouple session storage / retrieval from the rest of the extension
 *   - Allow future implementations (local cache, cloud sync, …) without
 *     touching ChatViewProvider or extension.ts
 *   - Graceful degradation: when the agent doesn't support `loadSession`,
 *     `listSessions()` simply returns an empty array.
 */
export abstract class SessionManager {
  /** Human-readable name of this implementation (shown in debug / diagnostics). */
  abstract readonly kind: string;

  /**
   * Return all discoverable sessions for the current agent + working directory.
   *
   * Sorted newest-first so the QuickPick shows the most recent session at the top.
   */
  abstract listSessions(cwd: string): Promise<SessionInfo[]>;

  /**
   * Load (resume) an existing session.
   *
   * The agent is expected to stream the full conversation history back via
   * `session/notification` messages. The caller's existing
   * `handleSessionUpdate` pipeline should render these without changes.
   */
  abstract loadSession(
    sessionId: string,
    cwd: string
  ): Promise<LoadSessionResult>;

  /**
   * Create a new session via the agent and record it in the local cache.
   *
   * This is the single entry-point for session creation. The manager
   * delegates to the ACP client and then persists the session locally so it
   * can be listed later even when the agent does not support `session/list`.
   */
  abstract newSession(workingDirectory: string): Promise<NewSessionResponse>;

  /**
   * Whether this manager can actually load sessions (agent advertises the
   * `loadSession` capability). When `false`, `loadSession()` may still be
   * called but is expected to fail or fall back.
   */
  abstract get supportsLoadSession(): boolean;

  /**
   * Whether this manager can list discoverable sessions (agent advertises the
   * `sessionCapabilities.list` capability). When `false`, `listSessions()` may
   * still be called but is expected to fall back to locally stored records.
   */
  abstract get supportsListSessions(): boolean;

  /**
   * Whether this manager can delete sessions (agent advertises the
   * `sessionCapabilities.delete` capability). When `false`, `deleteSession()`
   * should still remove the session from the local cache but cannot ask the
   * agent to delete it server-side.
   */
  abstract get supportsDeleteSession(): boolean;

  /**
   * Delete an existing session.
   *
   * If the agent advertises `sessionCapabilities.delete`, the request is
   * forwarded to the agent via `session/delete`. The session is also removed
   * from the local cache regardless.
   */
  abstract deleteSession(sessionId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Agent-backed implementation
// ---------------------------------------------------------------------------

/**
 * Manages sessions via the ACP agent's native session methods.
 *
 * Lifecycle:
 *   1. `connect()` is called on the ACPClient (once per agent switch / startup)
 *   2. During `initialize`, the agent reports `agentCapabilities`
 *   3. This class reads `loadSession` and `sessionCapabilities.list` and
 *      gates `loadSession` / `listSessions` accordingly.
 *
 * If the agent does **not** advertise `loadSession`, `supportsLoadSession` is
 * `false` and the UI can hide or disable loading of history sessions.
 * If the agent does **not** advertise `sessionCapabilities.list`,
 * `supportsListSessions` is `false` and `listSessions()` falls back to the
 * local session cache stored in `globalState`.
 */
export class AgentSessionManager extends SessionManager {
  readonly kind = "agent";

  private _supportsLoadSession = false;
  private _supportsListSessions = false;
  private _supportsDeleteSession = false;
  private _initialized = false;
  private readonly _stores = new Map<string, SessionStore>();

  constructor(
    private readonly acpClient: ACPClient,
    private readonly storeFactory: SessionStoreFactory
  ) {
    super();
  }

  private getStore(): SessionStore {
    const agentId = this.acpClient.getAgentId();
    let store = this._stores.get(agentId);
    if (!store) {
      store = this.storeFactory(agentId);
      this._stores.set(agentId, store);
    }
    return store;
  }

  private _unsubscribeSessionUpdate: (() => void) | null = null;

  /** Call after `acpClient.connect()` to read the agent capabilities. */
  syncCapabilities(): void {
    const caps = this.acpClient.getAgentCapabilities();
    this._supportsLoadSession = caps?.loadSession ?? false;
    this._supportsListSessions = !!caps?.sessionCapabilities?.list;
    this._supportsDeleteSession = !!caps?.sessionCapabilities?.delete;
    this._initialized = true;

    this._unsubscribeSessionUpdate?.();
    this._unsubscribeSessionUpdate = this.acpClient.setOnSessionUpdate(
      async (notification: SessionNotification) => {
        if (notification.update.sessionUpdate === "session_info_update") {
          const sessionId =
            notification.sessionId ?? this.acpClient.getCurrentSessionId();
          if (sessionId) {
            await this.applySessionInfoUpdate(
              notification.update as SessionInfoUpdate,
              sessionId
            );
          }
        }
      }
    );
  }

  get supportsLoadSession(): boolean {
    return this._supportsLoadSession;
  }

  get supportsListSessions(): boolean {
    return this._supportsListSessions;
  }

  get supportsDeleteSession(): boolean {
    return this._supportsDeleteSession;
  }

  /**
   * Create a new session via the agent and record it in the local cache.
   */
  async newSession(workingDirectory: string): Promise<NewSessionResponse> {
    const response = await this.acpClient.newSession(workingDirectory);
    await this.recordSession(response.sessionId, workingDirectory);
    return response;
  }

  /**
   * Record a session in the local cache.
   */
  private async recordSession(
    sessionId: string,
    cwd: string,
    title?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const store = this.getStore();
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
        title: title ?? `Session ${sessionId}`,
        cwd,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /**
   * Apply a `session_info_update` notification to the local cache.
   */
  private async applySessionInfoUpdate(
    update: SessionInfoUpdate,
    sessionId: string
  ): Promise<void> {
    const store = this.getStore();
    const session = await store.readOne(sessionId);

    if (!session) {
      return;
    }

    if (update.title !== undefined) {
      session.title = update.title ?? session.title;
    }
    if (update.updatedAt !== undefined) {
      session.updatedAt = update.updatedAt ?? session.updatedAt;
    }

    await store.writeOne(session);
  }

  /**
   * List sessions for the given working directory.
   *
   * The agent result is queried (and returned directly, without writing back
   * to the local cache) only when the agent advertises `sessionCapabilities.list`
   * **and** the `useAgentSessionList` setting is enabled. Otherwise, the local
   * cache is filtered by `cwd` and returned as a fallback.
   */
  async listSessions(cwd: string): Promise<SessionInfo[]> {
    if (!this._initialized) {
      throw new Error(
        "AgentSessionManager not yet synced – call syncCapabilities() first"
      );
    }

    const useAgentList = vscode.workspace
      .getConfiguration("vscode-acp-chat")
      .get<boolean>("useAgentSessionList", true);

    if (!this._supportsListSessions || !useAgentList) {
      if (useAgentList) {
        // Agent doesn't advertise session/list – unexpected fallback
        console.warn(
          "[SessionManager] Agent does not support session/list; falling back to local cache"
        );
      } else {
        // User opted out via useAgentSessionList – expected behavior
        console.log(
          "[SessionManager] useAgentSessionList is disabled; using local session cache"
        );
      }
      return this.listLocalSessions(cwd);
    }

    try {
      const response = await this.acpClient.listSessions({ cwd });
      return this.mapAgentSessions(response, cwd);
    } catch (error) {
      // Agent call failed – fall back to local cache
      console.warn(
        "[SessionManager] Failed to list sessions from agent; falling back to local cache:",
        error
      );
      return this.listLocalSessions(cwd);
    }
  }

  /**
   * Load a session via the ACP `session/load` method.
   *
   * The agent will stream the full conversation history back as
   * `session/notification` messages, which the existing
   * `handleSessionUpdate` pipeline in ChatViewProvider already handles.
   *
   * @throws If the agent doesn't support `loadSession` or isn't connected.
   */
  async loadSession(
    sessionId: string,
    cwd: string
  ): Promise<LoadSessionResult> {
    if (!this._supportsLoadSession) {
      throw new Error(
        "Current agent does not support the `loadSession` capability"
      );
    }

    await this.acpClient.loadSession({ sessionId, cwd });

    return {
      sessionId,
      supportedByAgent: true,
    };
  }

  /**
   * Delete an existing session via the ACP `session/delete` method.
   *
   * @throws If the agent doesn't support `sessionCapabilities.delete`.
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (!this._supportsDeleteSession) {
      throw new Error(
        "Current agent does not support the `session/delete` capability"
      );
    }

    // Delete server-side first; if the agent call succeeds but the local
    // store write fails, re-listing from the agent would reconcile.
    await this.acpClient.deleteSession({ sessionId });

    const store = this.getStore();
    await store.deleteOne(sessionId);
  }

  /**
   * Map agent-returned sessions to `SessionInfo` without touching the local
   * cache.
   *
   * Per the ACP spec, the agent is responsible for filtering by `cwd` in
   * `session/list`, so agent-returned sessions are trusted as-is. Re-filtering
   * here with a case-sensitive path comparison broke agents on Windows (and
   * other case-insensitive filesystems) that returned cwd paths in a different
   * case than the client's requested path.
   */
  private mapAgentSessions(
    response: ListSessionsResponse,
    cwd: string
  ): SessionInfo[] {
    return response.sessions
      .sort(
        (a, b) =>
          new Date(b.updatedAt ?? 0).getTime() -
          new Date(a.updatedAt ?? 0).getTime()
      )
      .map((s) => ({
        sessionId: s.sessionId,
        title: s.title ?? `Session ${s.sessionId}`,
        cwd: s.cwd ?? cwd,
        updatedAt: s.updatedAt ?? new Date().toISOString(),
      }));
  }

  /**
   * Filter and sort the local session cache by `cwd`.
   *
   * Sorted newest-first by `updatedAt`.
   */
  private async listLocalSessions(cwd: string): Promise<SessionInfo[]> {
    const store = this.getStore();
    const sessions = await store.read();

    return sessions
      .filter((s) => s.cwd === cwd)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      .map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        cwd: s.cwd,
        updatedAt: s.updatedAt,
      }));
  }
}
