import * as vscode from "vscode";
import * as path from "path";
import { searchWorkspaceFiles } from "../utils/file-search";
import { getWorkspaceRoot } from "../utils/workspace";
import { ACPClient, type ContextUsageUpdate } from "../acp/client";
import { AgentPool } from "../acp/agent-pool";
import {
  getAgent,
  getFirstAvailableAgent,
  getAgentsWithStatus,
} from "../acp/agents";
import { DiffManager } from "../acp/diff-manager";
import { FileHandler } from "../acp/file-handler";
import { TerminalHandler } from "../acp/terminal-handler";
import {
  LocalSessionManager,
  globalStateSessionStore,
  inMemorySessionStore,
  type SessionInfo,
} from "../acp/session-manager";
import { DocumentSyncManager } from "../acp/document-sync";
import { extractMentions } from "../utils/mention-serializer";
import { AsyncSerialQueue, AsyncSerialProcessor } from "../utils/async-queue";
import { withTimeout } from "../utils/async";
import {
  type SessionNotification,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ToolCall,
  type ToolCallUpdate,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type CompleteElicitationNotification,
} from "@agentclientprotocol/sdk";
import type { SessionTab } from "./webview/types";

const SELECTED_AGENT_KEY = "vscode-acp-chat.selectedAgent";
const AGENT_PREFS_KEY = "vscode-acp-chat.agentPreferences.v1";

interface AgentPreference {
  modeId?: string;
  modelId?: string;
  configOptionValues: Record<string, string>;
  starredModels: string[];
  modelConfigOptionValues?: Record<string, Record<string, string>>;
}

type AgentPreferences = Record<string, AgentPreference>;

interface WebviewMessage {
  type:
    | "sendMessage"
    | "ready"
    | "selectMode"
    | "selectModel"
    | "selectConfigOption"
    | "connect"
    | "newChat"
    | "clearChat"
    | "copyMessage"
    | "searchFiles"
    | "openFile"
    | "permissionResponse"
    | "elicitationResponse"
    | "stop"
    | "reviewDiff"
    | "acceptDiff"
    | "rollbackDiff"
    | "acceptAllDiffs"
    | "rollbackAllDiffs"
    | "toggleModelStar"
    | "confirmActionResponse"
    | "switchSession"
    | "closeSession"
    | "showOpenSessions"
    | "getAgents";
  text?: string;
  modeId?: string;
  modelId?: string;
  configId?: string;
  value?: string;
  isStarred?: boolean;
  images?: string[];
  mentions?: Array<{
    name: string;
    path?: string;
    type?: "file" | "folder" | "selection" | "terminal" | "image";
    content?: string;
    range?: { startLine: number; endLine: number };
    dataUrl?: string;
  }>;
  path?: string;
  href?: string;
  range?: { startLine: number; endLine: number };
  requestId?: string;
  outcome?: { outcome: "selected" | "cancelled"; optionId?: string };
  elicitationAction?: "accept" | "decline" | "cancel";
  elicitationContent?: Record<
    string,
    string | number | boolean | Array<string>
  >;
  elicitationId?: string;
  confirmed?: boolean;
  action?: string;
  actionLabel?: string;
  checkExists?: boolean;
  sessionId?: string;
  agentId?: string;
}

type FileLineRange = { startLine: number; endLine: number };

function parseFileLineRange(value: string): FileLineRange | undefined {
  const match = value.match(/^L?(\d+)(?:-L?(\d+))?$/);
  if (!match) return undefined;

  const startLine = parseInt(match[1], 10);
  const endLine = match[2] ? parseInt(match[2], 10) : startLine;
  return { startLine, endLine };
}

function splitTrailingLineSuffix(pathText: string): {
  path: string;
  range?: FileLineRange;
} {
  const match = pathText.match(/^(.*):(\d+)(?:-(\d+)|:\d+)?$/);
  if (!match || !match[1] || /^[a-zA-Z]$/.test(match[1])) {
    return { path: pathText };
  }

  const startLine = parseInt(match[2], 10);
  const endLine = match[3] ? parseInt(match[3], 10) : startLine;
  return { path: match[1], range: { startLine, endLine } };
}

export interface SelectionMention {
  type: "selection" | "terminal";
  name: string;
  path?: string;
  content: string;
  range?: { startLine: number; endLine: number };
}

type FinalToolCallUpdate = (ToolCall | ToolCallUpdate) & {
  status: "completed" | "failed";
};

type ToolCallMetadataUpdate = Pick<ToolCall | ToolCallUpdate, "toolCallId"> &
  Partial<
    Pick<
      ToolCall | ToolCallUpdate,
      "rawInput" | "rawOutput" | "kind" | "title" | "content" | "locations"
    >
  >;

interface ToolCallState {
  pending?: boolean;
  startTime?: number;
  rawInput?: Record<string, unknown>;
  rawOutput?: unknown;
  kind?: string;
  title?: string;
  content?: ToolCall["content"];
  locations?: ToolCall["locations"];
  baseContent?: Promise<string | undefined>;
  agentId?: string;
  sessionId?: string;
}

