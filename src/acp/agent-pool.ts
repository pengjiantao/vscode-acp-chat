import { ACPClient } from "./client";
import { getAgent, getFirstAvailableAgent, type AgentConfig } from "./agents";

export interface AgentPoolOptions {
  /** Idle timeout in milliseconds before an agent with 0 active sessions is disposed. Defaults to 5 minutes. */
  idleTimeoutMs?: number;
  /** Factory to create ACPClient instances (useful for dependency injection in tests). */
  clientFactory?: (config: AgentConfig) => ACPClient;
  /** Debug logger */
  debugLogger?: (message: string) => void;
}

interface AgentEntry {
  client: ACPClient;
  activeSessions: Set<string>;
  idleTimer: NodeJS.Timeout | null;
  config: AgentConfig;
}

export class AgentPool {
  private readonly entries = new Map<string, AgentEntry>();
  private readonly idleTimeoutMs: number;
  private readonly clientFactory: (config: AgentConfig) => ACPClient;
  private readonly debugLogger: (message: string) => void;
  private isDisposed = false;

  /** Callbacks registered by the chat provider to wire onto newly created clients */
  private clientInitCallbacks: Array<
    (client: ACPClient, agentId: string) => void
  > = [];

  constructor(options?: AgentPoolOptions) {
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 5 * 60 * 1000;
    this.clientFactory =
      options?.clientFactory ??
      ((config) => new ACPClient({ agentConfig: config }));
    this.debugLogger = options?.debugLogger ?? (() => {});
  }

  /**
   * Register a callback to initialize/wire event handlers onto every new ACPClient created.
   */
  onClientCreated(
    callback: (client: ACPClient, agentId: string) => void
  ): () => void {
    this.clientInitCallbacks.push(callback);
    return () => {
      this.clientInitCallbacks = this.clientInitCallbacks.filter(
        (cb) => cb !== callback
      );
    };
  }

  /**
   * Retrieve or create and connect an ACPClient for the specified agent.
   */
  async getClient(agentId: string, cwd: string): Promise<ACPClient> {
    if (this.isDisposed) {
      throw new Error("AgentPool is disposed");
    }

    let entry = this.entries.get(agentId);

    if (entry) {
      // If an idle timer is pending for this agent, cancel it since it is being used
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = null;
        this.debugLogger(
          `[AgentPool] Cancelled idle teardown for agent "${agentId}"`
        );
      }

      if (entry.client.isConnected()) {
        return entry.client;
      }

      // If disconnected/error, attempt reconnection
      try {
        await entry.client.connect(cwd);
        return entry.client;
      } catch (err) {
        this.debugLogger(
          `[AgentPool] Reconnect failed for agent "${agentId}": ${err}`
        );
        // Dispose failed client and recreate
        entry.client.dispose();
        this.entries.delete(agentId);
      }
    }

    // Agent config lookup
    const config = getAgent(agentId) ?? {
      id: agentId,
      name: agentId,
      command: agentId,
      args: ["acp"],
    };

    const client = this.clientFactory(config);
    entry = {
      client,
      activeSessions: new Set<string>(),
      idleTimer: null,
      config,
    };
    this.entries.set(agentId, entry);

    // Notify listeners to wire handlers before connecting
    for (const callback of this.clientInitCallbacks) {
      try {
        callback(client, agentId);
      } catch (error) {
        console.error(
          `[AgentPool] Error in client creation callback for "${agentId}":`,
          error
        );
      }
    }

