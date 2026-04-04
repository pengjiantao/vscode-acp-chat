import * as vscode from "vscode";
import { spawn } from "child_process";
import { searchWorkspaceFiles } from "../utils/file-search";
import { ACPClient } from "../acp/client";
import { getAgent, getFirstAvailableAgent } from "../acp/agents";
import { DiffManager } from "../acp/diff-manager";
import { AgentSessionManager, type SessionInfo } from "../acp/session-manager";
import {
  extractMentions,
  parseMentionsFromText,
} from "../utils/mention-serializer";
import type {
  SessionNotification,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
  CreateTerminalRequest,
  CreateTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  KillTerminalCommandRequest,
  KillTerminalCommandResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

const SELECTED_AGENT_KEY = "vscode-acp.selectedAgent";
const SELECTED_MODE_KEY = "vscode-acp.selectedMode";
const SELECTED_MODEL_KEY = "vscode-acp.selectedModel";

interface WebviewMessage {
  type:
    | "sendMessage"
    | "ready"
    | "selectMode"
    | "selectModel"
    | "connect"
    | "newChat"
    | "clearChat"
    | "copyMessage"
    | "searchFiles"
    | "openFile"
    | "permissionResponse"
    | "stop"
    | "reviewDiff"
    | "acceptDiff"
    | "rollbackDiff"
    | "acceptAllDiffs"
    | "rollbackAllDiffs";
  text?: string;
  modeId?: string;
  modelId?: string;
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
  requestId?: string;
  outcome?: { outcome: "selected" | "cancelled"; optionId?: string };
}

export interface SelectionMention {
  type: "selection" | "terminal";
  name: string;
  path?: string;
  content: string;
  range?: { startLine: number; endLine: number };
}

interface ManagedTerminal {
  id: string;
  terminal?: vscode.Terminal;
  proc: ReturnType<typeof spawn> | null;
  output: string;
  outputByteLimit: number | null;
  truncated: boolean;
  exitCode: number | null;
  signal: string | null;
  exitPromise: Promise<void>;
  exitResolve: () => void;
}

export class ChatViewProvider
  implements vscode.WebviewViewProvider, vscode.TextDocumentContentProvider
{
  public static readonly viewType = "vscode-acp.chatView";

  private view?: vscode.WebviewView;
  private hasSession = false;
  private globalState: vscode.Memento;
  private hasRestoredModeModel = false;
  private sessionManager: AgentSessionManager;
  private userMessageBuffer: string = "";
  /** Stores image dataUrl for current user message being reconstructed during history load */
  private userMessageImages: string[] = [];
  private terminals: Map<string, ManagedTerminal> = new Map();
  private toolCallStartTimes: Map<string, number> = new Map();
  private toolCallRawInputs: Map<string, any> = new Map();
  private toolCallKinds: Map<string, string> = new Map();
  private toolCallTitles: Map<string, string> = new Map();
  private toolCallBaseContents: Map<string, Promise<string | undefined>> =
    new Map();
  private pendingToolCalls: Set<string> = new Set();
  private terminalCounter = 0;
  private textDecoder = new TextDecoder();
  private textEncoder = new TextEncoder();
  private diffManager: DiffManager;
  private permissionQueue: Array<{
    id: string;
    params: RequestPermissionRequest;
    resolver: (response: RequestPermissionResponse) => void;
  }> = [];
  private sessionUpdateQueue: SessionNotification[] = [];
  private isProcessingQueue = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly acpClient: ACPClient,
    globalState: vscode.Memento
  ) {
    this.globalState = globalState;
    this.diffManager = new DiffManager();
    this.sessionManager = new AgentSessionManager(acpClient);

    vscode.workspace.registerTextDocumentContentProvider(
      "acp-old-content",
      this
    );

    const savedAgentId = this.globalState.get<string>(SELECTED_AGENT_KEY);
    if (savedAgentId) {
      const agent = getAgent(savedAgentId);
      if (agent) {
        this.acpClient.setAgent(agent);
      }
    } else {
      this.acpClient.setAgent(getFirstAvailableAgent());
    }

    this.acpClient.setOnStateChange((state) => {
      this.postMessage({ type: "connectionState", state });
      if (state === "disconnected" || state === "error") {
        this.postMessage({ type: "streamEnd", stopReason: "error" });
        if (this.stderrBuffer.trim().length > 0) {
          const lastLines = this.stderrBuffer
            .trim()
            .split("\n")
            .slice(-5)
            .join("\n");
          this.postMessage({
            type: "agentError",
            text: `Agent process ${state}.\nLast stderr:\n${lastLines}`,
          });
          this.stderrBuffer = "";
        }
      }
    });

    this.acpClient.setOnSessionUpdate((update) => {
      // Queue session updates to ensure they are processed in order
      this.sessionUpdateQueue.push(update);
      this.processSessionUpdateQueue().catch((error) => {
        console.error("[Chat] Error processing session update queue:", error);
      });
    });

    this.acpClient.setOnStderr((text) => {
      this.handleStderr(text);
    });

    this.acpClient.setOnReadTextFile(async (params: ReadTextFileRequest) => {
      return this.handleReadTextFile(params);
    });

    this.acpClient.setOnWriteTextFile(async (params: WriteTextFileRequest) => {
      return this.handleWriteTextFile(params);
    });

    this.acpClient.setOnCreateTerminal(
      async (params: CreateTerminalRequest) => {
        return this.handleCreateTerminal(params);
      }
    );

    this.acpClient.setOnTerminalOutput(
      async (params: TerminalOutputRequest) => {
        return this.handleTerminalOutput(params);
      }
    );

    this.acpClient.setOnWaitForTerminalExit(
      async (params: WaitForTerminalExitRequest) => {
        return this.handleWaitForTerminalExit(params);
      }
    );

    this.acpClient.setOnKillTerminalCommand(
      async (params: KillTerminalCommandRequest) => {
        return this.handleKillTerminalCommand(params);
      }
    );

    this.acpClient.setOnReleaseTerminal(
      async (params: ReleaseTerminalRequest) => {
        return this.handleReleaseTerminal(params);
      }
    );

    this.acpClient.setOnPermissionRequest(
      this.handlePermissionRequest.bind(this)
    );

    this.diffManager.onDidChange((changes) => {
      const config = vscode.workspace.getConfiguration("vscode-acp");
      const enabled = config.get<boolean>("enableDiffSummary", true);
      if (enabled) {
        this.postMessage({
          type: "diffSummary",
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

    this.handleConnect().catch((err) => {
      console.error("[Chat] Auto-connect failed:", err);
    });

    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case "sendMessage":
          if (
            message.text !== undefined ||
            (message.images && message.images.length > 0)
          ) {
            await this.handleUserMessage(
              message.text || "",
              message.images,
              message.mentions
            );
          }
          break;
        case "selectMode":
          if (message.modeId) {
            await this.handleModeChange(message.modeId);
          }
          break;
        case "selectModel":
          if (message.modelId) {
            await this.handleModelChange(message.modelId);
          }
          break;
        case "connect":
          await this.handleConnect();
          break;
        case "newChat":
          await this.handleNewChat();
          break;
        case "clearChat":
          this.handleClearChat();
          break;
        case "copyMessage":
          if (message.text) {
            await vscode.env.clipboard.writeText(message.text);
            vscode.window.showInformationMessage("Message copied to clipboard");
          }
          break;
        case "searchFiles":
          if (message.text !== undefined) {
            const query = message.text;
            // 使用新的搜索工具函数，支持文件和文件夹搜索
            const results = await searchWorkspaceFiles(query, {
              maxResults: 20,
            });

            this.postMessage({
              type: "fileSearchResults",
              results,
            });
          }
          break;
        case "openFile":
          if (message.path) {
            const uri = vscode.Uri.file(message.path);
            await vscode.window.showTextDocument(uri);
          }
          break;
        case "stop":
          await this.acpClient.cancel();
          break;
        case "permissionResponse":
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
        case "reviewDiff":
          if (message.path) {
            await this.handleReviewDiff(message.path);
          }
          break;
        case "acceptDiff":
          if (message.path) {
            this.diffManager.accept(message.path);
          }
          break;
        case "rollbackDiff":
          if (message.path) {
            await this.diffManager.rollback(message.path);
          }
          break;
        case "acceptAllDiffs":
          this.diffManager.acceptAll();
          break;
        case "rollbackAllDiffs":
          await this.diffManager.rollbackAll();
          break;
        case "ready":
          this.postMessage({
            type: "connectionState",
            state: this.acpClient.getState(),
          });
          this.postMessage({
            type: "agentChanged",
            agentId: this.acpClient.getAgentId(),
            agentName: this.acpClient.getAgentName(),
          });
          this.sendSessionMetadata();
          break;
      }
    });
  }

  private async handleReviewDiff(path: string): Promise<void> {
    const changes = this.diffManager.getPendingChanges();
    const change = changes.find((c) => c.path === path);
    if (change) {
      const uri = vscode.Uri.file(path);
      if (change.oldText === null) {
        // New file
        await vscode.window.showTextDocument(uri);
      } else {
        // Modified file - open diff view
        // VS Code doesn't have a direct "diff with string" command that's easy to use here
        // without writing to a temp file.
        // Actually, we can use a custom FileSystemProvider or just use the current disk state.
        // Since we already modified the disk, we need the OLD content to show a diff.

        // Strategy: use a custom TextDocumentContentProvider for the old content

        await vscode.commands.executeCommand(
          "vscode.diff",
          vscode.Uri.parse(`acp-old-content:${path}`),
          uri,
          `Diff: ${vscode.workspace.asRelativePath(path)} (Original ↔ Modified)`
        );
      }
    }
  }

  public newChat(): void {
    this.postMessage({ type: "triggerNewChat" });
  }

  public clearChat(): void {
    this.postMessage({ type: "triggerClearChat" });
  }

  /**
   * List available history sessions for the current agent.
   * Returns an empty array when the agent doesn't support `loadSession`.
   */
  public async listSessions(): Promise<SessionInfo[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const cwd = workspaceFolder?.uri.fsPath || process.cwd();
    return this.sessionManager.listSessions(cwd);
  }

  /**
   * Return whether the current agent supports `loadSession`.
   */
  public getSupportsLoadSession(): boolean {
    return this.sessionManager.supportsLoadSession;
  }

  /**
   * Load a history session. Clears current chat, then loads via ACP.
   * The agent will stream the full conversation history back.
   */
  public async loadHistorySession(sessionId: string): Promise<void> {
    this.userMessageBuffer = "";
    this.userMessageImages = [];
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const cwd = workspaceFolder?.uri.fsPath || process.cwd();

    // Clear the current UI
    this.hasSession = false;
    this.hasRestoredModeModel = false;
    this.clearToolCallMetadata();
    this.diffManager.clear();
    this.postMessage({ type: "chatCleared" });
    this.postMessage({ type: "sessionMetadata", modes: null, models: null });

    try {
      if (!this.acpClient.isConnected()) {
        await this.acpClient.connect();
      }
      this.sessionManager.syncCapabilities();

      await this.sessionManager.loadSession(sessionId, cwd);
      this.flushUserMessageBuffer();
      this.hasSession = true;
      this.sendSessionMetadata();
    } catch (error) {
      console.error("[Chat] Failed to load history session:", error);
      const errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.postMessage({
        type: "error",
        text: `Failed to load history: ${errorMessage}`,
      });
    }
  }

  public addSelection(selection: SelectionMention): void {
    this.postMessage({
      type: "addMention",
      mention: {
        type: selection.type,
        name: selection.name,
        path: selection.path,
        content: selection.content,
        range: selection.range,
      },
    });
  }

  private stderrBuffer = "";

  private handleStderr(text: string): void {
    this.stderrBuffer += text;

    const errorMatch = this.stderrBuffer.match(
      /(\w+Error):\s*(\w+)?\s*\n?\s*data:\s*\{([^}]+)\}/
    );
    if (errorMatch) {
      const errorType = errorMatch[1];
      const errorData = errorMatch[3];
      const providerMatch = errorData.match(/providerID:\s*"([^"]+)"/);
      const modelMatch = errorData.match(/modelID:\s*"([^"]+)"/);

      let message = `Agent error: ${errorType}`;
      if (providerMatch && modelMatch) {
        message = `Model not found: ${providerMatch[1]}/${modelMatch[1]}`;
      }

      this.postMessage({ type: "agentError", text: message });
      this.stderrBuffer = "";
    }

    if (this.stderrBuffer.length > 10000) {
      this.stderrBuffer = this.stderrBuffer.slice(-5000);
    }
  }

  private async handleReadTextFile(
    params: ReadTextFileRequest
  ): Promise<ReadTextFileResponse> {
    console.log("[Chat] Reading file:", params.path);
    try {
      const uri = vscode.Uri.file(params.path);
      const openDoc = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.fsPath === uri.fsPath
      );

      let content: string;
      if (openDoc) {
        content = openDoc.getText();
      } else {
        const fileContent = await vscode.workspace.fs.readFile(uri);
        content = this.textDecoder.decode(fileContent);
      }

      if (params.line !== undefined || params.limit !== undefined) {
        const lines = content.split("\n");
        const startLine = params.line ?? 0;
        const lineLimit = params.limit ?? lines.length;
        const selectedLines = lines.slice(startLine, startLine + lineLimit);
        content = selectedLines.join("\n");
      }

      return { content };
    } catch (error) {
      console.error("[Chat] Failed to read file:", error);
      throw error;
    }
  }

  private lastFileContents: Map<string, string | null> = new Map();

  private async handleWriteTextFile(
    params: WriteTextFileRequest
  ): Promise<WriteTextFileResponse> {
    console.log("[Chat] Writing file:", params.path);
    try {
      const uri = vscode.Uri.file(params.path);

      let oldContent: string | null = null;
      // Capture old content for diffing in webview (fallback for missing tool_call_update)
      try {
        const fileContent = await vscode.workspace.fs.readFile(uri);
        oldContent = this.textDecoder.decode(fileContent);
        this.lastFileContents.set(params.path, oldContent);
      } catch {
        // Use null to indicate a new file (vs undefined which means not yet captured)
        this.lastFileContents.set(params.path, null);
      }

      const content = this.textEncoder.encode(params.content);
      await vscode.workspace.fs.writeFile(uri, content);

      // Record change in diffManager
      this.diffManager.recordChange(params.path, oldContent, params.content);

      return {};
    } catch (error) {
      console.error("[Chat] Failed to write file:", error);
      throw error;
    }
  }

  private async handleCreateTerminal(
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse> {
    console.log("[Chat] Creating terminal for:", params.command);
    const terminalId = `term-${++this.terminalCounter}-${Date.now()}`;

    let exitResolve: () => void = () => {};
    const exitPromise = new Promise<void>((resolve) => {
      exitResolve = resolve;
    });

    const managedTerminal: ManagedTerminal = {
      id: terminalId,
      proc: null,
      output: "",
      outputByteLimit: params.outputByteLimit ?? null,
      truncated: false,
      exitCode: null,
      signal: null,
      exitPromise,
      exitResolve,
    };

    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<number | void>();

    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      onDidClose: closeEmitter.event,
      open: () => {
        const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const cwd =
          params.cwd && params.cwd.trim() !== ""
            ? params.cwd
            : workspaceCwd ||
              process.env.HOME ||
              process.env.USERPROFILE ||
              process.cwd();

        const proc = spawn(params.command, params.args || [], {
          cwd,
          env: {
            ...process.env,
            ...(params.env?.reduce(
              (acc, e) => ({ ...acc, [e.name]: e.value }),
              {}
            ) || {}),
          },
          shell: true,
        });

        managedTerminal.proc = proc;

        proc.stdout?.on("data", (data: Buffer) => {
          const text = data.toString();
          writeEmitter.fire(text.replace(/\n/g, "\r\n"));
          this.appendTerminalOutput(managedTerminal, text);
        });

        proc.stderr?.on("data", (data: Buffer) => {
          const text = data.toString();
          writeEmitter.fire(text.replace(/\n/g, "\r\n"));
          this.appendTerminalOutput(managedTerminal, text);
        });

        proc.on("close", (code: number | null, signal: string | null) => {
          managedTerminal.exitCode = code;
          managedTerminal.signal = signal;
          managedTerminal.exitResolve();
          closeEmitter.fire(code ?? 0);
        });

        proc.on("error", (err: Error) => {
          writeEmitter.fire(`\r\nError: ${err.message}\r\n`);
          managedTerminal.exitCode = 1;
          managedTerminal.exitResolve();
          closeEmitter.fire(1);
        });
      },
      close: () => {
        if (managedTerminal.proc && !managedTerminal.proc.killed) {
          try {
            managedTerminal.proc.kill();
          } catch {}
        }
      },
    };

    const terminal = vscode.window.createTerminal({
      name: `ACP: ${params.command}`,
      pty,
    });

    managedTerminal.terminal = terminal;
    this.terminals.set(terminalId, managedTerminal);

    terminal.show(true);

    return { terminalId };
  }

  private appendTerminalOutput(terminal: ManagedTerminal, text: string): void {
    terminal.output += text;
    if (terminal.outputByteLimit !== null) {
      const byteLength = Buffer.byteLength(terminal.output, "utf8");
      if (byteLength > terminal.outputByteLimit) {
        const encoded = Buffer.from(terminal.output, "utf8");
        const sliced = encoded.slice(-terminal.outputByteLimit);
        terminal.output = sliced.toString("utf8");
        terminal.truncated = true;
      }
    }
  }

  private async handleTerminalOutput(
    params: TerminalOutputRequest
  ): Promise<TerminalOutputResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    const exitStatus =
      terminal.exitCode !== null
        ? {
            exitCode: terminal.exitCode,
            ...(terminal.signal !== null && { signal: terminal.signal }),
          }
        : null;

    return {
      output: terminal.output,
      truncated: terminal.truncated,
      exitStatus,
    };
  }

  private async handleWaitForTerminalExit(
    params: WaitForTerminalExitRequest
  ): Promise<WaitForTerminalExitResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    await terminal.exitPromise;

    return {
      exitCode: terminal.exitCode,
      ...(terminal.signal !== null && { signal: terminal.signal }),
    };
  }

  private killTerminalProcess(terminal: ManagedTerminal): void {
    if (terminal.proc && !terminal.proc.killed) {
      try {
        terminal.proc.kill();
      } catch {}
    }
  }

  private async handleKillTerminalCommand(
    params: KillTerminalCommandRequest
  ): Promise<KillTerminalCommandResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    this.killTerminalProcess(terminal);
    terminal.terminal?.dispose();
    return {};
  }

  private async handleReleaseTerminal(
    params: ReleaseTerminalRequest
  ): Promise<ReleaseTerminalResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) {
      return {};
    }

    this.killTerminalProcess(terminal);
    terminal.terminal?.dispose();
    this.terminals.delete(params.terminalId);
    return {};
  }

  private async handlePermissionRequest(
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    return new Promise((resolve) => {
      const requestId = `perm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      console.log(
        "[Chat] Permission request:",
        params.toolCall?.title,
        params.toolCall?.kind
      );

      // Add to queue
      this.permissionQueue.push({
        id: requestId,
        params,
        resolver: resolve,
      });

      if (params.toolCall?.toolCallId) {
        this.pendingToolCalls.add(params.toolCall.toolCallId);
        this.postMessage({
          type: "toolCallStart",
          name: params.toolCall.title || "Tool",
          toolCallId: params.toolCall.toolCallId,
          kind: params.toolCall.kind,
        });
      }

      // Send to webview
      this.postMessage({
        type: "permissionRequest",
        requestId,
        toolCallId: params.toolCall?.toolCallId,
        toolCall: {
          kind: params.toolCall?.kind || "Unknown",
          title: params.toolCall?.title || "Tool Call",
        },
        options: (params.options || []).map((opt) => ({
          optionId: opt.optionId,
          kind: opt.kind,
          name: opt.name,
        })),
      });

      // Timeout logic
      setTimeout(() => {
        const pending = this.permissionQueue.find((p) => p.id === requestId);
        if (pending) {
          console.log("[Chat] Permission request timeout, cancelling");
          pending.resolver({ outcome: { outcome: "cancelled" } });
          this.permissionQueue = this.permissionQueue.filter(
            (p) => p.id !== requestId
          );
        }
      }, 60000); // 60s timeout
    });
  }

  private clearToolCallMetadata(): void {
    this.toolCallStartTimes.clear();
    this.toolCallRawInputs.clear();
    this.toolCallKinds.clear();
    this.toolCallTitles.clear();
    this.toolCallBaseContents.clear();
    this.lastFileContents.clear();
    this.pendingToolCalls.clear();
  }

  private cleanupToolCall(toolCallId: string): void {
    this.toolCallStartTimes.delete(toolCallId);
    this.toolCallRawInputs.delete(toolCallId);
    this.toolCallKinds.delete(toolCallId);
    this.toolCallTitles.delete(toolCallId);
    this.toolCallBaseContents.delete(toolCallId);
    this.pendingToolCalls.delete(toolCallId);
  }

  public dispose(): void {
    if (this.diffManager) {
      this.diffManager.dispose();
    }
    for (const terminal of this.terminals.values()) {
      this.killTerminalProcess(terminal);
      try {
        terminal.terminal?.dispose();
      } catch {}
    }
    this.terminals.clear();
    this.clearToolCallMetadata();
  }

  /**
   * Process session updates from the queue in order.
   * This ensures that messages are rendered in the correct sequence,
   * even if they arrive rapidly or out of order.
   */
  private async processSessionUpdateQueue(): Promise<void> {
    // Prevent concurrent processing
    if (this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.sessionUpdateQueue.length > 0) {
      const update = this.sessionUpdateQueue.shift()!;
      try {
        await this.handleSessionUpdate(update);
      } catch (error) {
        console.error("[Chat] Error handling session update:", error);
      }
    }

    this.isProcessingQueue = false;
  }

  private async handleSessionUpdate(
    notification: SessionNotification
  ): Promise<void> {
    const update = notification.update;
    console.log("[Chat] Session update received:", update.sessionUpdate);

    // Any non-user chunk should trigger a flush of the user message buffer
    if (update.sessionUpdate !== "user_message_chunk") {
      this.flushUserMessageBuffer();
    }

    // Handle user message chunks (for history session restoration)
    if (update.sessionUpdate === "user_message_chunk") {
      if (update.content.type === "text") {
        this.userMessageBuffer += update.content.text;
      } else if (update.content.type === "image") {
        // Store image dataUrl for later reconstruction during history load
        // This allows us to restore image preview chips if agent supports it
        if (update.content.data && update.content.mimeType) {
          const dataUrl = `data:${update.content.mimeType};base64,${update.content.data}`;
          this.userMessageImages.push(dataUrl);
        }
      }
    } else if (update.sessionUpdate === "agent_message_chunk") {
      if (update.content.type === "text") {
        this.postMessage({ type: "streamChunk", text: update.content.text });
      } else {
        console.log("[Chat] Non-text chunk type:", update.content.type);
      }
    } else if (update.sessionUpdate === "tool_call") {
      this.pendingToolCalls.add(update.toolCallId);
      this.toolCallStartTimes.set(update.toolCallId, Date.now());
      if (update.rawInput) {
        this.toolCallRawInputs.set(update.toolCallId, update.rawInput);
      }
      if (update.kind) {
        this.toolCallKinds.set(update.toolCallId, update.kind);
      }
      if (update.title) {
        this.toolCallTitles.set(update.toolCallId, update.title);
      }

      // Early capture base content for diffing if we have a path
      const path = this.extractPath(update.rawInput);
      if (path) {
        const capturePromise = this.captureBaseContent(
          update.kind,
          update.title,
          update.rawInput
        );
        this.toolCallBaseContents.set(update.toolCallId, capturePromise);
      }

      this.postMessage({
        type: "toolCallStart",
        name: update.title,
        toolCallId: update.toolCallId,
        kind: update.kind,
        rawInput: update.rawInput,
      });

      // Cleanup after 10 minutes to prevent leaks if protocol fails
      setTimeout(() => this.cleanupToolCall(update.toolCallId), 10 * 60 * 1000);
    } else if (update.sessionUpdate === "tool_call_update") {
      if (update.status === "completed" || update.status === "failed") {
        if (!this.pendingToolCalls.has(update.toolCallId)) {
          return;
        }

        let terminalOutput: string | undefined;

        if (update.content && update.content.length > 0) {
          const terminalContent = update.content.find(
            (c: { type: string; terminalId?: string }) => c.type === "terminal"
          );
          if (terminalContent && "terminalId" in terminalContent) {
            terminalOutput = `[Terminal: ${terminalContent.terminalId}]`;
          }
        }

        // Fallback to raw output if no terminal content or explicit output found
        if (
          !terminalOutput &&
          update.rawOutput &&
          typeof update.rawOutput === "object" &&
          "output" in update.rawOutput
        ) {
          terminalOutput = String(update.rawOutput.output);
        }

        // Enrich with diff if it's a file modification and missing
        const rawInput =
          (update.rawInput as any) ||
          this.toolCallRawInputs.get(update.toolCallId);
        const path = this.extractPath(rawInput);

        const kind = update.kind || this.toolCallKinds.get(update.toolCallId);
        const title =
          update.title || this.toolCallTitles.get(update.toolCallId);

        if (
          typeof path === "string" &&
          (kind === "write" ||
            kind === "edit" ||
            title?.toLowerCase().includes("write") ||
            title?.toLowerCase().includes("edit"))
        ) {
          // IMPORTANT: Await the snapshot promise to avoid race conditions
          const oldTextPromise = this.toolCallBaseContents.get(
            update.toolCallId
          );
          let oldText = oldTextPromise ? await oldTextPromise : undefined;

          // Check if tool call was cleaned up while awaiting
          if (!this.pendingToolCalls.has(update.toolCallId)) {
            return;
          }

          // If tool_call notification was missed, toolCallBaseContents might be empty.
          // Try to capture it now before completing the diff.
          if (oldText === undefined && !this.lastFileContents.has(path)) {
            oldText = await this.captureBaseContent(kind, title, rawInput);

            // Re-check after second await
            if (!this.pendingToolCalls.has(update.toolCallId)) {
              return;
            }
          }

          // If tool_call_update arrived after write completed, use the pre-write snapshot
          if (oldText === undefined && this.lastFileContents.has(path)) {
            const captured = this.lastFileContents.get(path);
            oldText = captured ?? undefined; // null becomes undefined for webview
          }
          this.lastFileContents.delete(path);

          const newText =
            rawInput?.content ||
            rawInput?.text ||
            rawInput?.newContent ||
            rawInput?.newText ||
            rawInput?.new_string ||
            rawInput?.replacement ||
            rawInput?.data ||
            rawInput?.text_content ||
            rawInput?.modified_content;

          if (
            newText !== undefined &&
            !update.content?.some((c: any) => c.type === "diff")
          ) {
            update.content = update.content || [];
            update.content.push({
              type: "diff",
              path: path,
              oldText,
              newText: String(newText),
            });
          }
        }

        const startTime = this.toolCallStartTimes.get(update.toolCallId);
        const duration = startTime ? Date.now() - startTime : undefined;

        const finalRawInput =
          update.rawInput || this.toolCallRawInputs.get(update.toolCallId);

        this.postMessage({
          type: "toolCallComplete",
          toolCallId: update.toolCallId,
          title: update.title,
          kind: update.kind,
          content: update.content,
          rawInput: finalRawInput,
          rawOutput: update.rawOutput,
          status: update.status,
          terminalOutput,
          locations: update.locations,
          duration,
        });

        this.cleanupToolCall(update.toolCallId);
      } else {
        // Ensure metadata is always updated from newest notification
        if (update.rawInput) {
          this.toolCallRawInputs.set(update.toolCallId, update.rawInput);
        }
        if (update.kind) {
          this.toolCallKinds.set(update.toolCallId, update.kind);
        }
        if (update.title) {
          this.toolCallTitles.set(update.toolCallId, update.title);
        }

        if (!this.toolCallStartTimes.has(update.toolCallId)) {
          this.toolCallStartTimes.set(update.toolCallId, Date.now());
        }

        // Try to capture base content if we haven't already.
        // We do NOT await here to avoid blocking notification loop.
        if (!this.toolCallBaseContents.has(update.toolCallId)) {
          const kind = update.kind || this.toolCallKinds.get(update.toolCallId);
          const title =
            update.title || this.toolCallTitles.get(update.toolCallId);
          const rawInput =
            update.rawInput || this.toolCallRawInputs.get(update.toolCallId);

          if (this.extractPath(rawInput)) {
            const capturePromise = this.captureBaseContent(
              kind,
              title,
              rawInput
            );
            this.toolCallBaseContents.set(update.toolCallId, capturePromise);
          }
        }

        this.postMessage({
          type: "toolCallStart",
          name:
            update.title ||
            this.toolCallTitles.get(update.toolCallId) ||
            "Tool",
          toolCallId: update.toolCallId,
          kind: update.kind || this.toolCallKinds.get(update.toolCallId),
          rawInput:
            update.rawInput || this.toolCallRawInputs.get(update.toolCallId),
        });
      }
    } else if (update.sessionUpdate === "current_mode_update") {
      this.postMessage({ type: "modeUpdate", modeId: update.currentModeId });
    } else if (update.sessionUpdate === "available_commands_update") {
      this.postMessage({
        type: "availableCommands",
        commands: update.availableCommands,
      });
    } else if (update.sessionUpdate === "plan") {
      this.postMessage({
        type: "plan",
        plan: { entries: update.entries },
      });
    } else if (update.sessionUpdate === "agent_thought_chunk") {
      if (update.content?.type === "text") {
        this.postMessage({
          type: "thoughtChunk",
          text: update.content.text,
        });
      }
    }
  }

  private flushUserMessageBuffer(): void {
    if (this.userMessageBuffer) {
      const { text, mentions } = extractMentions(this.userMessageBuffer);

      // Merge collected image dataUrls into their corresponding mentions
      // This enables image preview chips during history restoration
      if (this.userMessageImages.length > 0) {
        let imageIdx = 0;
        for (const mention of mentions) {
          if (mention.type === "image" && !mention.dataUrl) {
            // Agent provided image chunk - use it for preview
            if (imageIdx < this.userMessageImages.length) {
              mention.dataUrl = this.userMessageImages[imageIdx];
              imageIdx++;
            }
            // If agent didn't provide image chunk, mention.dataUrl stays undefined
            // and the chip will gracefully not show preview (fallback to option C)
          }
        }
      }

      this.postMessage({
        type: "userMessage",
        text,
        mentions,
      });
      this.userMessageBuffer = "";
      this.userMessageImages = [];
      // Ensure thinking block for the next response is properly separated
      this.postMessage({ type: "streamEnd", stopReason: "end_turn" });
    }
  }

  /**
   * Extract mentions from user message content during history session restoration.
   * Parses the structured XML-like mention format to restore mention objects.
   */
  private extractMentionsFromContent(content: any): Array<{
    name: string;
    path?: string;
    type?: "file" | "folder" | "selection" | "terminal" | "image";
    content?: string;
    range?: { startLine: number; endLine: number };
    dataUrl?: string;
  }> {
    if (!content || typeof content !== "object") {
      return [];
    }

    const text = content.text || "";
    return parseMentionsFromText(text);
  }

  private extractPath(rawInput: any): string | undefined {
    return (
      rawInput?.path ||
      rawInput?.file ||
      rawInput?.filePath ||
      rawInput?.file_path ||
      rawInput?.filename ||
      rawInput?.uri ||
      rawInput?.filepath ||
      rawInput?.file_name ||
      rawInput?.target ||
      rawInput?.target_file ||
      rawInput?.destination ||
      rawInput?.destination_path ||
      rawInput?.source ||
      rawInput?.source_path
    );
  }

  private async captureBaseContent(
    kind: string | undefined,
    title: string | undefined,
    rawInput: any
  ): Promise<string | undefined> {
    const path = this.extractPath(rawInput);

    if (
      typeof path === "string" &&
      (kind === "write" ||
        kind === "edit" ||
        title?.toLowerCase().includes("write") ||
        title?.toLowerCase().includes("edit"))
    ) {
      try {
        const uri = vscode.Uri.file(path);
        const fileContent = await vscode.workspace.fs.readFile(uri);
        return this.textDecoder.decode(fileContent);
      } catch (error) {
        if (
          error instanceof vscode.FileSystemError &&
          error.code === "FileNotFound"
        ) {
          // File doesn't exist, it's a new file. No base content.
          return undefined;
        }
        console.error(
          `[Chat] Unexpected error capturing base content for ${path}:`,
          error
        );
        return undefined;
      }
    }
    return undefined;
  }

  private async handleUserMessage(
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
    // Clear history restoration buffer on new user interaction
    this.userMessageBuffer = "";
    this.userMessageImages = [];
    this.postMessage({ type: "userMessage", text, images, mentions });

    try {
      if (!this.acpClient.isConnected()) {
        await this.acpClient.connect();
      }

      if (!this.hasSession) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const workingDir = workspaceFolder?.uri.fsPath || process.cwd();
        await this.acpClient.newSession(workingDir);
        this.hasSession = true;
        this.sendSessionMetadata();
      }

      this.stderrBuffer = "";
      this.postMessage({ type: "streamStart" });
      console.log("[Chat] Sending message to ACP...");
      const response = await this.acpClient.sendMessage(text, images, mentions);
      console.log(
        "[Chat] Prompt response received:",
        JSON.stringify(response, null, 2)
      );

      this.postMessage({
        type: "streamEnd",
        stopReason: response.stopReason,
      });
    } catch (error) {
      console.error("[Chat] Error in handleUserMessage:", error);
      const errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.postMessage({
        type: "error",
        text: `Error: ${errorMessage}`,
      });
      this.postMessage({ type: "streamEnd", stopReason: "error" });
      this.stderrBuffer = "";
    }
  }

  public async switchAgent(agentId: string): Promise<void> {
    await this.handleAgentChange(agentId);
  }

  private async handleAgentChange(agentId: string): Promise<void> {
    const agent = getAgent(agentId);
    if (agent) {
      this.acpClient.setAgent(agent);
      this.globalState.update(SELECTED_AGENT_KEY, agentId);
      this.hasSession = false;
      this.diffManager.clear();
      this.sessionManager.syncCapabilities();
      this.postMessage({
        type: "agentChanged",
        agentId,
        agentName: agent.name,
      });
      this.postMessage({ type: "sessionMetadata", modes: null, models: null });

      try {
        await this.handleConnect();
      } catch (error) {
        console.error(
          "[Chat] Auto-reconnect failed after agent change:",
          error
        );
      }
    }
  }

  private async handleModeChange(modeId: string): Promise<void> {
    try {
      await this.acpClient.setMode(modeId);
      await this.globalState.update(SELECTED_MODE_KEY, modeId);
      this.sendSessionMetadata();
    } catch (error) {
      console.error("[Chat] Failed to set mode:", error);
    }
  }

  private async handleModelChange(modelId: string): Promise<void> {
    try {
      await this.acpClient.setModel(modelId);
      await this.globalState.update(SELECTED_MODEL_KEY, modelId);
      this.sendSessionMetadata();
    } catch (error) {
      console.error("[Chat] Failed to set model:", error);
    }
  }

  private async handleConnect(): Promise<void> {
    try {
      if (!this.acpClient.isConnected()) {
        await this.acpClient.connect();
      }
      this.sessionManager.syncCapabilities();
      if (!this.hasSession) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const workingDir = workspaceFolder?.uri.fsPath || process.cwd();
        await this.acpClient.newSession(workingDir);
        this.hasSession = true;
        this.sendSessionMetadata();
      }
    } catch (error) {
      this.postMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to connect",
      });
    }
  }

  private async handleNewChat(): Promise<void> {
    this.userMessageBuffer = "";
    this.hasSession = false;
    this.hasRestoredModeModel = false;
    this.clearToolCallMetadata();
    this.diffManager.clear();
    this.postMessage({ type: "chatCleared" });
    this.postMessage({ type: "sessionMetadata", modes: null, models: null });

    try {
      if (this.acpClient.isConnected()) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const workingDir = workspaceFolder?.uri.fsPath || process.cwd();
        await this.acpClient.newSession(workingDir);
        this.hasSession = true;
        this.sendSessionMetadata();
      }
    } catch (error) {
      console.error("[Chat] Failed to create new session:", error);
    }
  }

  private handleClearChat(): void {
    this.postMessage({ type: "chatCleared" });
  }

  private sendSessionMetadata(): void {
    const metadata = this.acpClient.getSessionMetadata();
    this.postMessage({
      type: "sessionMetadata",
      modes: metadata?.modes ?? null,
      models: metadata?.models ?? null,
      commands: metadata?.commands ?? null,
    });

    if (!this.hasRestoredModeModel && this.hasSession) {
      this.hasRestoredModeModel = true;
      this.restoreSavedModeAndModel().catch((error) =>
        console.warn("[Chat] Failed to restore saved mode/model:", error)
      );
    }
  }

  private async restoreSavedModeAndModel(): Promise<void> {
    const metadata = this.acpClient.getSessionMetadata();
    const availableModes = Array.isArray(metadata?.modes?.availableModes)
      ? metadata.modes.availableModes
      : [];
    const availableModels = Array.isArray(metadata?.models?.availableModels)
      ? metadata.models.availableModels
      : [];

    const savedModeId = this.globalState.get<string>(SELECTED_MODE_KEY);
    const savedModelId = this.globalState.get<string>(SELECTED_MODEL_KEY);

    let modeRestored = false;
    let modelRestored = false;

    if (
      savedModeId &&
      availableModes.some(
        (mode: { id: string }) => mode && mode.id === savedModeId
      )
    ) {
      await this.acpClient.setMode(savedModeId);
      console.log(`[Chat] Restored mode: ${savedModeId}`);
      modeRestored = true;
    }

    if (
      savedModelId &&
      availableModels.some(
        (model: { modelId: string }) => model && model.modelId === savedModelId
      )
    ) {
      await this.acpClient.setModel(savedModelId);
      console.log(`[Chat] Restored model: ${savedModelId}`);
      modelRestored = true;
    }

    if (modeRestored || modelRestored) {
      this.postMessage({ type: "sessionMetadata", ...metadata });
    }
  }

  private postMessage(message: Record<string, unknown>): void {
    this.view?.webview.postMessage(message);
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

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
  <link href="${styleResetUri}" rel="stylesheet">
  <link href="${styleVSCodeUri}" rel="stylesheet">
  <link href="${styleMainUri}" rel="stylesheet">
  <title>VSCode ACP Chat</title>
</head>
<body>
  <div id="welcome-view" class="welcome-view" role="main" aria-label="Welcome">
    <img src="${logoUri}" alt="VSCode ACP Logo" class="welcome-logo">
    <h3>Welcome to VSCode ACP</h3>
    <p>Chat with AI coding agents directly in VS Code.</p>
  </div>

  <div id="agent-plan-container"></div>

  <div id="messages" role="log" aria-label="Chat messages" aria-live="polite" tabindex="0"></div>

  <div id="typing-indicator" class="typing-indicator" aria-hidden="true">
    <div class="zed-loader">
      <div></div><div></div><div></div><div></div>
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
        <button id="attach-image" class="icon-button" aria-label="Attach image" title="Attach image">
          <span class="dropdown-icon icon-image"></span>
        </button>
        <div class="custom-dropdown" id="mode-dropdown" style="display: none;">
          <div class="dropdown-trigger">
            <span class="dropdown-icon icon-sparkle"></span>
            <span class="selected-label">Mode</span>
            <span class="dropdown-chevron">
              <span class="icon-chevron-down" style="width: 10px; height: 10px; display: block;"></span>
            </span>
          </div>
          <div class="dropdown-popover"></div>
        </div>
        <div class="custom-dropdown" id="model-dropdown" style="display: none;">
          <div class="dropdown-trigger">
            <span class="dropdown-icon icon-robot"></span>
            <span class="selected-label">Model</span>
            <span class="dropdown-chevron">
              <span class="icon-chevron-down" style="width: 10px; height: 10px; display: block;"></span>
            </span>
          </div>
          <div class="dropdown-popover"></div>
        </div>
      </div>
      <div id="right-options">
        <button id="send" class="icon-button" aria-label="Send message" title="Send (Enter)" disabled>
          <span class="dropdown-icon icon-send"></span>
        </button>
        <button id="stop" class="icon-button" aria-label="Stop generation" title="Stop" style="display: none;">
          <span class="dropdown-icon icon-stop"></span>
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