export class ChatViewProvider
  implements vscode.WebviewViewProvider, vscode.TextDocumentContentProvider
{
  public static readonly viewType = "vscode-acp-chat.chatView";

  private view?: vscode.WebviewView;
  private globalState: vscode.Memento;
  private agentPool: AgentPool;
  private sessionManager: LocalSessionManager;
  private diffManager: DiffManager;
  private fileHandler: FileHandler;
  private terminalHandler: TerminalHandler;
  private documentSyncManager: DocumentSyncManager;

  private openSessions = new Map<string, SessionTab>();
  private pendingSessionCreations = new Map<string, Promise<SessionTab>>();
  private pendingSessionLoads = new Map<string, Promise<void>>();
  private activeSessionId: string | null = null;
  private activeAgentId: string = "default";

  private userMessageBuffers = new Map<
    string,
    { buffer: string; images: string[] }
  >();
  private toolCalls: Map<string, ToolCallState> = new Map();

  private permissionQueue: Array<{
    id: string;
    agentId: string;
    sessionId?: string;
    params: RequestPermissionRequest;
    resolver: (response: RequestPermissionResponse) => void;
  }> = [];

  private elicitationQueue: Array<{
    id: string;
    agentId: string;
    sessionId?: string;
    elicitationId?: string;
    params: CreateElicitationRequest;
    resolver: (response: CreateElicitationResponse) => void;
  }> = [];

  private sessionUpdateNotifier = new AsyncSerialProcessor<{
    agentId: string;
    notification: SessionNotification;
  }>((item) => this.handleSessionUpdate(item.agentId, item.notification));

  private webviewPostNotifier = new AsyncSerialQueue();

  private pendingConfirmations = new Map<
    string,
    (confirmed: boolean) => void
  >();

  private generatingSessions = new Set<string>();

  /**
   * Test-only factory to construct a ChatViewProvider with a single mocked ACPClient or AgentPool.
   */
  public static createForTest(
    extensionUri: vscode.Uri,
    clientOrPool: ACPClient | AgentPool,
    globalState: vscode.Memento
  ): ChatViewProvider {
    if (clientOrPool instanceof AgentPool) {
      return new ChatViewProvider(extensionUri, clientOrPool, globalState);
    }
    const pool = new AgentPool({
      clientFactory: () => clientOrPool,
    });
    const provider = new ChatViewProvider(extensionUri, pool, globalState);
    provider.wireClientHandlers(clientOrPool, provider.activeAgentId);
    return provider;
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    agentPool: AgentPool,
    globalState: vscode.Memento
  ) {
    this.globalState = globalState;
    this.diffManager = new DiffManager();
    this.fileHandler = new FileHandler(this.diffManager);
    this.terminalHandler = new TerminalHandler();

    const savedAgentId = this.globalState.get<string>(SELECTED_AGENT_KEY);
    this.activeAgentId = savedAgentId || getFirstAvailableAgent().id;
    this.agentPool = agentPool;

    this.sessionManager = new LocalSessionManager((agentId) => {
      const config = vscode.workspace.getConfiguration("vscode-acp-chat");
      const persistent = config.get<boolean>("enablePersistentSessions", true);
      if (!persistent) {
        return inMemorySessionStore(agentId);
      }
      const retentionDays = config.get<number>("sessionRetentionDays", 30);
      const maxSessions = config.get<number>("maxSessionsPerAgent", 300);
      return globalStateSessionStore(
        globalState,
        `vscode-acp-chat.localSessions.v1.${agentId}`,
        { retentionDays, maxSessions },
        agentId
      );
    }, globalState);

    this.documentSyncManager = new DocumentSyncManager(() =>
      this.agentPool.getActiveClients()
    );

    vscode.workspace.registerTextDocumentContentProvider(
      "acp-old-content",
      this
    );

    // Wire handlers for any newly created ACPClient in the pool
    this.agentPool.onClientCreated((client, agentId) => {
      this.wireClientHandlers(client, agentId);
    });

    this.diffManager.onDidChange((changes) => {
      const config = vscode.workspace.getConfiguration("vscode-acp-chat");
      const enabled = config.get<boolean>("enableDiffSummary", true);
      if (enabled) {
        this.postMessage({
          type: "diffSummary",
          sessionId: this.activeSessionId ?? undefined,
          changes: changes.map((c) => ({
            path: c.path,
            relativePath: vscode.workspace.asRelativePath(c.path),
            oldText: c.oldText,
            newText: c.newText,
            status: c.status,
          })),
        });
      }
    });
  }

  public get activeClient(): ACPClient {
    return (
      this.agentPool.getExistingClient(this.activeAgentId) ||
      this.agentPool.getDefaultClient(this.activeAgentId)
    );
  }

  public get acpClient(): ACPClient {
    return this.activeClient;
  }

  public get userMessageBuffer(): string {
    const sessionId = this.activeSessionId || "";
    return this.userMessageBuffers.get(sessionId)?.buffer || "";
  }

  public set userMessageBuffer(val: string) {
    const sessionId = this.activeSessionId || "";
    let entry = this.userMessageBuffers.get(sessionId);
    if (!entry) {
      entry = { buffer: "", images: [] };
      this.userMessageBuffers.set(sessionId, entry);
    }
    entry.buffer = val;
  }

  private getClient(agentId?: string): ACPClient | null {
    const targetAgentId =
      agentId || this.acpClient?.getAgentId?.() || this.activeAgentId;
    return this.agentPool.getExistingClient(targetAgentId) || this.acpClient;
  }

  private wireClientHandlers(client: ACPClient, agentId: string): void {
    client.setOnStateChange((state) => {
      this.postMessage({ type: "connectionState", state, agentId });
      if (state === "disconnected" || state === "error") {
        this.postMessage({
          type: "streamEnd",
          stopReason: "error",
          agentId,
          sessionId: this.activeSessionId ?? undefined,
        });
      }
    });

    client.setOnSessionUpdate((notification) => {
      this.sessionUpdateNotifier.push({ agentId, notification });
    });

    client.setOnStderr((text) => {
      this.handleStderr(agentId, text);
    });

    client.setOnReadTextFile(async (params) => {
      return this.fileHandler.handleReadTextFile(params);
    });

    client.setOnWriteTextFile(async (params) => {
      return this.fileHandler.handleWriteTextFile(params);
    });

    client.setOnCreateTerminal(async (params) => {
      return this.terminalHandler.handleCreateTerminal(params);
    });

    client.setOnTerminalOutput(async (params) => {
      return this.terminalHandler.handleTerminalOutput(params);
    });

    client.setOnWaitForTerminalExit(async (params) => {
      return this.terminalHandler.handleWaitForTerminalExit(params);
    });

    client.setOnKillTerminalCommand(async (params) => {
      return this.terminalHandler.handleKillTerminalCommand(params);
    });

    client.setOnReleaseTerminal(async (params) => {
      return this.terminalHandler.handleReleaseTerminal(params);
    });

    client.setOnPermissionRequest((params) => {
      return this.handlePermissionRequest(agentId, params);
    });

    client.setOnElicitationRequest((params) => {
      return this.handleElicitationRequest(agentId, params);
    });

    client.setOnElicitationComplete((notification) => {
      this.handleElicitationComplete(notification);
    });
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    const path = uri.path;
    const changes = this.diffManager.getPendingChanges();
    const change = changes.find((c) => c.path === path);
    return change?.oldText || "";
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case "ready": {
          this.postMessage({
            type: "availableAgents",
            agents: getAgentsWithStatus(),
          });

          if (this.openSessions.size === 0) {
            await this.createNewSession(this.activeAgentId);
          } else {
            this.postMessage({
              type: "allSessions",
              sessions: Array.from(this.openSessions.values()),
              activeSessionId: this.activeSessionId,
            });
            if (this.activeSessionId) {
              this.sendSessionMetadata(
                this.activeAgentId,
                this.activeSessionId
              );
              this.sendContextUsage(this.activeAgentId, this.activeSessionId);
            }
          }
          break;
        }

        case "getAgents": {
          this.postMessage({
            type: "availableAgents",
            agents: getAgentsWithStatus(),
          });
          break;
        }

        case "newChat": {
          if (message.agentId) {
            await this.createNewSession(message.agentId);
          } else {
            await this.showNewChatQuickPick();
          }
          break;
        }

        case "switchSession": {
          if (message.sessionId && this.openSessions.has(message.sessionId)) {
            this.activeSessionId = message.sessionId;
            const tab = this.openSessions.get(message.sessionId);
            if (tab) {
              this.activeAgentId = tab.agentId;
            }
            this.sendSessionMetadata(this.activeAgentId, this.activeSessionId);
            this.sendContextUsage(this.activeAgentId, this.activeSessionId);
          }
          break;
        }

        case "closeSession": {
          if (message.sessionId) {
            const tab = this.openSessions.get(message.sessionId);
            const agentId =
              message.agentId || tab?.agentId || this.activeAgentId;
            await this.closeSession(agentId, message.sessionId);
          }
          break;
        }

        case "showOpenSessions": {
          await this.showOpenSessionsQuickPick();
          break;
        }

        case "sendMessage": {
          if (
            message.text !== undefined ||
            (message.images && message.images.length > 0)
          ) {
            const agentId = message.agentId || this.activeAgentId;
            const sessionId = message.sessionId || this.activeSessionId;
            await this.handleUserMessage(
              agentId,
              sessionId,
              message.text || "",
              message.images,
              message.mentions
            );
          }
          break;
        }

        case "stop": {
          const agentId = message.agentId || this.activeAgentId;
          const sessionId = message.sessionId || this.activeSessionId;
          this.dismissPendingPermissions(sessionId ?? undefined);
          this.dismissPendingElicitations(sessionId ?? undefined);
          if (sessionId) {
            await this.agentPool.cancelSession(agentId, sessionId);
            this.generatingSessions.delete(sessionId);
            this.postMessage({
              type: "streamEnd",
              stopReason: "cancelled",
              agentId,
              sessionId,
            });
          }
          break;
        }

        case "selectMode": {
          if (message.modeId) {
            const agentId = message.agentId || this.activeAgentId;
            const sessionId = message.sessionId || this.activeSessionId;
            await this.handleModeChange(agentId, sessionId, message.modeId);
          }
          break;
        }

        case "selectModel": {
          if (message.modelId) {
            const agentId = message.agentId || this.activeAgentId;
            const sessionId = message.sessionId || this.activeSessionId;
            await this.handleModelChange(agentId, sessionId, message.modelId);
          }
          break;
        }

        case "selectConfigOption": {
          if (message.configId && message.value !== undefined) {
            const agentId = message.agentId || this.activeAgentId;
            const sessionId = message.sessionId || this.activeSessionId;
            await this.handleConfigOptionChange(
              agentId,
              sessionId,
              message.configId,
              message.value
            );
          }
          break;
        }

        case "toggleModelStar": {
          if (
            message.modelId !== undefined &&
            message.isStarred !== undefined
          ) {
            const agentId = message.agentId || this.activeAgentId;
            const sessionId = message.sessionId || this.activeSessionId;
            await this.updateAgentPreference(agentId, (pref) => {
              const starred = new Set(pref.starredModels);
              if (message.isStarred) {
                starred.add(message.modelId!);
              } else {
                starred.delete(message.modelId!);
              }
              return { ...pref, starredModels: Array.from(starred) };
            });
            this.sendSessionMetadata(agentId, sessionId ?? undefined);
          }
          break;
        }

        case "permissionResponse": {
          if (message.requestId && message.outcome) {
            const pending = this.permissionQueue.find(
              (p) => p.id === message.requestId
            );
            if (pending) {
              const outcome =
                message.outcome.outcome === "selected"
                  ? {
                      outcome: "selected" as const,
                      optionId: message.outcome.optionId!,
                    }
                  : { outcome: "cancelled" as const };
              pending.resolver({ outcome });
              this.permissionQueue = this.permissionQueue.filter(
                (p) => p.id !== message.requestId
              );
            }
          }
          break;
        }

        case "elicitationResponse": {
          if (message.requestId && message.elicitationAction) {
            const pending = this.elicitationQueue.find(
              (p) => p.id === message.requestId
            );
            if (pending) {
              if (message.elicitationAction === "accept") {
                pending.resolver({
                  action: "accept",
                  content: message.elicitationContent ?? null,
                });
              } else {
                pending.resolver({ action: message.elicitationAction });
              }
              this.elicitationQueue = this.elicitationQueue.filter(
                (p) => p.id !== message.requestId
              );
            }
          }
          break;
        }

        case "confirmActionResponse": {
          if (message.requestId && message.confirmed !== undefined) {
            const resolver = this.pendingConfirmations.get(message.requestId);
            if (resolver) {
              resolver(message.confirmed);
              this.pendingConfirmations.delete(message.requestId);
            }
          }
          break;
        }

        case "searchFiles": {
          if (message.text !== undefined) {
            const query = message.text;
            const results = await searchWorkspaceFiles(query, {
              maxResults: 20,
              includeHidden: true,
            });
            this.postMessage({
              type: "fileSearchResults",
              results,
            });
          }
          break;
        }

        case "openFile": {
          await this.handleOpenFile(message);
          break;
        }

        case "copyMessage": {
          if (message.text) {
            await vscode.env.clipboard.writeText(message.text);
            vscode.window.showInformationMessage("Message copied to clipboard");
          }
          break;
        }

        case "clearChat": {
          this.handleClearChat();
          break;
        }

        case "reviewDiff": {
          if (message.path) {
            await this.handleReviewDiff(message.path);
          }
          break;
        }

        case "acceptDiff": {
          if (message.path) {
            this.diffManager.accept(message.path);
          }
          break;
        }

        case "rollbackDiff": {
          if (message.path) {
            await this.diffManager.rollback(message.path);
          }
          break;
        }

        case "acceptAllDiffs": {
          this.diffManager.acceptAll();
          break;
        }

        case "rollbackAllDiffs": {
          await this.diffManager.rollbackAll();
          break;
        }
      }
    });
  }

  // -------------------------------------------------------------------
  // Session Creation & Lifecycle
  // -------------------------------------------------------------------

  public async closeCurrentSession(): Promise<void> {
    if (this.activeSessionId) {
      await this.closeSession(this.activeAgentId, this.activeSessionId);
    }
  }

  public async handleNewChat(agentId?: string): Promise<void> {
    const targetAgentId = agentId || this.activeAgentId;
    await this.createNewSession(targetAgentId);
  }

  public async handleAgentChange(agentId: string): Promise<void> {
    this.activeAgentId = agentId;
    const client = this.acpClient;
    const agent = getAgent(agentId) ?? {
      id: agentId,
      name: agentId,
      command: agentId,
      args: [],
    };
    if (client) {
      client.setAgent(agent);
    }
    await this.createNewSession(agentId);
  }

  public async createNewSession(agentId: string): Promise<SessionTab> {
    const tempSessionId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const agent = getAgent(agentId);
    const agentName = agent?.name || agentId;

    const tempSessionTab: SessionTab = {
      sessionId: tempSessionId,
      agentId,
      agentName,
      title: "New session",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isLoading: true,
      loadingTitle: "Starting agent...",
    };

    this.openSessions.set(tempSessionId, tempSessionTab);
    this.activeSessionId = tempSessionId;
    this.activeAgentId = agentId;
    this.globalState.update(SELECTED_AGENT_KEY, agentId);

    this.postMessage({
      type: "sessionCreated",
      session: tempSessionTab,
    });

    const createPromise = (async (): Promise<SessionTab> => {
      const cwd = getWorkspaceRoot();
      try {
        const client = await withTimeout(
          this.agentPool.getClient(agentId, cwd),
          60000,
          `Agent "${agentId}" connection timed out after 60s`
        );
        if (!this.openSessions.has(tempSessionId)) {
          return tempSessionTab;
        }

        const response = await withTimeout(
          client.newSession(cwd),
          60000,
          `Agent "${agentId}" newSession RPC timed out after 60s`
        );
        const sessionId = response.sessionId;

        // If tab was closed while initializing, clean up and exit
        if (!this.openSessions.has(tempSessionId)) {
          const caps = client.getAgentCapabilities();
          if (caps?.sessionCapabilities?.close) {
            try {
              await client.closeSession({ sessionId });
            } catch {
              // ignore
            }
          }
          return tempSessionTab;
        }

        this.agentPool.registerSession(agentId, sessionId);
        await this.sessionManager.recordSession(agentId, sessionId, cwd);

        // Read back the stored record to get the default title, ensuring
        // consistency with the session store even if the agent never sends
        // a session_info_update event.
        const storedRecord = await this.sessionManager.findSession(sessionId);
        const sessionTitle = storedRecord?.title || `Session ${sessionId}`;

        const realSessionTab: SessionTab = {
          sessionId,
          agentId,
          agentName: client.getAgentName() || agentName,
          title: sessionTitle,
          createdAt: tempSessionTab.createdAt,
          updatedAt: Date.now(),
          isLoading: false,
        };

        // Replace temp tab with real tab in openSessions preserving tab order
        const updatedOpenSessions = new Map<string, SessionTab>();
        for (const [sid, tab] of this.openSessions.entries()) {
          if (sid === tempSessionId) {
            updatedOpenSessions.set(sessionId, realSessionTab);
          } else {
            updatedOpenSessions.set(sid, tab);
          }
        }
        this.openSessions = updatedOpenSessions;

        if (this.activeSessionId === tempSessionId) {
          this.activeSessionId = sessionId;
        }

        this.postMessage({
          type: "sessionIdChanged",
          oldSessionId: tempSessionId,
          newSessionId: sessionId,
          session: realSessionTab,
        });

        await this.restoreSessionPreferences(agentId, sessionId);
        this.sendSessionMetadata(agentId, sessionId);
        this.documentSyncManager.syncCapabilities();

        return realSessionTab;
      } catch (error) {
        if (!this.openSessions.has(tempSessionId)) {
          return tempSessionTab;
        }
        console.error("[Chat] Failed to create new session:", error);
        const errorMessage =
          error instanceof Error ? error.message : JSON.stringify(error);
        const tab = this.openSessions.get(tempSessionId);
        if (tab) {
          tab.isLoading = false;
          tab.error = errorMessage;
        }
        this.postMessage({
          type: "sessionLoadFailed",
          sessionId: tempSessionId,
          error: errorMessage,
          agentId,
        });
        this.postMessage({
          type: "error",
          text: `Failed to create session: ${errorMessage}`,
          agentId,
          sessionId: tempSessionId,
        });
        throw error;
      } finally {
        this.pendingSessionCreations.delete(tempSessionId);
      }
    })();

    this.pendingSessionCreations.set(tempSessionId, createPromise);
    return createPromise;
  }

  public async closeSession(agentId: string, sessionId: string): Promise<void> {
    this.pendingSessionCreations.delete(sessionId);
    this.pendingSessionLoads.delete(sessionId);

    // Capture the closing tab's agent up-front so we can reuse it later if this
    // close leaves the panel with no tabs.
    const closingTab = this.openSessions.get(sessionId);
    const closingAgentId = closingTab?.agentId ?? agentId ?? this.activeAgentId;

    if (this.generatingSessions.has(sessionId)) {
      await this.agentPool.cancelSession(agentId, sessionId);
      this.generatingSessions.delete(sessionId);
    }

    const client = this.agentPool.getExistingClient(agentId) || this.acpClient;
    if (client) {
      const caps = client.getAgentCapabilities();
      if (caps?.sessionCapabilities?.close) {
        try {
          await client.closeSession({ sessionId });
        } catch (err) {
          console.warn(
            `[Chat] Failed to close session "${sessionId}" on agent "${agentId}", falling back to cancel:`,
            err
          );
          try {
            await client.cancel(sessionId);
          } catch {
            // ignore
          }
        }
      } else {
        try {
          await client.cancel(sessionId);
        } catch {
          // ignore
        }
      }
    }

    this.agentPool.unregisterSession(agentId, sessionId);
    this.openSessions.delete(sessionId);
    this.userMessageBuffers.delete(sessionId);

    this.postMessage({
      type: "sessionClosed",
      sessionId,
      agentId,
    });

    // If the closed tab was the active one, switch focus to a remaining tab
    // (if any). The "auto-create" path below fires whenever the close leaves
    // the panel with zero tabs, regardless of whether the closed tab was the
    // active one — that way closing the last tab always leaves a usable
    // session open.
    if (this.activeSessionId === sessionId) {
      const remaining = Array.from(this.openSessions.values());
      if (remaining.length > 0) {
        const next = remaining[remaining.length - 1];
        this.activeSessionId = next.sessionId;
        this.activeAgentId = next.agentId;
        this.postMessage({
          type: "activeSessionChanged",
          sessionId: next.sessionId,
        });
        this.sendSessionMetadata(this.activeAgentId, this.activeSessionId);
        this.sendContextUsage(this.activeAgentId, this.activeSessionId);
      } else {
        this.activeSessionId = null;
      }
    }

    // If the close left the panel with zero open tabs, automatically start a
    // fresh session using the same agent as the closed tab so the panel never
    // lands on an empty welcome view. Fire-and-forget: the close RPC above
    // has already completed, and a failure here leaves the user on the
    // welcome view (current behavior) rather than blocking the close.
    if (this.openSessions.size === 0) {
      void this.createNewSession(closingAgentId).catch((err) => {
        console.error(
          `[Chat] Failed to auto-create replacement session for agent "${closingAgentId}":`,
          err
        );
      });
    }
  }

  public async loadHistorySession(
    sessionId: string,
    agentId?: string
  ): Promise<void> {
    // 1. If already open in tabs, just activate that tab
    if (this.openSessions.has(sessionId)) {
      this.activeSessionId = sessionId;
      const tab = this.openSessions.get(sessionId);
      if (tab) this.activeAgentId = tab.agentId;
      this.postMessage({
        type: "activeSessionChanged",
        sessionId,
      });
      this.sendSessionMetadata(this.activeAgentId, this.activeSessionId);
      this.sendContextUsage(this.activeAgentId, this.activeSessionId);
      return;
    }

    // 2. Look up agent ID from stored record if omitted
    let targetAgentId = agentId;
    let sessionTitle = `Session ${sessionId}`;
    const record = await this.sessionManager.findSession(sessionId);
    if (record) {
      targetAgentId = targetAgentId || record.agentId;
      sessionTitle = record.title || sessionTitle;
    }
    targetAgentId = targetAgentId || getFirstAvailableAgent().id;
    const initialAgentName = getAgent(targetAgentId)?.name || targetAgentId;

    const sessionTab: SessionTab = {
      sessionId,
      agentId: targetAgentId,
      agentName: initialAgentName,
      title: sessionTitle,
      createdAt: record?.createdAt
        ? new Date(record.createdAt).getTime()
        : Date.now(),
      updatedAt: record?.updatedAt
        ? new Date(record.updatedAt).getTime()
        : Date.now(),
      isLoading: true,
      loadingTitle: "Loading conversation...",
    };

    this.openSessions.set(sessionId, sessionTab);
    this.activeSessionId = sessionId;
    this.activeAgentId = targetAgentId;

    // Immediately notify webview to render blank tab with loading placeholder
    this.postMessage({
      type: "sessionCreated",
      session: sessionTab,
    });

    const loadPromise = (async (): Promise<void> => {
      const cwd = getWorkspaceRoot();
      try {
        const client = await withTimeout(
          this.agentPool.getClient(targetAgentId, cwd),
          60000,
          `Agent "${targetAgentId}" connection timed out after 60s`
        );
        if (!this.openSessions.has(sessionId)) {
          return;
        }

        this.agentPool.registerSession(targetAgentId, sessionId);

        if (
          client.getAgentName() &&
          client.getAgentName() !== sessionTab.agentName
        ) {
          sessionTab.agentName = client.getAgentName();
          if (this.openSessions.has(sessionId)) {
            this.postMessage({
              type: "sessionUpdated",
              sessionId,
              agentName: sessionTab.agentName,
            });
          }
        }

        await withTimeout(
          client.loadSession({ sessionId, cwd }),
          60000,
          `Agent "${targetAgentId}" loadSession RPC timed out after 60s`
        );
        await this.sessionUpdateNotifier.waitForIdle();
        this.flushUserMessageBuffer(sessionId);

        // If tab was closed while loadSession was running, clean up agent session and exit
        if (!this.openSessions.has(sessionId)) {
          this.agentPool.unregisterSession(targetAgentId, sessionId);
          const caps = client.getAgentCapabilities();
          if (caps?.sessionCapabilities?.close) {
            try {
              await client.closeSession({ sessionId });
            } catch {
              // ignore
            }
          }
          return;
        }

        sessionTab.isLoading = false;
        this.postMessage({
          type: "sessionLoaded",
          sessionId,
          agentId: targetAgentId,
        });
        this.postMessage({
          type: "streamEnd",
          stopReason: "history_load",
          agentId: targetAgentId,
          sessionId,
        });
        this.sendSessionMetadata(targetAgentId, sessionId);
        this.documentSyncManager.syncCapabilities();
      } catch (error) {
        // If tab was closed while loading, clean up and do not post errors to webview
        if (!this.openSessions.has(sessionId)) {
          this.agentPool.unregisterSession(targetAgentId, sessionId);
          return;
        }

        console.error("[Chat] Failed to load history session:", error);
        const errorMessage =
          error instanceof Error ? error.message : JSON.stringify(error);
        sessionTab.isLoading = false;
        this.postMessage({
          type: "sessionLoadFailed",
          sessionId,
          error: errorMessage,
          agentId: targetAgentId,
        });
        this.postMessage({
          type: "error",
          text: `Failed to load history: ${errorMessage}`,
          agentId: targetAgentId,
          sessionId,
        });
      } finally {
        this.pendingSessionLoads.delete(sessionId);
      }
    })();

    this.pendingSessionLoads.set(sessionId, loadPromise);
    return loadPromise;
  }

  public async deleteHistorySession(
    agentId: string,
    sessionId: string
  ): Promise<void> {
    const client = this.agentPool.getExistingClient(agentId);
    if (client && client.isConnected()) {
      const caps = client.getAgentCapabilities();
      if (caps?.sessionCapabilities?.delete) {
        try {
          await client.deleteSession({ sessionId });
        } catch (err) {
          console.warn("[Chat] Agent deleteSession failed:", err);
        }
      }
    }
    await this.sessionManager.deleteSession(agentId, sessionId);
  }

  public async listAllSessions(): Promise<SessionInfo[]> {
    const cwd = getWorkspaceRoot();
    return this.sessionManager.listAllSessions(cwd);
  }

  public async listSessions(): Promise<SessionInfo[]> {
    return this.listAllSessions();
  }

  public getOpenSession(sessionId: string): SessionTab | undefined {
    return this.openSessions.get(sessionId);
  }

  public getSupportsLoadSession(): boolean {
    return this.sessionManager.supportsLoadSession;
  }

  public getSupportsDeleteSession(): boolean {
    return this.sessionManager.supportsDeleteSession;
  }

  public async finalizePendingToolCalls(stopReason?: string): Promise<void> {
    for (const [toolCallId, state] of this.toolCalls.entries()) {
      if (state.pending) {
        this.toolCalls.delete(toolCallId);
        this.postMessage({
          type: "toolCallComplete",
          toolCallId,
          status: stopReason === "error" ? "failed" : "completed",
          title: state.title,
          kind: state.kind,
          rawInput: state.rawInput,
          content: state.content,
        });
      }
    }
  }

  // -------------------------------------------------------------------
  // Session Updates & Streaming
  // -------------------------------------------------------------------

  public async handleSessionUpdate(
    agentIdOrNotification: string | SessionNotification,
    maybeNotification?: SessionNotification
  ): Promise<void> {
    let agentId: string;
    let notification: SessionNotification;

    if (typeof agentIdOrNotification === "string") {
      agentId = agentIdOrNotification;
      notification = maybeNotification!;
    } else {
      notification = agentIdOrNotification;
      agentId =
        (notification.sessionId
          ? this.openSessions.get(notification.sessionId)?.agentId
          : undefined) || this.activeAgentId;
    }

    const client = this.getClient(agentId);
    const sessionId = notification.sessionId || this.activeSessionId || "";
    const update = notification.update;

    if (update.sessionUpdate === "agent_message_chunk") {
      this.flushUserMessageBuffer(sessionId);
      if (update.content?.type === "text") {
        this.postMessage({
          type: "streamChunk",
          agentId,
          sessionId,
          text: update.content.text,
          messageId: update.messageId ?? null,
        });
      }
    } else if (update.sessionUpdate === "user_message_chunk") {
      if (update.content?.type === "text") {
        let entry = this.userMessageBuffers.get(sessionId);
        if (!entry) {
          entry = { buffer: "", images: [] };
          this.userMessageBuffers.set(sessionId, entry);
        }
        entry.buffer += update.content.text;
      }
    } else if (update.sessionUpdate === "agent_thought_chunk") {
      this.flushUserMessageBuffer(sessionId);
      if (update.content?.type === "text") {
        this.postMessage({
          type: "thoughtChunk",
          agentId,
          sessionId,
          text: update.content.text,
          messageId: update.messageId ?? null,
        });
      }
    } else if (update.sessionUpdate === "tool_call") {
      this.flushUserMessageBuffer(sessionId);
      this.rememberToolCallMetadata(update, agentId, sessionId);
      const state = this.toolCalls.get(update.toolCallId);
      if (state) state.pending = true;

      if (this.isFinalToolCall(update)) {
        if (state) state.pending = false;
        this.toolCalls.delete(update.toolCallId);
        const terminalOutput = this.extractTerminalOutput(update.rawOutput);
        this.postMessage({
          type: "toolCallComplete",
          agentId,
          sessionId,
          toolCallId: update.toolCallId,
          status: update.status,
          title: update.title || state?.title,
          kind: update.kind || state?.kind,
          rawInput: update.rawInput || state?.rawInput,
          rawOutput: update.rawOutput,
          content: update.content || state?.content,
          terminalOutput,
        });
      } else {
        this.postMessage({
          type: "toolCallStart",
          agentId,
          sessionId,
          name: update.title || "Tool",
          toolCallId: update.toolCallId,
          kind: update.kind,
          rawInput: update.rawInput,
        });
      }
    } else if (update.sessionUpdate === "tool_call_update") {
      this.rememberToolCallMetadata(update, agentId, sessionId);
      if (this.isFinalToolCall(update)) {
        const state = this.toolCalls.get(update.toolCallId);
        if (state) state.pending = false;
        this.toolCalls.delete(update.toolCallId);
        const terminalOutput = this.extractTerminalOutput(update.rawOutput);

        this.postMessage({
          type: "toolCallComplete",
          agentId,
          sessionId,
          toolCallId: update.toolCallId,
          status: update.status,
          title: update.title || state?.title,
          kind: update.kind || state?.kind,
          rawInput: update.rawInput || state?.rawInput,
          rawOutput: update.rawOutput,
          content: update.content || state?.content,
          terminalOutput,
        });
      }
    } else if (update.sessionUpdate === "session_info_update") {
      if (sessionId) {
        await this.sessionManager.applySessionInfoUpdate(
          agentId,
          sessionId,
          update
        );
        if (update.title) {
          const tab = this.openSessions.get(sessionId);
          if (tab) tab.title = update.title;
          this.postMessage({
            type: "sessionUpdated",
            agentId,
            sessionId,
            title: update.title,
          });
        }
      }
    } else if (update.sessionUpdate === "current_mode_update") {
      this.postMessage({
        type: "modeUpdate",
        agentId,
        sessionId,
        modeId: update.currentModeId,
      });
    } else if (update.sessionUpdate === "available_commands_update") {
      this.postMessage({
        type: "availableCommands",
        agentId,
        sessionId,
        commands: update.availableCommands,
      });
    } else if (update.sessionUpdate === "plan") {
      this.postMessage({
        type: "plan",
        agentId,
        sessionId,
        plan: { entries: update.entries },
      });
    } else if (update.sessionUpdate === "config_option_update") {
      client?.updateSessionMetadataFromConfigOptions(
        update.configOptions,
        sessionId
      );
      this.sendSessionMetadata(agentId, sessionId);
    } else if (update.sessionUpdate === "usage_update") {
      const u = update as Partial<ContextUsageUpdate>;
      if (
        typeof u.used === "number" &&
        typeof u.size === "number" &&
        u.size > 0
      ) {
        client?.setLastUsageUpdate(
          {
            used: u.used,
            size: u.size,
            cost: u.cost,
          },
          sessionId
        );
        this.sendContextUsage(agentId, sessionId);
      }
    }
  }

  private extractTerminalOutput(rawOutput: unknown): string | undefined {
    if (typeof rawOutput === "string") {
      return rawOutput;
    }
    if (rawOutput && typeof rawOutput === "object") {
      const obj = rawOutput as Record<string, unknown>;
      if (typeof obj.formatted_output === "string") {
        return obj.formatted_output;
      }
      if (typeof obj.text === "string") {
        return obj.text;
      }
      if (typeof obj.output === "string") {
        return obj.output;
      }
      return Object.entries(obj)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
    }
    return undefined;
  }

  public flushUserMessageBuffer(sessionId?: string): void {
    const targetSessionId = sessionId || this.activeSessionId || "";
    const entry = this.userMessageBuffers.get(targetSessionId);
    if (entry && entry.buffer) {
      this.postMessage({
        type: "streamEnd",
        stopReason: "end_turn",
        sessionId: targetSessionId || undefined,
      });
      const { text, mentions } = extractMentions(entry.buffer);
      this.postMessage({
        type: "userMessage",
        sessionId: targetSessionId || undefined,
        text,
        mentions,
      });
      entry.buffer = "";
      entry.images = [];
    }
  }

  public async handleUserMessage(
    agentId: string,
    sessionId: string | null,
    text: string,
    images: string[] = [],
    mentions: Array<{
      name: string;
      path?: string;
      type?: "file" | "folder" | "selection" | "terminal" | "image";
      content?: string;
      range?: { startLine: number; endLine: number };
      dataUrl?: string;
    }> = []
  ): Promise<void> {
    const cwd = getWorkspaceRoot();
    const client = await this.agentPool.getClient(agentId, cwd);

    let activeSession = sessionId
      ? this.openSessions.get(sessionId)
      : undefined;
    if (sessionId && this.pendingSessionCreations.has(sessionId)) {
      try {
        activeSession = await this.pendingSessionCreations.get(sessionId);
        sessionId = activeSession?.sessionId || sessionId;
      } catch {
        return;
      }
    }
    if (sessionId && this.pendingSessionLoads.has(sessionId)) {
      try {
        await this.pendingSessionLoads.get(sessionId);
      } catch {
        return;
      }
    }
    if (!activeSession || !sessionId) {
      activeSession = await this.createNewSession(agentId);
      sessionId = activeSession.sessionId;
    }
    const resolvedSessionId = sessionId;
    if (!this.openSessions.has(resolvedSessionId)) return;

    // --- First-message title fallback ---
    // If the tab still has the default title, use the first user message
    // as the session name. Agents that send session_info_update will
    // overwrite this later.
    const isFirstMessage = activeSession.title.startsWith("Session ");
    if (isFirstMessage && text.trim().length > 0) {
      const newTitle =
        text.trim().length > 30
          ? text.trim().substring(0, 30) + "..."
          : text.trim();

      activeSession.title = newTitle;

      await this.sessionManager.recordSession(
        agentId,
        resolvedSessionId,
        cwd,
        newTitle
      );

      this.postMessage({
        type: "sessionUpdated",
        agentId,
        sessionId: resolvedSessionId,
        title: newTitle,
      });
    }

    if (this.generatingSessions.has(resolvedSessionId)) return;
    this.generatingSessions.add(resolvedSessionId);

    this.postMessage({
      type: "userMessage",
      agentId,
      sessionId: resolvedSessionId,
      text,
      images,
      mentions,
    });

    try {
      this.postMessage({
        type: "streamStart",
        agentId,
        sessionId: resolvedSessionId,
      });

      const response = await client.sendMessage(
        text,
        images,
        mentions,
        resolvedSessionId
      );
      await this.finalizePendingToolCalls(response.stopReason);
      this.postMessage({
        type: "streamEnd",
        agentId,
        sessionId: resolvedSessionId,
        stopReason: response.stopReason,
      });
    } catch (error) {
      console.error("[Chat] Error in handleUserMessage:", error);
      const errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
      await this.finalizePendingToolCalls("error");
      this.postMessage({
        type: "error",
        agentId,
        sessionId: resolvedSessionId,
        text: `Error: ${errorMessage}`,
      });
      this.postMessage({
        type: "streamEnd",
        agentId,
        sessionId: resolvedSessionId,
        stopReason: "error",
      });
    } finally {
      this.generatingSessions.delete(resolvedSessionId);
    }
  }

  public sendSessionMetadata(agentId?: string, sessionId?: string): void {
    const targetSessionId = sessionId || this.activeSessionId;
    const targetAgentId =
      agentId ||
      (targetSessionId
        ? this.openSessions.get(targetSessionId)?.agentId
        : undefined) ||
      this.activeAgentId;
    const client = this.getClient(targetAgentId);
    const metadata = client?.getSessionMetadata(targetSessionId!);

    const prefs = this.getAgentPreferences(targetAgentId);
    const starredModels = prefs.starredModels || [];

    this.postMessage({
      type: "sessionMetadata",
      agentId: targetAgentId,
      sessionId: targetSessionId ?? undefined,
      modes: metadata?.modes || null,
      models: metadata?.models || null,
      genericConfigOptions: metadata?.genericConfigOptions || [],
      commands: metadata?.commands || null,
      starredModels,
    });
  }

  public sendContextUsage(agentId: string, sessionId: string): void {
    const client = this.getClient(agentId);
    const metadata = client?.getSessionMetadata(sessionId);
    const usage =
      metadata?.lastUsageUpdate || client?.getLastUsageUpdate(sessionId);

    this.postMessage({
      type: "contextUsage",
      agentId: agentId,
      sessionId: sessionId ?? undefined,
      used: usage ? usage.used : null,
      size: usage ? usage.size : null,
      cost: usage ? usage.cost : null,
    });
  }

  public async restoreSessionPreferences(
    agentId: string,
    sessionId: string
  ): Promise<void> {
    const client = this.getClient(agentId);
    if (!client) return;

    const pref = this.getAgentPreferences(agentId);
    const metadata = client.getSessionMetadata(sessionId);

    // Restore mode
    if (pref.modeId && metadata?.modes) {
      const hasMode = metadata.modes.availableModes.some(
        (m) => m.id === pref.modeId
      );
      if (hasMode) {
        await client.setMode(pref.modeId, sessionId);
      }
    }

    // Restore model
    if (pref.modelId && metadata?.models) {
      const hasModel = metadata.models.availableModels.some(
        (m) => m.modelId === pref.modelId
      );
      if (hasModel) {
        await client.setModel(pref.modelId, sessionId);
      }
    }

    // Restore generic config options
    if (pref.configOptionValues && metadata?.genericConfigOptions) {
      for (const opt of metadata.genericConfigOptions) {
        const val = pref.configOptionValues[opt.id];
        if (val && opt.options.some((o) => o.value === val)) {
          await client.setConfigOption(opt.id, val, sessionId);
        }
      }
    }

    if (pref.modelId) {
      await this.restorePerModelConfigOptions(pref.modelId, agentId, sessionId);
    }
  }

  private getThoughtLevelConfigOptionIds(
    agentId: string,
    sessionId: string
  ): Set<string> {
    const client = this.getClient(agentId);
    const metadata = client?.getSessionMetadata(sessionId);
    const ids = new Set<string>();
    if (metadata?.genericConfigOptions) {
      for (const opt of metadata.genericConfigOptions) {
        if (opt.category === "thought_level" || opt.id === "thought_level") {
          ids.add(opt.id);
        }
      }
    }
    return ids;
  }

  public async restorePerModelConfigOptions(
    modelId: string,
    agentId: string,
    sessionId: string
  ): Promise<void> {
    const client = this.getClient(agentId);
    if (!client) return;

    const pref = this.getAgentPreferences(agentId);
    const metadata = client.getSessionMetadata(sessionId);
    const saved = pref.modelConfigOptionValues?.[modelId];
    if (saved && metadata?.genericConfigOptions) {
      for (const opt of metadata.genericConfigOptions) {
        const val = saved[opt.id];
        if (val && opt.options.some((o) => o.value === val)) {
          await client.setConfigOption(opt.id, val, sessionId);
        }
      }
    }
  }

  public async handleModeChange(
    agentIdOrModeId: string,
    sessionId?: string | null,
    maybeModeId?: string
  ): Promise<void> {
    let agentId = this.acpClient?.getAgentId?.() || this.activeAgentId;
    let targetSessionId = this.activeSessionId;
    let modeId = agentIdOrModeId;

    if (maybeModeId !== undefined) {
      agentId = agentIdOrModeId;
      targetSessionId = sessionId ?? this.activeSessionId;
      modeId = maybeModeId;
    }

    const client = this.getClient(agentId);
    if (client) {
      try {
        await client.setMode(modeId, targetSessionId ?? undefined);
        await this.updateAgentPreference(agentId, (pref) => ({
          ...pref,
          modeId,
        }));
        this.sendSessionMetadata(agentId, targetSessionId ?? undefined);
      } catch (error) {
        console.error("[Chat] Failed to set mode:", error);
      }
    }
  }

  public async handleModelChange(
    agentIdOrModelId: string,
    sessionId?: string | null,
    maybeModelId?: string
  ): Promise<void> {
    let agentId = this.acpClient?.getAgentId?.() || this.activeAgentId;
    let targetSessionId = this.activeSessionId;
    let modelId = agentIdOrModelId;

    if (maybeModelId !== undefined) {
      agentId = agentIdOrModelId;
      targetSessionId = sessionId ?? this.activeSessionId;
      modelId = maybeModelId;
    }

    const client = this.getClient(agentId);
    if (client) {
      try {
        await client.setModel(modelId, targetSessionId ?? undefined);
        await this.updateAgentPreference(agentId, (pref) => ({
          ...pref,
          modelId,
        }));
        await this.restorePerModelConfigOptions(
          modelId,
          agentId,
          targetSessionId!
        );
        this.sendSessionMetadata(agentId, targetSessionId ?? undefined);
      } catch (error) {
        console.error("[Chat] Failed to set model:", error);
      }
    }
  }

  public async handleConfigOptionChange(
    agentIdOrConfigId: string,
    sessionIdOrValue?: string | null,
    maybeConfigId?: string,
    maybeValue?: string
  ): Promise<void> {
    let agentId = this.acpClient?.getAgentId?.() || this.activeAgentId;
    let targetSessionId = this.activeSessionId;
    let configId = agentIdOrConfigId;
    let value = sessionIdOrValue as string;

    if (maybeConfigId !== undefined && maybeValue !== undefined) {
      agentId = agentIdOrConfigId;
      targetSessionId = sessionIdOrValue ?? this.activeSessionId;
      configId = maybeConfigId;
      value = maybeValue;
    }

    const client = this.getClient(agentId);
    if (client) {
      try {
        await client.setConfigOption(
          configId,
          value,
          targetSessionId ?? undefined
        );
        const thoughtLevelIds = this.getThoughtLevelConfigOptionIds(
          agentId,
          targetSessionId!
        );
        await this.updateAgentPreference(agentId, (pref) => {
          const updated: AgentPreference = {
            ...pref,
            configOptionValues: {
              ...pref.configOptionValues,
              [configId]: value,
            },
          };
          if (thoughtLevelIds.has(configId) && pref.modelId) {
            const modelValues = { ...(updated.modelConfigOptionValues ?? {}) };
            modelValues[pref.modelId] = {
              ...(modelValues[pref.modelId] ?? {}),
              [configId]: value,
            };
            updated.modelConfigOptionValues = modelValues;
          }
          return updated;
        });
        this.sendSessionMetadata(agentId, targetSessionId ?? undefined);
      } catch (error) {
        console.error("[Chat] Failed to set config option:", error);
      }
    }
  }

  // -------------------------------------------------------------------
  // Preferences & Helpers
  // -------------------------------------------------------------------

  public getAgentPreferences(agentId?: string): AgentPreference {
    const targetId =
      agentId || this.acpClient?.getAgentId?.() || this.activeAgentId;
    const all =
      (this.globalState.get<AgentPreferences>(
        AGENT_PREFS_KEY
      ) as AgentPreferences) || {};
    return all[targetId] || { configOptionValues: {}, starredModels: [] };
  }

  public async updateAgentPreference(
    agentId: string,
    updater: (current: AgentPreference) => AgentPreference
  ): Promise<void> {
    const targetId =
      agentId || this.acpClient?.getAgentId?.() || this.activeAgentId;
    const all: AgentPreferences = {
      ...((this.globalState.get<AgentPreferences>(
        AGENT_PREFS_KEY
      ) as AgentPreferences) || {}),
    };
    const current = all[targetId] || {
      configOptionValues: {},
      starredModels: [],
    };
    all[targetId] = updater(current);
    await this.globalState.update(AGENT_PREFS_KEY, all);
  }

  public async updateCurrentAgentPreference(
    updater: (current: AgentPreference) => AgentPreference
  ): Promise<void> {
    const targetId = this.acpClient?.getAgentId?.() || this.activeAgentId;
    await this.updateAgentPreference(targetId, updater);
  }

  private handleClearChat(): void {
    this.postMessage({
      type: "chatCleared",
      sessionId: this.activeSessionId ?? undefined,
    });
  }

  private handleStderr(agentId: string, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    const isFatalError =
      /^error:\s/im.test(trimmed) ||
      /^fatal:\s/im.test(trimmed) ||
      /uncaughtexception/i.test(trimmed) ||
      /syntaxerror/i.test(trimmed) ||
      /referenceerror/i.test(trimmed);

    const client = this.agentPool.getExistingClient(agentId);
    const isClientInError = client?.getState() === "error";

    if (isFatalError || isClientInError) {
      const formattedText = trimmed.startsWith(`[${agentId}]`)
        ? trimmed
        : `[${agentId}] ${trimmed}`;
      this.postMessage({
        type: "agentError",
        agentId,
        sessionId: this.activeSessionId ?? undefined,
        text: formattedText,
      });
    }
  }

  public async handlePermissionRequest(
    agentIdOrParams: string | RequestPermissionRequest,
    maybeParams?: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    let agentId = this.activeAgentId;
    let params: RequestPermissionRequest;

    if (typeof agentIdOrParams === "string") {
      agentId = agentIdOrParams;
      params = maybeParams!;
    } else {
      params = agentIdOrParams;
    }

    const autoApprovedKinds = vscode.workspace
      .getConfiguration("vscode-acp-chat")
      .get<string[]>("autoApprovePermissionKinds", []);
    const toolKind = params?.toolCall?.kind;
    if (toolKind && autoApprovedKinds.includes(toolKind)) {
      const options = params.options || [];
      const allowOption =
        options.find((opt) => opt.kind === "allow_once") ??
        options.find((opt) => opt.kind === "allow_always");
      if (allowOption) {
        return {
          outcome: {
            outcome: "selected",
            optionId: allowOption.optionId,
          },
        };
      }
    }

    return new Promise((resolve) => {
      const requestId = `perm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.permissionQueue.push({
        id: requestId,
        agentId,
        params,
        resolver: resolve,
      });

      this.postMessage({
        type: "permissionRequest",
        agentId,
        sessionId: this.activeSessionId ?? undefined,
        requestId,
        toolCallId: params?.toolCall?.toolCallId,
        toolCall: {
          kind: params?.toolCall?.kind || "Unknown",
          title: params?.toolCall?.title || "Tool Call",
        },
        options: (params?.options || []).map((opt) => ({
          optionId: opt.optionId,
          kind: opt.kind,
          name: opt.name,
        })),
      });
    });
  }

  public handleElicitationRequest(
    agentIdOrParams: string | CreateElicitationRequest,
    maybeParams?: CreateElicitationRequest
  ): Promise<CreateElicitationResponse> {
    let agentId = this.activeAgentId;
    let params: CreateElicitationRequest;

    if (typeof agentIdOrParams === "string") {
      agentId = agentIdOrParams;
      params = maybeParams!;
    } else {
      params = agentIdOrParams;
    }

    return new Promise((resolve) => {
      const requestId = `elic-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.elicitationQueue.push({
        id: requestId,
        agentId,
        elicitationId:
          params?.mode === "url"
            ? (params as CreateElicitationRequest & { elicitationId?: string })
                .elicitationId
            : undefined,
        params,
        resolver: resolve,
      });

      this.postMessage({
        type: "elicitationRequest",
        agentId,
        sessionId: this.activeSessionId ?? undefined,
        requestId,
        message: params?.message,
        mode: params?.mode,
        ...(params?.mode === "form"
          ? { schema: params.requestedSchema }
          : params?.mode === "url"
            ? { url: params.url, elicitationId: params.elicitationId }
            : {}),
      });
    });
  }

  public handleElicitationComplete(
    notification: CompleteElicitationNotification
  ): void {
    const pending = this.elicitationQueue.find(
      (p) => p.elicitationId === notification.elicitationId
    );
    if (!pending) return;
    pending.resolver({ action: "accept" });
    this.elicitationQueue = this.elicitationQueue.filter(
      (p) => p.id !== pending.id
    );
    this.postMessage({
      type: "elicitationComplete",
      elicitationId: notification.elicitationId,
    });
  }

  private dismissPendingPermissions(sessionId?: string): void {
    for (const pending of this.permissionQueue) {
      if (!sessionId || pending.sessionId === sessionId) {
        pending.resolver({ outcome: { outcome: "cancelled" } });
      }
    }
    this.permissionQueue = sessionId
      ? this.permissionQueue.filter((p) => p.sessionId !== sessionId)
      : [];
    this.postMessage({ type: "permissionCleared", sessionId });
  }

  private dismissPendingElicitations(sessionId?: string): void {
    for (const pending of this.elicitationQueue) {
      if (!sessionId || pending.sessionId === sessionId) {
        pending.resolver({ action: "cancel" });
      }
    }
    this.elicitationQueue = sessionId
      ? this.elicitationQueue.filter((p) => p.sessionId !== sessionId)
      : [];
    this.postMessage({ type: "elicitationCleared", sessionId });
  }

  private rememberToolCallMetadata(
    update: ToolCallMetadataUpdate,
    agentId?: string,
    sessionId?: string
  ): void {
    let state = this.toolCalls.get(update.toolCallId);
    if (!state) {
      state = { agentId, sessionId };
      this.toolCalls.set(update.toolCallId, state);
    }
    if (update.rawInput)
      state.rawInput = update.rawInput as Record<string, unknown>;
    if (update.rawOutput) state.rawOutput = update.rawOutput;
    if (update.kind) state.kind = update.kind;
    if (update.title) state.title = update.title;
    if (update.content) state.content = update.content;
    if (update.locations) state.locations = update.locations;
  }

  private isFinalToolCall(
    update: ToolCall | ToolCallUpdate
  ): update is FinalToolCallUpdate {
    return update.status === "completed" || update.status === "failed";
  }

  private async handleReviewDiff(path: string): Promise<void> {
    const changes = this.diffManager.getPendingChanges();
    const change = changes.find((c) => c.path === path);
    if (change) {
      const uri = vscode.Uri.file(path);
      if (change.oldText === null) {
        await vscode.window.showTextDocument(uri);
      } else {
        await vscode.commands.executeCommand(
          "vscode.diff",
          vscode.Uri.parse(`acp-old-content:${path}`),
          uri,
          `Diff: ${vscode.workspace.asRelativePath(path)} (Original ↔ Modified)`
        );
      }
    }
  }

  private async handleOpenFile(message: WebviewMessage): Promise<void> {
    let uri: vscode.Uri | undefined;
    let range: { startLine: number; endLine: number } | undefined;

    if (message.href) {
      try {
        const decoded = decodeURIComponent(message.href);
        let target = decoded;
        const hashIndex = target.indexOf("#");
        if (hashIndex !== -1) {
          const frag = target.substring(hashIndex + 1);
          target = target.substring(0, hashIndex);
          range = parseFileLineRange(frag);
        } else {
          const parsed = splitTrailingLineSuffix(target);
          target = parsed.path;
          range = parsed.range;
        }

        if (target.startsWith("file://")) {
          uri = vscode.Uri.parse(target);
        } else if (path.isAbsolute(target)) {
          uri = vscode.Uri.file(target);
        } else {
          const root = getWorkspaceRoot();
          uri = vscode.Uri.file(path.resolve(root, target));
        }
      } catch (err) {
        console.error(
          "[Chat] Failed to parse openFile href:",
          message.href,
          err
        );
      }
    } else if (message.path) {
      const decoded = decodeURIComponent(message.path);
      let target = decoded;
      const parsed = splitTrailingLineSuffix(target);
      target = parsed.path;
      range = parsed.range || message.range;

      if (path.isAbsolute(target)) {
        uri = vscode.Uri.file(target);
      } else {
        const root = getWorkspaceRoot();
        uri = vscode.Uri.file(path.resolve(root, target));
      }
    }

    if (uri) {
      if (message.checkExists) {
        try {
          await vscode.workspace.fs.stat(uri);
        } catch {
          vscode.window.showErrorMessage(
            `File does not exist: ${vscode.workspace.asRelativePath(uri)}`
          );
          return;
        }
      }

      try {
        await vscode.workspace.fs.stat(uri);
        const options: vscode.TextDocumentShowOptions = { preview: true };
        if (range) {
          const start = new vscode.Position(
            Math.max(0, range.startLine - 1),
            0
          );
          const end = new vscode.Position(Math.max(0, range.endLine - 1), 0);
          options.selection = new vscode.Range(start, end);
        }
        await vscode.window.showTextDocument(uri, options);
      } catch {
        await vscode.window.showTextDocument(uri);
      }
    }
  }

  public async showNewChatQuickPick(): Promise<void> {
    const agents = getAgentsWithStatus(true);
    const availableAgents = agents.filter((a) => a.available);

    if (availableAgents.length === 0) {
      vscode.window.showWarningMessage(
        "No available ACP agents found. Please install an agent CLI or configure custom agents in settings."
      );
      return;
    }

    const items = availableAgents.map((a) => ({
      label: a.name,
      description: a.description || (a.custom ? "(Custom Agent)" : a.id),
      detail: a.args?.length ? `${a.command} ${a.args.join(" ")}` : a.command,
      id: a.id,
    }));

    const quickPick = vscode.window.createQuickPick<(typeof items)[number]>();
    quickPick.items = items;
    quickPick.placeholder = "Select an AI agent to start a new session";
    quickPick.title = "VSCode ACP: New Session";

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      quickPick.dispose();
      if (selected) {
        try {
          await this.createNewSession(selected.id);
          await vscode.commands.executeCommand(
            "vscode-acp-chat.chatView.focus"
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Failed to start session: ${message}`);
        }
      }
    });

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
  }

  public async showOpenSessionsQuickPick(): Promise<void> {
    const openSessionsList = Array.from(this.openSessions.values());
    if (openSessionsList.length === 0) {
      vscode.window.showInformationMessage("No open sessions.");
      return;
    }

    type SessionQuickPickItem = vscode.QuickPickItem & {
      sessionId: string;
      agentId: string;
    };

    const buildItems = (): SessionQuickPickItem[] => {
      return Array.from(this.openSessions.values()).map((s) => {
        const isCurrent = s.sessionId === this.activeSessionId;
        return {
          label: `${isCurrent ? "$(check) " : ""}${s.title || "New session"}`,
          description: `[${s.agentName || s.agentId}]`,
          detail: s.sessionId,
          sessionId: s.sessionId,
          agentId: s.agentId,
          buttons: [
            {
              iconPath: new vscode.ThemeIcon("close"),
              tooltip: "Close session",
            },
          ],
        };
      });
    };

    const quickPick = vscode.window.createQuickPick<SessionQuickPickItem>();
    quickPick.items = buildItems();
    quickPick.placeholder = "Select a session to switch or click ✕ to close";
    quickPick.title = "VSCode ACP: Open Sessions";

    // Set default selected / highlighted item to the current session
    const currentItem = quickPick.items.find(
      (item) => item.sessionId === this.activeSessionId
    );
    if (currentItem) {
      quickPick.activeItems = [currentItem];
    }

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      quickPick.dispose();
      if (selected) {
        if (selected.sessionId !== this.activeSessionId) {
          this.activeSessionId = selected.sessionId;
          this.activeAgentId = selected.agentId;
          this.postMessage({
            type: "activeSessionChanged",
            sessionId: selected.sessionId,
          });
          this.sendSessionMetadata(this.activeAgentId, this.activeSessionId);
          this.sendContextUsage(this.activeAgentId, this.activeSessionId);
        }
        await vscode.commands.executeCommand("vscode-acp-chat.chatView.focus");
      }
    });

    quickPick.onDidTriggerItemButton(async (e) => {
      const item = e.item;
      try {
        await this.closeSession(item.agentId, item.sessionId);
        const remainingItems = buildItems();
        quickPick.items = remainingItems;
        if (remainingItems.length === 0) {
          quickPick.dispose();
        } else {
          const newCurrent = remainingItems.find(
            (i) => i.sessionId === this.activeSessionId
          );
          if (newCurrent) {
            quickPick.activeItems = [newCurrent];
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to close session: ${message}`);
      }
    });

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
  }

  public newChat(): void {
    this.showNewChatQuickPick().catch((err) => {
      console.error("[Chat] showNewChatQuickPick failed:", err);
    });
  }

  public clearChat(): void {
    this.handleClearChat();
  }

  public addSelection(selection: SelectionMention): void {
    this.postMessage({
      type: "addMention",
      sessionId: this.activeSessionId ?? undefined,
      mention: {
        type: selection.type,
        name: selection.name,
        path: selection.path,
        content: selection.content,
        range: selection.range,
      },
    });
  }

  private postMessage(message: unknown): void {
    this.webviewPostNotifier.enqueue(async () => {
      try {
        await this.view?.webview.postMessage(message);
      } catch (error) {
        console.warn("[Chat] Failed to post message to webview:", error);
      }
    });
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const styleResetUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "reset.css")
    );
    const styleVSCodeUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "vscode.css")
    );
    const styleMainUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.css")
    );
    const webviewScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")
    );
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "assets", "icon.svg")
    );
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "codicon.css")
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
  <link href="${codiconsUri}" rel="stylesheet">
  <link href="${styleResetUri}" rel="stylesheet">
  <link href="${styleVSCodeUri}" rel="stylesheet">
  <link href="${styleMainUri}" rel="stylesheet">
  <title>VSCode ACP Chat</title>
