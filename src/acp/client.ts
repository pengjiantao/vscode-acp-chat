import { ChildProcess, spawn as nodeSpawn, SpawnOptions } from "child_process";
import { Readable, Writable } from "stream";
import * as vscode from "vscode";
import {
  ndJsonStream,
  type ClientConnection,
  type ClientContext,
  type SessionNotification,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type KillTerminalRequest,
  type KillTerminalResponse,
  type ReleaseTerminalRequest,
  type ReleaseTerminalResponse,
  type InitializeResponse,
  type NewSessionResponse,
  type PromptResponse,
  type SessionModeState,
  type SessionConfigOption,
  type AvailableCommand,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type AgentCapabilities,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type McpServer,
  type McpCapabilities,
  type DidOpenDocumentNotification,
  type DidChangeDocumentNotification,
  type DidCloseDocumentNotification,
  type DidSaveDocumentNotification,
  type DidFocusDocumentNotification,
  type Position,
  type Range,
} from "@agentclientprotocol/sdk";
import * as acp from "@agentclientprotocol/sdk";
import {
  type AgentConfig,
  isAgentAvailable,
  getFirstAvailableAgent,
} from "./agents";
import { getGlobalBinPaths } from "../utils/bin-paths";
import {
  serializeMentionsWithContext,
  type Mention,
} from "../utils/mention-serializer";
import {
  getMcpServerConfigs,
  toMcpServerStdio,
  toMcpServerHttp,
  toMcpServerSse,
  type McpServerConfig,
} from "../mcp";

export interface SessionModelState {
  availableModels: Array<{
    modelId: string;
    name: string;
  }>;
  currentModelId: string;
}

export interface GenericConfigOption {
  id: string;
  name: string;
  category: string | null;
  options: Array<{
    value: string;
    name: string;
    description?: string | null;
  }>;
  currentValue: string;
}

export interface SessionMetadata {
  modes: SessionModeState | null;
  models: SessionModelState | null;
  genericConfigOptions: GenericConfigOption[];
  commands: AvailableCommand[] | null;
  lastUsageUpdate?: ContextUsageUpdate | null;
}

export interface ContextUsageUpdate {
  used: number;
  size: number;
  cost?: { amount: number; currency: string } | null;
}

/**
 * Extract models, modes and any other select-type config options from the
 * newer `configOptions` format.
 *
 * The ACP protocol has evolved: older agents return `models` and `modes`
 * directly in session responses, while newer agents (e.g. OpenCode) return
 * a unified `configOptions` array. This function converts the latter into
 * the legacy shapes (for backwards compatibility) and also surfaces any
 * other select config options (e.g. `thought_level`) so the UI can render
 * them as extra dropdowns.
 */
export function extractConfigOptions(
  configOptions: Array<SessionConfigOption> | null | undefined
): {
  models: SessionModelState | null;
  modes: SessionModeState | null;
  generic: GenericConfigOption[];
} {
  if (!configOptions?.length) {
    return { models: null, modes: null, generic: [] };
  }

  let models: SessionModelState | null = null;
  let modes: SessionModeState | null = null;
  const generic: GenericConfigOption[] = [];

  for (const opt of configOptions) {
    if (opt.type !== "select") continue;

    if (opt.id === "model") {
      const flatOptions = flattenSelectOptions(opt.options);
      models = {
        availableModels: flatOptions.map((o) => ({
          modelId: o.value,
          name: o.name || o.value,
        })),
        currentModelId: opt.currentValue,
      };
      continue;
    }
    if (opt.id === "mode") {
      const flatOptions = flattenSelectOptions(opt.options);
      modes = {
        availableModes: flatOptions.map((o) => ({
          id: o.value,
          name: o.name || o.value,
        })),
        currentModeId: opt.currentValue,
      };
      continue;
    }

    const flatOptions = flattenSelectOptions(opt.options);
    generic.push({
      id: opt.id,
      name: opt.name || opt.id,
      category: opt.category ?? null,
      options: flatOptions.map((o) => ({
        value: o.value,
        name: o.name || o.value,
      })),
      currentValue: opt.currentValue,
    });
  }

  return { models, modes, generic };
}

/**
 * Backwards-compatible wrapper around {@link extractConfigOptions} that
 * only returns the model and mode state. Kept for existing callers and
 * tests.
 */
