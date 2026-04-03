/**
 * Session management abstraction for VSCode ACP.
 *
 * Provides a pluggable architecture for session history:
 *   - `SessionInfo`: common metadata for a session entry
 *   - `SessionManager`: abstract base class defining the contract
 *   - `AgentSessionManager`: concrete implementation that delegates to the ACP agent
 *   - Future: `LocalSessionManager`, `HybridSessionManager`, etc.
 */

import type {
  LoadSessionResponse,
  ListSessionsResponse,
} from "@agentclientprotocol/sdk";

/**
 * Minimal interface for an ACP client, used by AgentSessionManager.
 * This avoids a circular dependency with the full ACPClient class.
 */
export interface IACPClient {
  getAgentCapabilities(): { loadSession?: boolean } | null;
  isConnected(): boolean;
  loadSession(params: {
    sessionId: string;
    cwd: string;
  }): Promise<LoadSessionResponse>;
  listSessions(params?: {
    cwd?: string;
    cursor?: string;
  }): Promise<ListSessionsResponse>;
}

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

/** Result of loading a session. */
export interface LoadSessionResult {
  /** The loaded session's ID. */
  sessionId: string;
  /** Whether the agent advertised `loadSession` support. */
  supportedByAgent: boolean;
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
   * Whether this manager can actually load sessions (agent advertises the
   * `loadSession` capability). When `false`, `loadSession()` may still be
   * called but is expected to fail or fall back.
   */
  abstract get supportsLoadSession(): boolean;
}

// ---------------------------------------------------------------------------
// Agent-backed implementation
// ---------------------------------------------------------------------------

/**
 * Manages sessions via the ACP agent's native `session/load` method.
 *
 * Lifecycle:
 *   1. `connect()` is called on the ACPClient (once per agent switch / startup)
 *   2. During `initialize`, the agent reports `agentCapabilities.loadSession`
 *   3. This class reads that flag and gates `listSessions` / `loadSession`
 *
 * If the agent does **not** advertise `loadSession`, `listSessions()` returns
 * `[]` and `supportsLoadSession` is `false` – the UI can hide or disable the
 * "Load History" button accordingly.
 */
export class AgentSessionManager extends SessionManager {
  readonly kind = "agent";

  private _supportsLoadSession = false;
  private _initialized = false;

  constructor(private readonly acpClient: IACPClient) {
    super();
  }

  /** Call after `acpClient.connect()` to read the agent capabilities. */
  syncCapabilities(): void {
    const caps = this.acpClient.getAgentCapabilities();
    this._supportsLoadSession = caps?.loadSession ?? false;
    this._initialized = true;
  }

  get supportsLoadSession(): boolean {
    return this._supportsLoadSession;
  }

  /**
   * List sessions from the agent via `session/list` (unstable ACP method).
   *
   * If the agent doesn't advertise the `listSessions` capability, or the
   * call fails, this returns an empty array.
   */
  async listSessions(cwd: string): Promise<SessionInfo[]> {
    if (!this._initialized) {
      throw new Error(
        "AgentSessionManager not yet synced – call syncCapabilities() first"
      );
    }

    try {
      const response = await this.acpClient.listSessions({ cwd });

      return response.sessions.map((s) => ({
        sessionId: s.sessionId,
        title: s.title ?? `Session ${s.sessionId}`,
        cwd: s.cwd ?? cwd,
        updatedAt: s.updatedAt ?? new Date().toISOString(),
        meta: s._meta ?? undefined,
      }));
    } catch (error) {
      // Agent doesn't support listSessions or call failed – return empty
      console.warn(
        "[SessionManager] Failed to list sessions from agent:",
        error
      );
      return [];
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
}
