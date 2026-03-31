import * as vscode from "vscode";
import { spawn } from "child_process";
import { marked } from "marked";
import { ACPClient } from "../acp/client";
import {
  getAgent,
  getAgentsWithStatus,
  getFirstAvailableAgent,
} from "../acp/agents";
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
} from "@agentclientprotocol/sdk";

marked.setOptions({
  breaks: true,
  gfm: true,
});

const SELECTED_AGENT_KEY = "vscode-acp.selectedAgent";
const SELECTED_MODE_KEY = "vscode-acp.selectedMode";
const SELECTED_MODEL_KEY = "vscode-acp.selectedModel";

interface WebviewMessage {
  type:
    | "sendMessage"
    | "ready"
    | "selectAgent"
    | "selectMode"
    | "selectModel"
    | "connect"
    | "newChat"
    | "clearChat"
    | "copyMessage";
  text?: string;
  agentId?: string;
  modeId?: string;
  modelId?: string;
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
  private streamingText = "";
  private hasRestoredModeModel = false;
  private terminals: Map<string, ManagedTerminal> = new Map();
  private terminalCounter = 0;

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
        case "sendMessage":
          if (message.text) {
            await this.handleUserMessage(message.text);
          }
          break;
        case "selectAgent":
          if (message.agentId) {
            this.handleAgentChange(message.agentId);
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
        case "ready":
          this.postMessage({
            type: "connectionState",
            state: this.acpClient.getState(),
          });
          const agentsWithStatus = getAgentsWithStatus();
          this.postMessage({
            type: "agents",
            agents: agentsWithStatus.map((a) => ({
              id: a.id,
              name: a.name,
              available: a.available,
            })),
            selected: this.acpClient.getAgentId(),
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
        this.streamingText += update.content.text;
        this.postMessage({ type: "streamChunk", text: update.content.text });
      } else {
        console.log("[Chat] Non-text chunk type:", update.content.type);
      }
    } else if (update.sessionUpdate === "tool_call") {
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

  private async handleUserMessage(text: string): Promise<void> {
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

      this.streamingText = "";
      this.stderrBuffer = "";
      this.postMessage({ type: "streamStart" });
      console.log("[Chat] Sending message to ACP...");
      const response = await this.acpClient.sendMessage(text);
      console.log(
        "[Chat] Prompt response received:",
        JSON.stringify(response, null, 2)
      );

      if (this.streamingText.length === 0) {
        console.warn("[Chat] No streaming text received from agent");
        console.warn("[Chat] stderr buffer:", this.stderrBuffer);
        console.warn("[Chat] Response:", JSON.stringify(response, null, 2));
        this.postMessage({
          type: "error",
          text: "Agent returned no response. Check the ACP output channel for details.",
        });
        this.postMessage({ type: "streamEnd", stopReason: "error", html: "" });
      } else {
        const renderedHtml = marked.parse(this.streamingText) as string;
        this.postMessage({
          type: "streamEnd",
          stopReason: response.stopReason,
          html: renderedHtml,
        });
      }
      this.streamingText = "";
    } catch (error) {
      console.error("[Chat] Error in handleUserMessage:", error);
      const errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.postMessage({
        type: "error",
        text: `Error: ${errorMessage}`,
      });
      this.postMessage({ type: "streamEnd", stopReason: "error", html: "" });
      this.streamingText = "";
      this.stderrBuffer = "";
    }
  }

  private handleAgentChange(agentId: string): void {
    const agent = getAgent(agentId);
    if (agent) {
      this.acpClient.setAgent(agent);
      this.globalState.update(SELECTED_AGENT_KEY, agentId);
      this.hasSession = false;
      this.postMessage({ type: "agentChanged", agentId });
      this.postMessage({ type: "sessionMetadata", modes: null, models: null });
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
    this.streamingText = "";
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
      availableModes.some((mode: any) => mode && mode.id === savedModeId)
    ) {
      await this.acpClient.setMode(savedModeId);
      console.log(`[Chat] Restored mode: ${savedModeId}`);
      modeRestored = true;
    }

    if (
      savedModelId &&
      availableModels.some(
        (model: any) => model && model.modelId === savedModelId
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

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};">
  <link href="${styleResetUri}" rel="stylesheet">
  <link href="${styleVSCodeUri}" rel="stylesheet">
  <link href="${styleMainUri}" rel="stylesheet">
  <title>VSCode ACP Chat</title>
</head>
<body>
  <div id="top-bar" role="toolbar" aria-label="Chat controls">
    <span class="status-indicator" role="status" aria-live="polite">
      <span class="status-dot" id="status-dot" aria-hidden="true"></span>
      <span id="status-text">Disconnected</span>
    </span>
    <button id="connect-btn" aria-label="Connect to agent">Connect</button>
    <div class="custom-dropdown inline-dropdown" id="agent-dropdown" aria-label="Select AI agent">
      <div class="dropdown-trigger">
        <span class="selected-label">Select Agent</span>
        <span class="dropdown-chevron">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M13.078 5.672L8 10.75 2.922 5.672l.703-.703L8 9.344l4.375-4.375.703.703z"/></svg>
        </span>
      </div>
      <div class="dropdown-popover"></div>
    </div>
  </div>

  <div id="welcome-view" class="welcome-view" role="main" aria-label="Welcome">
    <h3>Welcome to VSCode ACP</h3>
    <p>Chat with AI coding agents directly in VS Code.</p>
    <button class="welcome-btn" id="welcome-connect-btn">Connect to Agent</button>
    <p class="help-links">
      <a href="https://github.com/sst/opencode" target="_blank" rel="noopener">Install OpenCode</a>
      <span aria-hidden="true">·</span>
      <a href="https://claude.ai/code" target="_blank" rel="noopener">Install Claude Code</a>
    </p>
  </div>

  <div id="agent-plan-container"></div>

  <div id="messages" role="log" aria-label="Chat messages" aria-live="polite" tabindex="0"></div>

  <div id="chat-input-area">
    <div id="input-container">
      <div id="command-autocomplete" role="listbox" aria-label="Slash commands"></div>
      <textarea
        id="input"
        rows="1"
        placeholder="Ask your agent... (type / for commands)"
        aria-label="Message input"
        aria-describedby="input-hint"
        aria-autocomplete="list"
        aria-controls="command-autocomplete"
      ></textarea>
    </div>

    <div id="options-bar" role="toolbar" aria-label="Session options">
      <div id="left-options">
        <div class="custom-dropdown" id="mode-dropdown" style="display: none;">
          <div class="dropdown-trigger">
            <span class="dropdown-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M9.1 4.4L8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.9.8 1.3 2-.3.7-2.4.5V8.6l2.4.5.3.7-1.3 2 .9.8 2-1.3.7.3.5 2.4h1.2l.5-2.4.7-.3 2 1.3.9-.8-1.3-2 .3-.7 2.4-.5V7.4l-2.4-.5-.3-.7 1.3-2-.9-.8-2 1.3-.7-.3zM8 10c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>
            </span>
            <span class="selected-label">Mode</span>
            <span class="dropdown-chevron">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M13.078 5.672L8 10.75 2.922 5.672l.703-.703L8 9.344l4.375-4.375.703.703z"/></svg>
            </span>
          </div>
          <div class="dropdown-popover"></div>
        </div>
        <div class="custom-dropdown" id="model-dropdown" style="display: none;">
          <div class="dropdown-trigger">
            <span class="dropdown-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12 4.5v-1a.5.5 0 0 0-.5-.5h-2v-.5a.5.5 0 0 0-.5-.5h-2a.5.5 0 0 0-.5.5v.5h-2a.5.5 0 0 0-.5.5v1A2.5 2.5 0 0 0 2 7v5a2.5 2.5 0 0 0 2.5 2.5h7a2.5 2.5 0 0 0 2.5-2.5V7a2.5 2.5 0 0 0-2.146-2.5zm-5-1h2v.5h-2v-.5zM13 12a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 12V7a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 13 7v5zm-7-4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm6 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM5 10.5h6v1H5v-1z"/></svg>
            </span>
            <span class="selected-label">Model</span>
            <span class="dropdown-chevron">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M13.078 5.672L8 10.75 2.922 5.672l.703-.703L8 9.344l4.375-4.375.703.703z"/></svg>
            </span>
          </div>
          <div class="dropdown-popover"></div>
        </div>
      </div>
      <div id="right-options">
        <button id="send" aria-label="Send message" title="Send (Enter)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M15.854.146a.5.5 0 0 0-.525-.104l-15 6a.5.5 0 0 0 .011.934l5.968.852.852 5.968a.5.5 0 0 0 .934.011l6-15a.5.5 0 0 0-.24-.661zM7.5 13.56 6.75 8.25 1.44 7.5l11.06-4.424-5 5.001a.5.5 0 0 0 .707.707l5-5-4.424 11.06-.283.707z"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
  <span id="input-hint" class="sr-only">Press Enter to send, Shift+Enter for new line, Escape to clear. Type / for slash commands.</span>

<script src="${webviewScriptUri}"></script>
</body>
</html>`;
  }
}