export function extractModelsAndModesFromConfigOptions(
  configOptions: Array<SessionConfigOption> | null | undefined
): { models: SessionModelState | null; modes: SessionModeState | null } {
  const { models, modes } = extractConfigOptions(configOptions);
  return { models, modes };
}

/**
 * Flatten grouped select options into a flat list.
 * Options can be either `SessionConfigSelectOption[]` or `SessionConfigSelectGroup[]`.
 */
function flattenSelectOptions(
  options:
    | Array<{ value: string; name: string }>
    | Array<{
        group: string;
        name: string;
        options: Array<{ value: string; name: string }>;
      }>
): Array<{ value: string; name: string }> {
  if (!options.length) return [];

  // Check if it's grouped (first element has 'group' field)
  if ("group" in options[0]) {
    return (
      options as Array<{
        group: string;
        name: string;
        options: Array<{ value: string; name: string }>;
      }>
    ).flatMap((group) => group.options);
  }

  return options as Array<{ value: string; name: string }>;
}

export type ACPConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

type StateChangeCallback = (state: ACPConnectionState) => void;
type SessionUpdateCallback = (
  update: SessionNotification
) => void | Promise<void>;
type StderrCallback = (data: string) => void;
type ReadTextFileCallback = (
  params: ReadTextFileRequest
) => Promise<ReadTextFileResponse>;
type WriteTextFileCallback = (
  params: WriteTextFileRequest
) => Promise<WriteTextFileResponse>;
type CreateTerminalCallback = (
  params: CreateTerminalRequest
) => Promise<CreateTerminalResponse>;
type TerminalOutputCallback = (
  params: TerminalOutputRequest
) => Promise<TerminalOutputResponse>;
type WaitForTerminalExitCallback = (
  params: WaitForTerminalExitRequest
) => Promise<WaitForTerminalExitResponse>;
type KillTerminalCommandCallback = (
  params: KillTerminalRequest
) => Promise<KillTerminalResponse>;
type ReleaseTerminalCallback = (
  params: ReleaseTerminalRequest
) => Promise<ReleaseTerminalResponse>;
type PermissionCallback = (
  params: RequestPermissionRequest
) => Promise<RequestPermissionResponse | null>;

export type SpawnFunction = (
  command: string,
  args: string[],
  options: SpawnOptions
) => ChildProcess;

export interface ACPClientOptions {
  agentConfig?: AgentConfig;
  spawn?: SpawnFunction;
  skipAvailabilityCheck?: boolean;
}

export class ACPClient {
  private process: ChildProcess | null = null;
  private connectionHandle: ClientConnection | null = null;
  private agentCtx: ClientContext | null = null;
  private state: ACPConnectionState = "disconnected";
  private currentSessionId: string | null = null;
  private sessionMetadata: SessionMetadata | null = null;
  private pendingCommands: AvailableCommand[] | null = null;
  private agentCapabilities: AgentCapabilities | null = null;
  private stateChangeListeners: Set<StateChangeCallback> = new Set();
  private sessionUpdateListeners: Set<SessionUpdateCallback> = new Set();
  private stderrListeners: Set<StderrCallback> = new Set();
  private readTextFileHandler: ReadTextFileCallback | null = null;
  private writeTextFileHandler: WriteTextFileCallback | null = null;
  private createTerminalHandler: CreateTerminalCallback | null = null;
  private terminalOutputHandler: TerminalOutputCallback | null = null;
  private waitForTerminalExitHandler: WaitForTerminalExitCallback | null = null;
  private killTerminalCommandHandler: KillTerminalCommandCallback | null = null;
  private releaseTerminalHandler: ReleaseTerminalCallback | null = null;
  private permissionRequestListeners: Set<PermissionCallback> = new Set();
  private agentConfig: AgentConfig;
  private spawnFn: SpawnFunction;
  private skipAvailabilityCheck: boolean;
  private mcpServerConfigs: McpServerConfig[] = [];

  constructor(options?: ACPClientOptions | AgentConfig) {
    if (options && "id" in options) {
      this.agentConfig = options;
      this.spawnFn = nodeSpawn as SpawnFunction;
      this.skipAvailabilityCheck = false;
    } else {
      this.agentConfig = options?.agentConfig ?? getFirstAvailableAgent();
      this.spawnFn = options?.spawn ?? (nodeSpawn as SpawnFunction);
      this.skipAvailabilityCheck = options?.skipAvailabilityCheck ?? false;
    }
  }

