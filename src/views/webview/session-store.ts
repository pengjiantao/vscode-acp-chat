import type {
  AvailableCommand,
  ContextUsageUpdate,
  ExtensionMessage,
  GenericConfigOption,
  PlanEntry,
  SessionModeState,
  SessionModelState,
  SessionTab,
} from "./types";
import type { MessageListSessionState } from "./component/message-list";

export interface SessionData {
  sessionId: string;
  agentId: string;
  agentName: string;
  title: string;
  isGenerating: boolean;
  hasUnread: boolean;
  modes: SessionModeState | null;
  models: SessionModelState | null;
  genericConfigOptions: GenericConfigOption[];
  commands: AvailableCommand[];
  contextUsage: ContextUsageUpdate | null;
  plan: { entries: PlanEntry[] } | null;
  diffChanges: Array<{
    path: string;
    relativePath: string;
    oldText: string | null;
    newText: string;
    status: string;
  }>;
  messageListState?: MessageListSessionState;
  inputState?: { html: string };
  metadataMsg?: ExtensionMessage;
  contextUsageMsg?: ExtensionMessage;
  planMsg?: ExtensionMessage;
}

export type SessionChangeCallback = (
  sessionId: string,
  session: SessionData,
  changedKeys: string[]
) => void;

/**
 * Central state store managing all active and background session records in the webview.
 * Unconditionally processes all incoming backend data messages and provides query and event hooks.
 */
export class SessionStore {
  private readonly sessions = new Map<string, SessionData>();
  private activeSessionId: string | null = null;
  private readonly listeners: Set<SessionChangeCallback> = new Set();

  constructor() {}

  public getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  public setActiveSessionId(sessionId: string | null): void {
    this.activeSessionId = sessionId;
  }

  public getActiveSession(): SessionData | undefined {
    return this.activeSessionId
      ? this.sessions.get(this.activeSessionId)
      : undefined;
  }

  public subscribe(callback: SessionChangeCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notify(
    sessionId: string,
    session: SessionData,
    changedKeys: string[]
  ): void {
    for (const listener of this.listeners) {
      try {
        listener(sessionId, session, changedKeys);
      } catch (err) {
        console.error("[SessionStore] Error in change listener:", err);
      }
    }
  }

  public getOrCreate(session: SessionTab): SessionData {
    let data = this.sessions.get(session.sessionId);
    if (!data) {
      data = {
        sessionId: session.sessionId,
        agentId: session.agentId,
        agentName: session.agentName,
        title: session.title,
        isGenerating: session.isGenerating ?? false,
        hasUnread: false,
        modes: null,
        models: null,
        genericConfigOptions: [],
        commands: [],
        contextUsage: null,
        plan: null,
        diffChanges: [],
      };
      this.sessions.set(session.sessionId, data);
    } else {
      data.agentId = session.agentId;
      data.agentName = session.agentName;
      if (session.title) data.title = session.title;
      if (session.isGenerating !== undefined)
        data.isGenerating = session.isGenerating;
    }
    return data;
  }

  public get(sessionId: string): SessionData | undefined {
    return this.sessions.get(sessionId);
  }

  public has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  public remove(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  public getAll(): SessionData[] {
    return Array.from(this.sessions.values());
  }

  public clear(): void {
    this.sessions.clear();
  }

  /**
   * Unconditionally processes an incoming extension message into the store.
   * Returns the target sessionId and the list of updated keys, or null if not applicable.
   */
  public processMessage(msg: ExtensionMessage): {
    targetSessionId: string | null;
    changedKeys: string[];
  } {
    const targetSessionId = msg.sessionId || this.activeSessionId || null;
    const changedKeys: string[] = [];

    if (!targetSessionId) {
      return { targetSessionId: null, changedKeys };
    }

    let session = this.sessions.get(targetSessionId);
    if (
      !session &&
      (msg.type === "sessionCreated" ||
        msg.type === "streamStart" ||
        msg.type === "sessionMetadata")
    ) {
      const defaultAgentId = this.activeSessionId
        ? this.sessions.get(this.activeSessionId)?.agentId || "unknown"
        : "unknown";
      session = this.getOrCreate({
        sessionId: targetSessionId,
        agentId: msg.agentId || defaultAgentId,
        agentName: msg.agentName || msg.agentId || "Agent",
        title: msg.title || "New Chat",
        isGenerating: msg.type === "streamStart",
      });
      changedKeys.push("created");
    }

    if (!session) {
      return { targetSessionId, changedKeys };
    }

    switch (msg.type) {
      case "sessionMetadata":
        session.metadataMsg = msg;
        session.modes = msg.modes ?? null;
        session.models = msg.models ?? null;
        session.genericConfigOptions = msg.genericConfigOptions ?? [];
        session.commands = msg.commands ?? [];
        changedKeys.push(
          "metadata",
          "modes",
          "models",
          "genericConfigOptions",
          "commands"
        );
        break;

      case "contextUsage":
        session.contextUsageMsg = msg;
        session.contextUsage = {
          used: msg.used ?? 0,
          size: msg.size ?? 0,
          cost: msg.cost,
        };
        changedKeys.push("contextUsage");
        break;

      case "plan":
        if (msg.plan) {
          session.plan = msg.plan;
          session.planMsg = msg;
          changedKeys.push("plan");
        }
        break;

      case "planComplete":
        session.plan = null;
        session.planMsg = undefined;
        changedKeys.push("plan");
        break;

      case "diffSummary":
        if (msg.changes) {
          session.diffChanges = msg.changes;
          changedKeys.push("diffChanges");
        }
        break;

      case "streamStart":
        session.isGenerating = true;
        changedKeys.push("isGenerating");
        break;

      case "streamEnd":
        session.isGenerating = false;
        changedKeys.push("isGenerating");
        break;

      case "sessionTitleChanged":
        if (msg.title) {
          session.title = msg.title;
          changedKeys.push("title");
        }
        break;

      case "sessionInfoUpdate":
        if (msg.title) {
          session.title = msg.title;
          changedKeys.push("title");
        }
        break;
    }

    if (changedKeys.length > 0) {
      this.notify(targetSessionId, session, changedKeys);
    }

    return { targetSessionId, changedKeys };
  }
}
