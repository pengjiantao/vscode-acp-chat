import * as vscode from "vscode";
import { spawn } from "child_process";
import { ACPClient } from "../acp/client";
import { getAgent, getFirstAvailableAgent } from "../acp/agents";
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
    | "stop";
  text?: string;
  modeId?: string;
  modelId?: string;
  images?: string[];
  mentions?: Array<{
    name: string;
    path?: string;
    type?: "file" | "selection" | "terminal";
    content?: string;
    range?: { startLine: number; endLine: number };
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

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "vscode-acp.chatView";

  private view?: vscode.WebviewView;
  private hasSession = false;
  private globalState: vscode.Memento;
  private hasRestoredModeModel = false;
  private terminals: Map<string, ManagedTerminal> = new Map();
  private toolCallStartTimes: Map<string, number> = new Map();
  private terminalCounter = 0;
  private permissionQueue: Array<{
    id: string;
    params: RequestPermissionRequest;
    resolver: (response: RequestPermissionResponse) => void;
  }> = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly acpClient: ACPClient,
    globalState: vscode.Memento
  ) {
    this.globalState = globalState;

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
      this.handleSessionUpdate(update);
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
            const files = await vscode.workspace.findFiles(
              `**/*${message.text}*`,
              "**/node_modules/**",
              10
            );
            this.postMessage({
              type: "fileSearchResults",
              results: files.map((f) => ({
                name: vscode.workspace.asRelativePath(f),
                path: f.fsPath,
              })),
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

  public newChat(): void {
    this.postMessage({ type: "triggerNewChat" });
  }

  public clearChat(): void {
    this.postMessage({ type: "triggerClearChat" });
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
        content = new TextDecoder().decode(fileContent);
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

  private async handleWriteTextFile(
    params: WriteTextFileRequest
  ): Promise<WriteTextFileResponse> {
    console.log("[Chat] Writing file:", params.path);
    try {
      const uri = vscode.Uri.file(params.path);
      const content = new TextEncoder().encode(params.content);
      await vscode.workspace.fs.writeFile(uri, content);
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

  public dispose(): void {
    for (const terminal of this.terminals.values()) {
      this.killTerminalProcess(terminal);
      try {
        terminal.terminal?.dispose();
      } catch {}
    }
    this.terminals.clear();
  }

  private handleSessionUpdate(notification: SessionNotification): void {
    const update = notification.update;
    console.log("[Chat] Session update received:", update.sessionUpdate);

    if (update.sessionUpdate === "agent_message_chunk") {
      console.log("[Chat] Chunk content:", JSON.stringify(update.content));
      if (update.content.type === "text") {
        this.postMessage({ type: "streamChunk", text: update.content.text });
      } else {
        console.log("[Chat] Non-text chunk type:", update.content.type);
      }
    } else if (update.sessionUpdate === "tool_call") {
      this.toolCallStartTimes.set(update.toolCallId, Date.now());
      this.postMessage({
        type: "toolCallStart",
        name: update.title,
        toolCallId: update.toolCallId,
        kind: update.kind,
      });
    } else if (update.sessionUpdate === "tool_call_update") {
      if (update.status === "completed" || update.status === "failed") {
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

        const startTime = this.toolCallStartTimes.get(update.toolCallId);
        const duration = startTime ? Date.now() - startTime : undefined;
        this.toolCallStartTimes.delete(update.toolCallId);

        this.postMessage({
          type: "toolCallComplete",
          toolCallId: update.toolCallId,
          title: update.title,
          kind: update.kind,
          content: update.content,
          rawInput: update.rawInput,
          rawOutput: update.rawOutput,
          status: update.status,
          terminalOutput,
          locations: update.locations,
          duration,
        });
      } else {
        // Ensure the tool block is created even if we missed the initial tool_call
        if (!this.toolCallStartTimes.has(update.toolCallId)) {
          this.toolCallStartTimes.set(update.toolCallId, Date.now());
        }
        this.postMessage({
          type: "toolCallStart",
          name: update.title || "Tool",
          toolCallId: update.toolCallId,
          kind: update.kind,
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

  private async handleUserMessage(
    text: string,
    images: string[] = [],
    mentions: Array<{
      name: string;
      path?: string;
      type?: "file" | "selection" | "terminal";
      content?: string;
      range?: { startLine: number; endLine: number };
    }> = []
  ): Promise<void> {
    this.postMessage({ type: "userMessage", text });

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
    this.hasSession = false;
    this.hasRestoredModeModel = false;
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

  <div id="chat-input-area">
    <div id="image-attachments" class="image-attachment-container"></div>
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