  setAgent(config: AgentConfig): void {
    if (this.state !== "disconnected") {
      this.dispose();
    }
    this.agentConfig = config;
  }

  getAgentId(): string {
    return this.agentConfig.id;
  }

  getAgentName(): string {
    return this.agentConfig.name;
  }

  setOnStateChange(callback: StateChangeCallback): () => void {
    this.stateChangeListeners.add(callback);
    return () => this.stateChangeListeners.delete(callback);
  }

  setOnSessionUpdate(callback: SessionUpdateCallback): () => void {
    this.sessionUpdateListeners.add(callback);
    return () => this.sessionUpdateListeners.delete(callback);
  }

  setOnStderr(callback: StderrCallback): () => void {
    this.stderrListeners.add(callback);
    return () => this.stderrListeners.delete(callback);
  }

  setOnReadTextFile(callback: ReadTextFileCallback): void {
    this.readTextFileHandler = callback;
  }

  setOnWriteTextFile(callback: WriteTextFileCallback): void {
    this.writeTextFileHandler = callback;
  }

  setOnCreateTerminal(callback: CreateTerminalCallback): void {
    this.createTerminalHandler = callback;
  }

  setOnTerminalOutput(callback: TerminalOutputCallback): void {
    this.terminalOutputHandler = callback;
  }

  setOnWaitForTerminalExit(callback: WaitForTerminalExitCallback): void {
    this.waitForTerminalExitHandler = callback;
  }

  setOnKillTerminalCommand(callback: KillTerminalCommandCallback): void {
    this.killTerminalCommandHandler = callback;
  }

  setOnReleaseTerminal(callback: ReleaseTerminalCallback): void {
    this.releaseTerminalHandler = callback;
  }

  setOnPermissionRequest(callback: PermissionCallback): () => void {
    this.permissionRequestListeners.add(callback);
    return () => this.permissionRequestListeners.delete(callback);
  }

  async reloadMcpServers(): Promise<void> {
    const passMcpServers = vscode.workspace
      .getConfiguration("vscode-acp-chat")
      .get<boolean>("passMcpServers", true);
    if (passMcpServers) {
      this.mcpServerConfigs = await getMcpServerConfigs();
      console.log(`[ACP] Loaded ${this.mcpServerConfigs.length} MCP server(s)`);
    } else {
      this.mcpServerConfigs = [];
      console.log(`[ACP] MCP server passthrough disabled, skipping MCP config`);
    }
  }

  isConnected(): boolean {
    return this.state === "connected";
  }

  getState(): ACPConnectionState {
    return this.state;
  }

  private filterAndConvertMcpServers(
    configs: McpServerConfig[],
    mcpCapabilities: McpCapabilities | undefined
  ): McpServer[] {
    const result: McpServer[] = [];

    for (const config of configs) {
      const type = config.type ?? "stdio";
      if (type === "stdio") {
        result.push(toMcpServerStdio(config));
      } else if (type === "http") {
        if (mcpCapabilities?.http) {
          result.push(toMcpServerHttp(config));
        } else {
          console.log(
            `[MCP] Skipping server "${config.name}": agent does not support http transport`
          );
        }
      } else if (type === "sse") {
        if (mcpCapabilities?.sse) {
          result.push(toMcpServerSse(config));
        } else {
          console.log(
            `[MCP] Skipping server "${config.name}": agent does not support sse transport`
          );
        }
      }
    }

    return result;
  }