    await client.connect(cwd);
    return client;
  }

  /**
   * Get an existing client without creating a new one if not present.
   */
  getExistingClient(agentId: string): ACPClient | undefined {
    return this.entries.get(agentId)?.client;
  }

  /**
   * Get an existing client for an agent or create a default instance.
   */
  getDefaultClient(agentId?: string): ACPClient {
    const id = agentId || getFirstAvailableAgent().id;
    let entry = this.entries.get(id);
    if (!entry) {
      const config = getAgent(id) ?? {
        id,
        name: id,
        command: id,
        args: ["acp"],
      };
      const client = this.clientFactory(config);
      entry = {
        client,
        activeSessions: new Set<string>(),
        idleTimer: null,
        config,
      };
      this.entries.set(id, entry);
      for (const callback of this.clientInitCallbacks) {
        try {
          callback(client, id);
        } catch (err) {
          this.debugLogger(`[AgentPool] Error initializing client: ${err}`);
        }
      }
    }
    return entry.client;
  }

  /**
   * Return the number of currently active agents in the pool.
   */
  getActiveAgentCount(): number {
    return this.entries.size;
  }

  /**
   * Register an active session for an agent.
   */
  registerSession(agentId: string, sessionId: string): void {
    const entry = this.entries.get(agentId);
    if (entry) {
      entry.activeSessions.add(sessionId);
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = null;
        this.debugLogger(
          `[AgentPool] Active session added to "${agentId}", cancelled idle timer`
        );
      }
    }
  }

  /**
   * Unregister a session for an agent (e.g. when closed in frontend).
   * If the agent has 0 active sessions, schedule automatic disposal.
   */
  unregisterSession(agentId: string, sessionId: string): void {
    const entry = this.entries.get(agentId);
    if (!entry) return;

    entry.activeSessions.delete(sessionId);
    this.debugLogger(
      `[AgentPool] Session "${sessionId}" unregistered from agent "${agentId}". Remaining sessions: ${entry.activeSessions.size}`
    );

    if (entry.activeSessions.size === 0) {
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
      }

      this.debugLogger(
        `[AgentPool] Agent "${agentId}" has 0 active sessions. Scheduling idle teardown in ${this.idleTimeoutMs}ms`
      );

      entry.idleTimer = setTimeout(() => {
        this.disposeAgent(agentId);
      }, this.idleTimeoutMs);
    }
  }

  /**
   * Cancel in-progress generation for a session.
   */
  async cancelSession(agentId: string, sessionId: string): Promise<void> {
    const entry = this.entries.get(agentId);
    if (entry && entry.client.isConnected()) {
      try {
        await entry.client.cancel(sessionId);
      } catch (err) {
        console.warn(
          `[AgentPool] Failed to cancel session "${sessionId}" on agent "${agentId}":`,
          err
        );
      }
    }
  }

  /**
   * Close a session on the agent if supported.
   */
  async closeSession(agentId: string, sessionId: string): Promise<void> {
    const entry = this.entries.get(agentId);
    if (entry && entry.client.isConnected()) {
      const caps = entry.client.getAgentCapabilities();
      if (caps?.sessionCapabilities?.close) {
        try {
          await entry.client.closeSession({ sessionId });
        } catch (err) {
          console.warn(
            `[AgentPool] Failed to close session "${sessionId}" on agent "${agentId}":`,
            err
          );
        }
      }
    }
  }

  /**
   * Return all currently connected ACPClient instances (e.g. for DocumentSync broadcasting).
   */
  getActiveClients(): ACPClient[] {
    const result: ACPClient[] = [];
    for (const entry of this.entries.values()) {
      if (entry.client.isConnected()) {
        result.push(entry.client);
      }
    }
    return result;
  }

  /**
   * Get the list of all registered agent IDs.
   */
  getConnectedAgentIds(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Dispose a single agent immediately.
   */
  disposeAgent(agentId: string): void {
    const entry = this.entries.get(agentId);
    if (!entry) return;

    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }

    this.debugLogger(
      `[AgentPool] Disposing idle agent "${agentId}" to reclaim memory.`
    );
    entry.client.dispose();
    this.entries.delete(agentId);
  }

  /**
   * Dispose all agents and clear timers.
   */
  dispose(): void {
    this.isDisposed = true;
    for (const entry of this.entries.values()) {
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
      }
      entry.client.dispose();
    }
    this.entries.clear();
    this.clientInitCallbacks = [];
  }
}