</head>
<body>
  <div id="welcome-view" class="welcome-view" role="main" aria-label="Welcome">
    <div class="welcome-logo" style="mask-image: url(${logoUri}); -webkit-mask-image: url(${logoUri});" role="img" aria-label="VSCode ACP Logo"></div>
    <h3>Welcome to VSCode ACP</h3>
    <p>Chat with AI coding agents directly in VS Code.</p>
  </div>

  <div id="agent-plan-container"></div>

  <div id="messages-container">
    <div id="messages" role="log" aria-label="Chat messages" aria-live="polite" tabindex="0"></div>
  </div>

  <div id="typing-indicator" class="typing-indicator" aria-hidden="true">
    <div class="zed-loader">
      <div></div><div></div><div></div>
    </div>
  </div>

  <div id="diff-summary-container" class="diff-summary-container"></div>

  <div id="chat-input-area">
    <div id="input-container">
      <div id="command-autocomplete" role="listbox" aria-label="Slash commands"></div>
      <div
        id="input"
        class="input-rich"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        data-placeholder="Ask your agent... (type / for commands, @ for files)"
        aria-label="Message input"
        aria-describedby="input-hint"
        aria-autocomplete="list"
        aria-controls="command-autocomplete"></div>
      <div id="input-hint" class="input-hint">Press Enter to send, Shift+Enter for new line. Type / for commands.</div>
    </div>

    <div id="options-bar" role="toolbar" aria-label="Session options">
      <div id="left-options">
        <button id="attach-image" class="icon-button" aria-label="Attach image" acp-title="Attach image">
          <span class="dropdown-icon codicon codicon-file-media"></span>
        </button>
        <div class="custom-dropdown" id="mode-dropdown" style="display: none;">
          <div class="dropdown-trigger">
            <span class="dropdown-icon codicon codicon-sparkle"></span>
            <span class="selected-label">Mode</span>
            <span class="dropdown-chevron">
              <span class="codicon codicon-chevron-down"></span>
            </span>
          </div>
          <div class="dropdown-popover"></div>
        </div>
        <div class="custom-dropdown" id="model-dropdown" style="display: none;">
          <div class="dropdown-trigger">
            <span class="dropdown-icon codicon codicon-robot"></span>
            <span class="selected-label">Model</span>
            <span class="dropdown-chevron">
              <span class="codicon codicon-chevron-down"></span>
            </span>
          </div>
          <div class="dropdown-popover"></div>
        </div>
        <div id="config-options-container" class="config-options-container"></div>
        <div id="context-usage-ring" class="context-usage" hidden aria-label="Context usage">
          <svg viewBox="0 0 18 18" width="18" height="18" role="img">
            <circle class="context-usage__bg" cx="9" cy="9" r="7"></circle>
            <circle class="context-usage__fg" cx="9" cy="9" r="7" transform="rotate(-90 9 9)"></circle>
          </svg>
        </div>
      </div>
      <div id="right-options">
        <button id="send" class="icon-button" aria-label="Send message" acp-title="Send (Enter)" disabled>
          <span class="dropdown-icon codicon codicon-send"></span>
        </button>
        <button id="stop" class="icon-button" aria-label="Stop generation" acp-title="Stop" style="display: none;">
          <span class="dropdown-icon codicon codicon-debug-stop"></span>
        </button>
      </div>
    </div>
  </div>

  <div id="image-preview-popover" class="image-preview-popover">
    <img src="" alt="Preview">
  </div>

  <script src="${webviewScriptUri}"></script>
</body>
</html>`;
  }
}