  async connect(): Promise<InitializeResponse> {
    if (this.state === "connected" || this.state === "connecting") {
      throw new Error("Already connected or connecting");
    }

    if (!this.skipAvailabilityCheck && !isAgentAvailable(this.agentConfig.id)) {
      throw new Error(
        `Agent "${this.agentConfig.name}" is not installed. ` +
          `Please install "${this.agentConfig.command}" and try again.`
      );
    }

    this.setState("connecting");

    try {
      // Build the PATH including global bin directories
      const globalBinPaths = getGlobalBinPaths();
      const pathEnvName = process.platform === "win32" ? "Path" : "PATH";
      const existingPath = process.env[pathEnvName] || "";
      const separator = process.platform === "win32" ? ";" : ":";

      const newPath = [...globalBinPaths, existingPath]
        .filter((p) => !!p)
        .join(separator);

      const currentProcess = this.spawnFn(
        this.agentConfig.command,
        this.agentConfig.args,
        {
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            ...this.agentConfig.env,
            [pathEnvName]: newPath,
          },
        }
      );
      this.process = currentProcess;

      currentProcess.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        console.error("[ACP stderr]", text);
        this.stderrListeners.forEach((cb) => cb(text));
      });

      currentProcess.on("error", (error) => {
        if (this.process !== currentProcess) return;
        console.error("[ACP] Process error:", error);
        this.setState("error");
      });

      currentProcess.on("exit", (code) => {
        if (this.process !== currentProcess) return;
        console.log("[ACP] Process exited with code:", code);
        this.teardownConnection();
        this.process = null;
      });

      const stream = ndJsonStream(
        Writable.toWeb(currentProcess.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(currentProcess.stdout!) as ReadableStream<Uint8Array>
      );

      // Handler implementations for the Client interface
      const handleSessionUpdate = async (
        params: SessionNotification
      ): Promise<void> => {
        const updateType = params.update?.sessionUpdate ?? "unknown";
        console.log(`[ACP] Session update: ${updateType}`);
        if (updateType === "agent_message_chunk") {
          console.log("[ACP] CHUNK:", JSON.stringify(params.update));
        }
        if (updateType === "available_commands_update") {
          const update = params.update as {
            availableCommands: AvailableCommand[];
          };
          if (this.sessionMetadata) {
            this.sessionMetadata.commands = update.availableCommands;
          } else {
            this.pendingCommands = update.availableCommands;
          }
          console.log(
            "[ACP] Commands updated:",
            update.availableCommands.length
          );
        }
        await Promise.all(
          Array.from(this.sessionUpdateListeners).map(async (cb) => {
            try {
              await cb(params);
            } catch (error) {
              console.error("[ACP] Error in session update listener:", error);
            }
          })
        );
      };

      const handleReadTextFile = async (
        params: ReadTextFileRequest
      ): Promise<ReadTextFileResponse> => {
        console.log("[ACP] Read text file request:", params.path);
        if (this.readTextFileHandler) {
          return this.readTextFileHandler(params);
        }
        throw new Error("No readTextFile handler registered");
      };

      const handleWriteTextFile = async (
        params: WriteTextFileRequest
      ): Promise<WriteTextFileResponse> => {
        console.log("[ACP] Write text file request:", params.path);
        if (this.writeTextFileHandler) {
          return this.writeTextFileHandler(params);
        }
        throw new Error("No writeTextFile handler registered");
      };

      const handleCreateTerminal = async (
        params: CreateTerminalRequest
      ): Promise<CreateTerminalResponse> => {
        console.log("[ACP] Create terminal request:", params.command);
        if (this.createTerminalHandler) {
          return this.createTerminalHandler(params);
        }
        throw new Error("No createTerminal handler registered");
      };

      const handleTerminalOutput = async (
        params: TerminalOutputRequest
      ): Promise<TerminalOutputResponse> => {
        console.log("[ACP] Terminal output request:", params.terminalId);
        if (this.terminalOutputHandler) {
          return this.terminalOutputHandler(params);
        }
        throw new Error("No terminalOutput handler registered");
      };

      const handleWaitForTerminalExit = async (
        params: WaitForTerminalExitRequest
      ): Promise<WaitForTerminalExitResponse> => {
        console.log("[ACP] Wait for terminal exit:", params.terminalId);
        if (this.waitForTerminalExitHandler) {
          return this.waitForTerminalExitHandler(params);
        }
        throw new Error("No waitForTerminalExit handler registered");
      };

      const handleKillTerminal = async (
        params: KillTerminalRequest
      ): Promise<KillTerminalResponse> => {
        console.log("[ACP] Kill terminal:", params.terminalId);
        if (this.killTerminalCommandHandler) {
          return this.killTerminalCommandHandler(params);
        }
        throw new Error("No killTerminal handler registered");
      };

      const handleReleaseTerminal = async (
        params: ReleaseTerminalRequest
      ): Promise<ReleaseTerminalResponse> => {
        console.log("[ACP] Release terminal:", params.terminalId);
        if (this.releaseTerminalHandler) {
          return this.releaseTerminalHandler(params);
        }
        throw new Error("No releaseTerminal handler registered");
      };

      // Create client app using new API
      const clientApp = acp
        .client({ name: "vscode-acp-chat" })
        .onRequest(
          acp.methods.client.session.requestPermission,
          (ctx: { params: RequestPermissionRequest }) =>
            this.handleRequestPermission(ctx.params)
        )
        .onNotification(
          acp.methods.client.session.update,
          (ctx: { params: SessionNotification }) =>
            handleSessionUpdate(ctx.params)
        )
        .onRequest(
          acp.methods.client.fs.readTextFile,
          (ctx: { params: ReadTextFileRequest }) =>
            handleReadTextFile(ctx.params)
        )
        .onRequest(
          acp.methods.client.fs.writeTextFile,
          (ctx: { params: WriteTextFileRequest }) =>
            handleWriteTextFile(ctx.params)
        )
        .onRequest(
          acp.methods.client.terminal.create,
          (ctx: { params: CreateTerminalRequest }) =>
            handleCreateTerminal(ctx.params)
        )
        .onRequest(
          acp.methods.client.terminal.output,
          (ctx: { params: TerminalOutputRequest }) =>
            handleTerminalOutput(ctx.params)
        )
        .onRequest(
          acp.methods.client.terminal.waitForExit,
          (ctx: { params: WaitForTerminalExitRequest }) =>
            handleWaitForTerminalExit(ctx.params)
        )
        .onRequest(
          acp.methods.client.terminal.kill,
          (ctx: { params: KillTerminalRequest }) =>
            handleKillTerminal(ctx.params)
        )
        .onRequest(
          acp.methods.client.terminal.release,
          (ctx: { params: ReleaseTerminalRequest }) =>
            handleReleaseTerminal(ctx.params)
        );

      // Connect using new API - returns ClientConnection with .agent for outbound calls
      this.connectionHandle = clientApp.connect(stream);
      const agentCtx = this.connectionHandle!.agent;

      const initResponse = await agentCtx.request(
        acp.methods.agent.initialize,
        {
          protocolVersion: 1,
          clientCapabilities: {
            fs: {
              readTextFile: true,
              writeTextFile: true,
            },
            terminal: true,
          },
          clientInfo: {
            name: "vscode-acp-chat",
            version: "0.0.1",
          },
        }
      );

      // Store agent context for later use
      this.agentCtx = agentCtx;

      this.setState("connected");
      await this.reloadMcpServers();
      this.agentCapabilities = initResponse.agentCapabilities ?? null;
      console.log(
        "[ACP] Agent capabilities:",
        JSON.stringify(this.agentCapabilities, null, 2)
      );
      return initResponse;
    } catch (error) {
      this.setState("error");
      throw error;
    }
  }

  /**
   * Return the agent capabilities as advertised during `initialize`.
   * Returns `null` if not yet connected.
   */
  getAgentCapabilities(): AgentCapabilities | null {
    return this.agentCapabilities;
  }

  /**
   * Return the agent context for making outbound requests.
   * Returns `null` if not yet connected.
   *
   * @internal Exposed as a test seam for intercepting outbound requests.
   */
  getAgentContext(): ClientContext | null {
    return this.agentCtx;
  }

  /**
   * Load an existing session via the ACP `session/load` method.
   *
   * The agent is expected to stream the full conversation history back
   * as `session/notification` messages. The client's session update
   * listeners will receive these notifications just like a live conversation.
   *
   * @throws If not connected or agent doesn't support `loadSession`.
   */
  async loadSession(params: {
    sessionId: string;
    cwd: string;
  }): Promise<LoadSessionResponse> {
    if (!this.agentCtx) {
      throw new Error("Not connected");
    }

    if (!this.agentCapabilities?.loadSession) {
      throw new Error(
        `Agent "${this.agentConfig.name}" does not support the "loadSession" capability`
      );
    }

    const request: LoadSessionRequest = {
      sessionId: params.sessionId,
      cwd: params.cwd,
      mcpServers: this.filterAndConvertMcpServers(
        this.mcpServerConfigs,
        this.agentCapabilities?.mcpCapabilities
      ),
    };

    const response = await this.agentCtx.request(
      acp.methods.agent.session.load,
      request
    );
    this.currentSessionId = params.sessionId;

    // Extract models/modes/generic config options from configOptions if available
    if (response.configOptions) {
      const converted = extractConfigOptions(response.configOptions);
      this.sessionMetadata = {
        modes: converted.modes ?? this.sessionMetadata?.modes ?? null,
        models: converted.models ?? this.sessionMetadata?.models ?? null,
        genericConfigOptions:
          converted.generic.length > 0
            ? converted.generic
            : (this.sessionMetadata?.genericConfigOptions ?? []),
        commands: this.sessionMetadata?.commands ?? null,
      };
    }

    return response;
  }

  /**
   * List existing sessions via the ACP `session/list` method (unstable).
   *
   * @throws If not connected or agent doesn't support `listSessions`.
   */
  async listSessions(params?: {
    cwd?: string;
    cursor?: string;
  }): Promise<ListSessionsResponse> {
    if (!this.agentCtx) {
      throw new Error("Not connected");
    }

    const request: ListSessionsRequest = {
      cwd: params?.cwd ?? null,
      cursor: params?.cursor ?? null,
    };

    return this.agentCtx.request(acp.methods.agent.session.list, request);
  }

  async handleRequestPermission(
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    console.log(
      "[ACP] Permission request received from agent:",
      params.toolCall.title
    );
    console.log("[ACP] Request parameters:", JSON.stringify(params, null, 2));

    // Iterate through listeners
    for (const listener of this.permissionRequestListeners) {
      try {
        const response = await listener(params);
        if (response) {
          console.log(
            "[ACP] Permission handled by listener:",
            response.outcome.outcome
          );
          return response;
        }
      } catch (error) {
        console.error("[ACP] Permission listener error:", error);
      }
    }

    // Default: Auto-approve with the first "allow" option
    const options = params.options || [];
    const allowOption = options.find((opt) => opt.kind.startsWith("allow"));
    if (allowOption) {
      console.log("[ACP] Auto-approving permission with:", allowOption.name);
      return {
        outcome: {
          outcome: "selected",
          optionId: allowOption.optionId,
        },
      };
    }

    // Fallback: Cancel
    console.log("[ACP] No allow option found, cancelling permission request");
    return {
      outcome: {
        outcome: "cancelled",
      },
    };
  }

  async newSession(workingDirectory: string): Promise<NewSessionResponse> {
    if (!this.agentCtx) {
      throw new Error("Not connected");
    }

    const response = await this.agentCtx.request(
      acp.methods.agent.session.new,
      {
        cwd: workingDirectory,
        mcpServers: this.filterAndConvertMcpServers(
          this.mcpServerConfigs,
          this.agentCapabilities?.mcpCapabilities
        ),
      }
    );

    this.currentSessionId = response.sessionId;

    // Prefer configOptions (new ACP format), fall back to models/modes (old format), then existing metadata
    let models: SessionModelState | null = null;
    let modes: SessionModeState | null = null;
    let genericConfigOptions: GenericConfigOption[] = [];

    if (response.configOptions) {
      const converted = extractConfigOptions(response.configOptions);
      models = converted.models;
      modes = converted.modes;
      genericConfigOptions = converted.generic;
    }

    // Fall back to old format if configOptions didn't provide model/mode
    modes = modes ?? response.modes ?? null;

    // Fall back to existing session metadata
    models = models ?? this.sessionMetadata?.models ?? null;
    modes = modes ?? this.sessionMetadata?.modes ?? null;
    if (genericConfigOptions.length === 0) {
      genericConfigOptions = this.sessionMetadata?.genericConfigOptions ?? [];
    }

    this.sessionMetadata = {
      modes,
      models,
      genericConfigOptions,
      commands: this.pendingCommands ?? this.sessionMetadata?.commands ?? null,
    };
    this.pendingCommands = null;

    return response;
  }

  getSessionMetadata(): SessionMetadata | null {
    return this.sessionMetadata;
  }

  setLastUsageUpdate(payload: ContextUsageUpdate): void {
    if (!this.sessionMetadata) return;
    this.sessionMetadata.lastUsageUpdate = {
      used: payload.used,
      size: payload.size,
      cost: payload.cost ?? null,
    };
  }

  clearLastUsageUpdate(): void {
    if (this.sessionMetadata) {
      this.sessionMetadata.lastUsageUpdate = null;
    }
  }

  /**
   * Update session metadata from a configOptions array.
   * Used when receiving `config_option_update` notifications from the agent.
   */
  updateSessionMetadataFromConfigOptions(
    configOptions: Array<SessionConfigOption>
  ): void {
    if (!this.sessionMetadata) return;
    const converted = extractConfigOptions(configOptions);
    if (converted.models) this.sessionMetadata.models = converted.models;
    if (converted.modes) this.sessionMetadata.modes = converted.modes;
    this.sessionMetadata.genericConfigOptions = converted.generic;
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  async setMode(modeId: string): Promise<void> {
    if (!this.agentCtx || !this.currentSessionId) {
      throw new Error("No active session");
    }

    try {
      // Prefer setSessionConfigOption (returns configOptions for metadata update)
      const response = await this.agentCtx.request(
        acp.methods.agent.session.setConfigOption,
        {
          sessionId: this.currentSessionId,
          configId: "mode",
          value: modeId,
        }
      );
      if (response.configOptions) {
        this.updateSessionMetadataFromConfigOptions(response.configOptions);
      }
    } catch {
      // Fallback for agents that don't support setSessionConfigOption
      await this.agentCtx.request(acp.methods.agent.session.setMode, {
        sessionId: this.currentSessionId,
        modeId,
      });
      if (this.sessionMetadata?.modes) {
        this.sessionMetadata.modes.currentModeId = modeId;
      }
    }
  }

  async setModel(modelId: string): Promise<void> {
    if (!this.agentCtx || !this.currentSessionId) {
      throw new Error("No active session");
    }

    // Use setSessionConfigOption (returns configOptions for metadata update)
    const response = await this.agentCtx.request(
      acp.methods.agent.session.setConfigOption,
      {
        sessionId: this.currentSessionId,
        configId: "model",
        value: modelId,
      }
    );
    if (response.configOptions) {
      this.updateSessionMetadataFromConfigOptions(response.configOptions);
    }
  }

  async setConfigOption(configId: string, value: string): Promise<void> {
    if (!this.agentCtx || !this.currentSessionId) {
      throw new Error("No active session");
    }

    const response = await this.agentCtx.request(
      acp.methods.agent.session.setConfigOption,
      {
        sessionId: this.currentSessionId,
        configId,
        value,
      }
    );
    if (response.configOptions) {
      this.updateSessionMetadataFromConfigOptions(response.configOptions);
    }
  }

  async sendMessage(
    message: string,
    images: string[] = [],
    mentions: Mention[] = []
  ): Promise<PromptResponse> {
    if (!this.agentCtx || !this.currentSessionId) {
      throw new Error("No active session");
    }

    try {
      // Use the new serializer to format mentions
      const { cleanText, contextText } = serializeMentionsWithContext(
        message,
        mentions
      );

      // Build prompt items
      const prompt: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [{ type: "text", text: cleanText }];

      // Add images as image prompt items
      for (const base64 of images) {
        const [meta, data] = base64.split(",");
        const mimeType = meta.split(":")[1].split(";")[0];
        prompt.push({
          type: "image",
          data,
          mimeType,
        });
      }

      // Add structured context text if we have mentions
      if (contextText) {
        prompt.push({
          type: "text",
          text: contextText,
        });
      }

      const response: PromptResponse = await this.agentCtx.request(
        acp.methods.agent.session.prompt,
        {
          sessionId: this.currentSessionId,
          prompt,
        }
      );
      console.log("[ACP] Prompt completed:", JSON.stringify(response, null, 2));
      return response;
    } catch (error) {
      console.error("[ACP] Prompt error:", error);
      if (error instanceof Error) {
        console.error("[ACP] Error details:", error.message, error.stack);
      }
      console.error("[ACP] Raw error:", JSON.stringify(error, null, 2));
      throw error;
    }
  }

  async cancel(): Promise<void> {
    if (!this.agentCtx || !this.currentSessionId) {
      return;
    }

    await this.agentCtx.notify(acp.methods.agent.session.cancel, {
      sessionId: this.currentSessionId,
    });
  }

  /**
   * Close and clean up the connection handle and agent context.
   * Called from both process exit handler and dispose().
   * Transitions state to "disconnected" if currently "connected".
   */
  private teardownConnection(): void {
    if (this.connectionHandle) {
      this.connectionHandle.close();
      this.connectionHandle = null;
    }
    this.agentCtx = null;
    if (this.state === "connected") {
      this.setState("disconnected");
    }
  }

  dispose(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.teardownConnection();
    this.currentSessionId = null;
    this.sessionMetadata = null;
    this.pendingCommands = null;
    this.agentCapabilities = null;
  }

  /**
   * Return the NES document event capabilities the agent advertised.
   * Returns an object with boolean flags for each supported event type.
   */
  getNesDocumentCapabilities(): {
    didOpen: boolean;
    didChange: { syncKind: "full" | "incremental" } | null;
    didClose: boolean;
    didSave: boolean;
    didFocus: boolean;
  } {
    const doc = this.agentCapabilities?.nes?.events?.document;
    if (!doc) {
      return {
        didOpen: false,
        didChange: null,
        didClose: false,
        didSave: false,
        didFocus: false,
      };
    }
    return {
      didOpen: !!doc.didOpen,
      didChange: doc.didChange ?? null,
      didClose: !!doc.didClose,
      didSave: !!doc.didSave,
      didFocus: !!doc.didFocus,
    };
  }

  async notifyDidOpenDocument(params: {
    uri: string;
    text: string;
    languageId: string;
    version: number;
  }): Promise<void> {
    if (!this.agentCtx || !this.currentSessionId) {
      return;
    }
    if (!this.getNesDocumentCapabilities().didOpen) {
      return;
    }
    const notification: DidOpenDocumentNotification = {
      sessionId: this.currentSessionId,
      uri: params.uri,
      text: params.text,
      languageId: params.languageId,
      version: params.version,
    };
    await this.agentCtx.notify(
      acp.methods.agent.document.didOpen,
      notification
    );
  }

  async notifyDidChangeDocument(params: {
    uri: string;
    contentChanges: Array<{ range?: Range | null; text: string }>;
    version: number;
  }): Promise<void> {
    if (!this.agentCtx || !this.currentSessionId) {
      return;
    }
    const cap = this.getNesDocumentCapabilities().didChange;
    if (!cap) {
      return;
    }
    const notification: DidChangeDocumentNotification = {
      sessionId: this.currentSessionId,
      uri: params.uri,
      contentChanges: params.contentChanges,
      version: params.version,
    };
    await this.agentCtx.notify(
      acp.methods.agent.document.didChange,
      notification
    );
  }

  async notifyDidCloseDocument(params: { uri: string }): Promise<void> {
    if (!this.agentCtx || !this.currentSessionId) {
      return;
    }
    if (!this.getNesDocumentCapabilities().didClose) {
      return;
    }
    const notification: DidCloseDocumentNotification = {
      sessionId: this.currentSessionId,
      uri: params.uri,
    };
    await this.agentCtx.notify(
      acp.methods.agent.document.didClose,
      notification
    );
  }

  async notifyDidSaveDocument(params: { uri: string }): Promise<void> {
    if (!this.agentCtx || !this.currentSessionId) {
      return;
    }
    if (!this.getNesDocumentCapabilities().didSave) {
      return;
    }
    const notification: DidSaveDocumentNotification = {
      sessionId: this.currentSessionId,
      uri: params.uri,
    };
    await this.agentCtx.notify(
      acp.methods.agent.document.didSave,
      notification
    );
  }

  async notifyDidFocusDocument(params: {
    uri: string;
    position: Position;
    version: number;
    visibleRange: Range;
  }): Promise<void> {
    if (!this.agentCtx || !this.currentSessionId) {
      return;
    }
    if (!this.getNesDocumentCapabilities().didFocus) {
      return;
    }
    const notification: DidFocusDocumentNotification = {
      sessionId: this.currentSessionId,
      uri: params.uri,
      position: params.position,
      version: params.version,
      visibleRange: params.visibleRange,
    };
    await this.agentCtx.notify(
      acp.methods.agent.document.didFocus,
      notification
    );
  }

  private setState(state: ACPConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.stateChangeListeners.forEach((cb) => cb(state));
    }
  }
}
