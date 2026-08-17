/* eslint-disable @typescript-eslint/no-explicit-any */
import * as assert from "assert";
import { ChildProcess } from "child_process";
import * as vscode from "vscode";
import {
  ACPClient,
  extractConfigOptions,
  extractModelsAndModesFromConfigOptions,
  type SpawnFunction,
} from "../acp/client";
import { getAgent } from "../acp/agents";
import { createMockProcess } from "./mocks/acp-server";
import type {
  ReadTextFileRequest,
  WriteTextFileRequest,
  CreateTerminalRequest,
  TerminalOutputRequest,
  WaitForTerminalExitRequest,
  KillTerminalRequest,
  ReleaseTerminalRequest,
  SessionConfigOption,
} from "@agentclientprotocol/sdk";

suite("ACPClient", () => {
  let client: ACPClient;

  setup(() => {
    client = new ACPClient();
  });

  teardown(() => {
    client.dispose();
  });

  suite("state management", () => {
    test("should start in disconnected state", () => {
      assert.strictEqual(client.getState(), "disconnected");
      assert.strictEqual(client.isConnected(), false);
    });

    test("should notify on state change", () => {
      const states: string[] = [];
      client.setOnStateChange((state) => states.push(state));
      client.dispose();
      assert.deepStrictEqual(states, []);
    });
  });

  suite("setAgent", () => {
    test("should change agent config", () => {
      const claudeAgent = getAgent("claude-code");
      client.setAgent(claudeAgent!);
      assert.strictEqual(client.getAgentId(), "claude-code");
    });
  });

  suite("session metadata", () => {
    test("should return null when no session exists", () => {
      assert.strictEqual(client.getSessionMetadata(), null);
    });
  });

  suite("dispose", () => {
    test("should reset all state", () => {
      client.dispose();
      assert.strictEqual(client.getState(), "disconnected");
      assert.strictEqual(client.isConnected(), false);
      assert.strictEqual(client.getSessionMetadata(), null);
    });
  });
});

suite("ACPClient with Mock Server", () => {
  let client: ACPClient;
  let mockSpawn: SpawnFunction;
  let debugLogs: string[];

  setup(async () => {
    debugLogs = [];
    mockSpawn = (
      _command: string,
      _args: string[],
      _options: unknown
    ): ChildProcess => {
      return createMockProcess({}) as unknown as ChildProcess;
    };

    await vscode.workspace
      .getConfiguration("vscode-acp-chat")
      .update("debug", true, vscode.ConfigurationTarget.Global);

    client = new ACPClient({
      agentConfig: {
        id: "mock-agent",
        name: "Mock Agent",
        command: "mock",
        args: [],
      },
      spawn: mockSpawn,
      skipAvailabilityCheck: true,
      debugLogger: (message) => debugLogs.push(message),
    });
  });

  teardown(() => {
    client.dispose();
  });

  suite("connect", () => {
    test("should connect to mock server", async () => {
      const states: string[] = [];
      client.setOnStateChange((state) => states.push(state));

      const response = await client.connect();

      assert.strictEqual(client.isConnected(), true);
      assert.strictEqual(client.getState(), "connected");
      assert.ok(response);
      assert.deepStrictEqual(states, ["connecting", "connected"]);
    });

    test("should advertise elicitation client capabilities on initialize", async () => {
      const mockProcess = createMockProcess({});
      const localSpawn: SpawnFunction = () =>
        mockProcess as unknown as ChildProcess;

      const localClient = new ACPClient({
        agentConfig: {
          id: "mock-agent",
          name: "Mock Agent",
          command: "mock",
          args: [],
        },
        spawn: localSpawn,
        skipAvailabilityCheck: true,
      });

      try {
        await localClient.connect();
        const init = (mockProcess as any).mockServer.receivedRequests.find(
          (r: { method: string }) => r.method === "initialize"
        );
        assert.ok(init, "initialize request should have been received");
        assert.deepStrictEqual(
          (init.params as any).clientCapabilities.elicitation,
          { form: {}, url: {} }
        );
      } finally {
        localClient.dispose();
      }
    });

    test("should notify multiple state change listeners", async () => {
      const states1: string[] = [];
      const states2: string[] = [];

      client.setOnStateChange((state) => states1.push(state));
      client.setOnStateChange((state) => states2.push(state));

      await client.connect();

      assert.deepStrictEqual(states1, ["connecting", "connected"]);
      assert.deepStrictEqual(states2, ["connecting", "connected"]);
    });

    test("should allow unsubscribing from state changes", async () => {
      const states1: string[] = [];
      const states2: string[] = [];

      const unsubscribe1 = client.setOnStateChange((state) =>
        states1.push(state)
      );
      client.setOnStateChange((state) => states2.push(state));

      unsubscribe1();
      await client.connect();

      assert.deepStrictEqual(states1, []);
      assert.deepStrictEqual(states2, ["connecting", "connected"]);
    });

    test("dispose clears all listener sets and handlers", async () => {
      client.setOnStateChange(() => {});
      client.setOnSessionUpdate(() => {});
      client.setOnStderr(() => {});
      client.setOnReadTextFile(async () => ({ content: "" }));
      client.setOnWriteTextFile(async () => ({}));
      client.setOnPermissionRequest(async () => null);

      assert.strictEqual((client as any).stateChangeListeners.size, 1);
      assert.strictEqual((client as any).sessionUpdateListeners.size, 1);
      assert.strictEqual((client as any).stderrListeners.size, 1);
      assert.ok((client as any).readTextFileHandler);

      client.dispose();

      assert.strictEqual((client as any).stateChangeListeners.size, 0);
      assert.strictEqual((client as any).sessionUpdateListeners.size, 0);
      assert.strictEqual((client as any).stderrListeners.size, 0);
      assert.strictEqual((client as any).readTextFileHandler, null);
      assert.strictEqual((client as any).writeTextFileHandler, null);
      assert.strictEqual((client as any).permissionRequestListeners.size, 0);
    });

    test("should throw if already connected", async () => {
      await client.connect();

      await assert.rejects(async () => {
        await client.connect();
      }, /Already connected or connecting/);
    });

    test("should pass cwd to spawn options", async () => {
      let capturedOptions: unknown;
      const localSpawn: SpawnFunction = (
        _command: string,
        _args: string[],
        options: unknown
      ): ChildProcess => {
        capturedOptions = options;
        return createMockProcess({}) as unknown as ChildProcess;
      };

      const localClient = new ACPClient({
        agentConfig: {
          id: "mock-agent",
          name: "Mock Agent",
          command: "mock",
          args: [],
        },
        spawn: localSpawn,
        skipAvailabilityCheck: true,
      });

      try {
        await localClient.connect("/workspace/project");
        assert.deepStrictEqual(capturedOptions, {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: "/workspace/project",
          detached: process.platform !== "win32",
          env: (capturedOptions as any).env,
        });
      } finally {
        localClient.dispose();
      }
    });

    test("should allow connect without cwd", async () => {
      let capturedOptions: unknown;
      const localSpawn: SpawnFunction = (
        _command: string,
        _args: string[],
        options: unknown
      ): ChildProcess => {
        capturedOptions = options;
        return createMockProcess({}) as unknown as ChildProcess;
      };

      const localClient = new ACPClient({
        agentConfig: {
          id: "mock-agent",
          name: "Mock Agent",
          command: "mock",
          args: [],
        },
        spawn: localSpawn,
        skipAvailabilityCheck: true,
      });

      try {
        await localClient.connect();
        assert.strictEqual((capturedOptions as any).cwd, undefined);
      } finally {
        localClient.dispose();
      }
    });

    test("should pass DEFAULT_NPX_ENV when command is npx", async () => {
      let capturedOptions: any;
      const localSpawn: SpawnFunction = (
        _command: string,
        _args: string[],
        options: unknown
      ): ChildProcess => {
        capturedOptions = options;
        return createMockProcess({}) as unknown as ChildProcess;
      };

      const localClient = new ACPClient({
        agentConfig: {
          id: "codex",
          name: "Codex CLI",
          command: "npx",
          args: ["-y", "@agentclientprotocol/codex-acp@latest"],
        },
        spawn: localSpawn,
        skipAvailabilityCheck: true,
      });

      try {
        await localClient.connect();
        assert.strictEqual(
          capturedOptions.env.NPM_CONFIG_FETCH_TIMEOUT,
          "10000"
        );
        assert.strictEqual(capturedOptions.env.NO_UPDATE_NOTIFIER, "1");
      } finally {
        localClient.dispose();
      }
    });
  });

  suite("newSession", () => {
    test("should create a new session", async () => {
      await client.connect();
      const response = await client.newSession("/test/dir");

      assert.ok(response.sessionId);
      assert.ok(response.sessionId.startsWith("mock-session-"));

      const metadata = client.getSessionMetadata();
      assert.ok(metadata);
      assert.ok(metadata.modes);
      assert.strictEqual(metadata.modes?.currentModeId, "code");
    });

    test("should sanitize MCP server names for new sessions", async () => {
      await client.connect();
      (client as any).mcpServerConfigs = [
        {
          name: "io.github.ChromeDevTools/chrome-devtools-mcp",
          command: "npx",
          args: ["chrome"],
          env: [],
        },
        {
          name: "io.github.ChromeDevTools chrome-devtools-mcp",
          command: "npx",
          args: ["chrome-copy"],
          env: [],
        },
      ];

      const agentCtx = client.getAgentContext();
      assert.ok(agentCtx, "Agent context should be available");
      const originalRequest = agentCtx.request.bind(agentCtx);
      let capturedMcpServers: Array<{ name: string }> = [];
      agentCtx.request = async (method: string, params: any) => {
        if (method === "session/new") {
          capturedMcpServers = params.mcpServers;
        }
        return originalRequest(method, params);
      };

      try {
        await client.newSession("/test/dir");
      } finally {
        agentCtx.request = originalRequest;
      }

      assert.deepStrictEqual(
        capturedMcpServers.map((server) => server.name),
        [
          "io_github_ChromeDevTools_chrome-devtools-mcp",
          "io_github_ChromeDevTools_chrome-devtools-mcp_2",
        ]
      );
    });

    test("should preserve compatible MCP server names for new sessions", async () => {
      await client.connect();
      (client as any).mcpServerConfigs = [
        {
          name: "chrome-devtools-mcp",
          command: "npx",
          args: ["chrome"],
          env: [],
        },
      ];

      const agentCtx = client.getAgentContext();
      assert.ok(agentCtx, "Agent context should be available");
      const originalRequest = agentCtx.request.bind(agentCtx);
      let capturedMcpServers: Array<{ name: string }> = [];
      agentCtx.request = async (method: string, params: any) => {
        if (method === "session/new") {
          capturedMcpServers = params.mcpServers;
        }
        return originalRequest(method, params);
      };

      try {
        await client.newSession("/test/dir");
      } finally {
        agentCtx.request = originalRequest;
      }

      assert.deepStrictEqual(
        capturedMcpServers.map((server) => server.name),
        ["chrome-devtools-mcp"]
      );
    });

    test("should sanitize MCP server names for loaded sessions", async () => {
      await client.connect();
      (client as any).mcpServerConfigs = [];
      const newSession = await client.newSession("/test/dir");
      (client as any).mcpServerConfigs = [
        {
          name: "io.github.ChromeDevTools/chrome-devtools-mcp",
          command: "npx",
          args: ["chrome"],
          env: [],
        },
      ];

      const agentCtx = client.getAgentContext();
      assert.ok(agentCtx, "Agent context should be available");
      const originalRequest = agentCtx.request.bind(agentCtx);
      let capturedMcpServers: Array<{ name: string }> = [];
      agentCtx.request = async (method: string, params: any) => {
        if (method === "session/load") {
          capturedMcpServers = params.mcpServers;
        }
        return originalRequest(method, params);
      };

      try {
        await client.loadSession({
          sessionId: newSession.sessionId,
          cwd: "/test/dir",
        });
      } finally {
        agentCtx.request = originalRequest;
      }

      assert.deepStrictEqual(
        capturedMcpServers.map((server) => server.name),
        ["io_github_ChromeDevTools_chrome-devtools-mcp"]
      );
    });

    test("should receive available commands update", async () => {
      await client.connect();
      await client.newSession("/test/dir");

      await new Promise((resolve) => setTimeout(resolve, 10));

      const metadata = client.getSessionMetadata();
      assert.ok(metadata);
      assert.ok(metadata.commands);
      assert.strictEqual(metadata.commands?.length, 3);
      assert.strictEqual(metadata.commands?.[0].name, "web");
      assert.strictEqual(metadata.commands?.[0].description, "Search the web");
      assert.strictEqual(metadata.commands?.[0].input?.hint, "query");
      assert.strictEqual(metadata.commands?.[1].name, "test");
      assert.strictEqual(metadata.commands?.[2].name, "plan");
    });

    test("should throw if not connected", async () => {
      await assert.rejects(async () => {
        await client.newSession("/test/dir");
      }, /Not connected/);
    });
  });

  suite("sendMessage", () => {
    test("should send message and receive response", async () => {
      await client.connect();
      await client.newSession("/test/dir");

      const updates: unknown[] = [];
      client.setOnSessionUpdate((update) => {
        updates.push(update);
      });

      const response = await client.sendMessage("Hello");

      assert.strictEqual(response.stopReason, "end_turn");
    });

    test("should notify multiple session update listeners", async () => {
      await client.connect();
      await client.newSession("/test/dir");

      const updates1: unknown[] = [];
      const updates2: unknown[] = [];

      client.setOnSessionUpdate((update) => {
        updates1.push(update);
      });
      client.setOnSessionUpdate((update) => {
        updates2.push(update);
      });

      await client.sendMessage("Hello");

      assert.strictEqual(updates1.length, updates2.length);
    });

    test("logs raw session update JSON when debug logging is enabled by default", async () => {
      await client.connect();
      const updateReceived = new Promise<void>((resolve) => {
        const unsubscribe = client.setOnSessionUpdate(() => {
          unsubscribe();
          resolve();
        });
      });
      await client.newSession("/test/dir");
      await updateReceived;

      const prefix = "[ACP] session/update ";
      const updateLogs = debugLogs.filter((entry) => entry.startsWith(prefix));
      assert.ok(updateLogs.length > 0, "expected raw ACP session update log");
      assert.ok(
        debugLogs.every((entry) => !entry.includes("[ACP] Session update:")),
        "legacy session update summary log should not be emitted"
      );
      assert.ok(
        debugLogs.every((entry) => !entry.includes("[ACP] CHUNK:")),
        "legacy chunk log should not be emitted"
      );

      const payload = JSON.parse(updateLogs[0].slice(prefix.length));
      assert.strictEqual(payload.sessionId, "mock-session-1");
      assert.strictEqual(
        payload.update.sessionUpdate,
        "available_commands_update"
      );
      assert.ok(Array.isArray(payload.update.availableCommands));
    });

    test("should throw if no session", async () => {
      await client.connect();

      await assert.rejects(async () => {
        await client.sendMessage("Hello");
      }, /No active session/);
    });

    test("should format images correctly in prompt", async () => {
      await client.connect();
      await client.newSession("/test/dir");

      // Intercept the agent context's request method to capture the prompt
      const agentCtx = client.getAgentContext();
      assert.ok(agentCtx, "Agent context should be available");
      const originalRequest = agentCtx.request.bind(agentCtx);

      let capturedPrompt: any = null;
      agentCtx.request = async (method: string, params: any) => {
        if (method === "session/prompt") {
          capturedPrompt = params.prompt;
          return { stopReason: "end_turn" };
        }
        return originalRequest(method, params);
      };

      const images = [
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ];

      try {
        await client.sendMessage("Check this image", images);

        assert.strictEqual(capturedPrompt.length, 2);
        assert.strictEqual(capturedPrompt[0].type, "text");
        assert.strictEqual(capturedPrompt[0].text, "Check this image");

        assert.strictEqual(capturedPrompt[1].type, "image");
        assert.strictEqual(capturedPrompt[1].mimeType, "image/png");
        assert.strictEqual(
          capturedPrompt[1].data,
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        );
        // Verify it's NOT nested in an 'image' property
        assert.strictEqual(capturedPrompt[1].image, undefined);
      } finally {
        agentCtx.request = originalRequest;
      }
    });

    test("should use explicit sessionId when passed to sendMessage", async () => {
      await client.connect();
      await client.newSession("/test/dir");

      const agentCtx = (client as unknown as { agentCtx: any }).agentCtx;
      const originalRequest = agentCtx.request;
      let capturedSessionId: string | null = null;
      agentCtx.request = async (method: string, params: any) => {
        if (method === "session/prompt") {
          capturedSessionId = params.sessionId;
          return { stopReason: "end_turn" };
        }
        return originalRequest.call(agentCtx, method, params);
      };

      try {
        await client.sendMessage(
          "Hello session 1",
          [],
          [],
          "explicit-session-id"
        );
        assert.strictEqual(capturedSessionId, "explicit-session-id");
      } finally {
        agentCtx.request = originalRequest;
      }
    });
  });

  suite("setMode", () => {
    test("should change mode", async () => {
      await client.connect();
      await client.newSession("/test/dir");

      await client.setMode("architect");

      const metadata = client.getSessionMetadata();
      assert.strictEqual(metadata?.modes?.currentModeId, "architect");
    });

    test("should throw if no session", async () => {
      await client.connect();

      await assert.rejects(async () => {
        await client.setMode("architect");
      }, /No active session/);
    });
  });

  suite("setModel", () => {
    test("should change model", async () => {
      await client.connect();
      await client.newSession("/test/dir");

      await client.setModel("claude-3-opus");

      const metadata = client.getSessionMetadata();
      assert.strictEqual(metadata?.models?.currentModelId, "claude-3-opus");
    });

    test("should throw if no session", async () => {
      await client.connect();

      await assert.rejects(async () => {
        await client.setModel("claude-3-opus");
      }, /No active session/);
    });
  });

  suite("cancel", () => {
    test("should not throw when cancelling", async () => {
      await client.connect();
      await client.newSession("/test/dir");

      await client.cancel();
    });

    test("should not throw if no session", async () => {
      await client.cancel();
    });
  });

  suite("dispose", () => {
    test("should disconnect and clean up", async () => {
      await client.connect();
      await client.newSession("/test/dir");

      client.dispose();

      assert.strictEqual(client.getState(), "disconnected");
      assert.strictEqual(client.isConnected(), false);
      assert.strictEqual(client.getSessionMetadata(), null);
    });
  });

  suite("process exit", () => {
    test("should transition to disconnected when agent process exits", async () => {
      await client.connect();
      assert.strictEqual(client.getState(), "connected");

      // Simulate process exit by accessing the internal process and emitting 'exit'
      const clientAny = client as any;
      const mockProcess = clientAny.process;
      assert.ok(mockProcess, "Process should exist after connect");

      // Emit exit event to simulate agent process termination
      mockProcess.emit("exit", 0);

      assert.strictEqual(client.getState(), "disconnected");
      assert.strictEqual(client.isConnected(), false);
    });
  });

  suite("file system handlers", () => {
    test("should register readTextFile handler", () => {
      let handlerCalled = false;
      client.setOnReadTextFile(async (_params: ReadTextFileRequest) => {
        handlerCalled = true;
        return { content: "test content" };
      });
      assert.strictEqual(handlerCalled, false);
    });

    test("should register writeTextFile handler", () => {
      let handlerCalled = false;
      client.setOnWriteTextFile(async (_params: WriteTextFileRequest) => {
        handlerCalled = true;
        return {};
      });
      assert.strictEqual(handlerCalled, false);
    });
  });

  suite("terminal handlers", () => {
    test("should register createTerminal handler", () => {
      let handlerCalled = false;
      client.setOnCreateTerminal(async (_params: CreateTerminalRequest) => {
        handlerCalled = true;
        return { terminalId: "test-id" };
      });
      assert.strictEqual(handlerCalled, false);
    });

    test("should register terminalOutput handler", () => {
      let handlerCalled = false;
      client.setOnTerminalOutput(async (_params: TerminalOutputRequest) => {
        handlerCalled = true;
        return { output: "", truncated: false };
      });
      assert.strictEqual(handlerCalled, false);
    });

    test("should register waitForTerminalExit handler", () => {
      let handlerCalled = false;
      client.setOnWaitForTerminalExit(
        async (_params: WaitForTerminalExitRequest) => {
          handlerCalled = true;
          return { exitCode: 0 };
        }
      );
      assert.strictEqual(handlerCalled, false);
    });

    test("should register killTerminalCommand handler", () => {
      let handlerCalled = false;
      client.setOnKillTerminalCommand(async (_params: KillTerminalRequest) => {
        handlerCalled = true;
        return {};
      });
      assert.strictEqual(handlerCalled, false);
    });

    test("should register releaseTerminal handler", () => {
      let handlerCalled = false;
      client.setOnReleaseTerminal(async (_params: ReleaseTerminalRequest) => {
        handlerCalled = true;
        return {};
      });
      assert.strictEqual(handlerCalled, false);
    });
  });
});

suite("extractModelsAndModesFromConfigOptions", () => {
  test("should return null for empty input", () => {
    const result = extractModelsAndModesFromConfigOptions(null);
    assert.strictEqual(result.models, null);
    assert.strictEqual(result.modes, null);
  });

  test("should return null for empty array", () => {
    const result = extractModelsAndModesFromConfigOptions([]);
    assert.strictEqual(result.models, null);
    assert.strictEqual(result.modes, null);
  });

  test("should extract model from select configOption", () => {
    const configOptions: SessionConfigOption[] = [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "anthropic/claude-3-sonnet",
        options: [
          { value: "anthropic/claude-3-sonnet", name: "Claude 3 Sonnet" },
          { value: "anthropic/claude-3-opus", name: "Claude 3 Opus" },
        ],
      },
    ];
    const result = extractModelsAndModesFromConfigOptions(configOptions);
    assert.ok(result.models);
    assert.strictEqual(result.models.availableModels.length, 2);
    assert.strictEqual(
      result.models.availableModels[0].modelId,
      "anthropic/claude-3-sonnet"
    );
    assert.strictEqual(
      result.models.availableModels[0].name,
      "Claude 3 Sonnet"
    );
    assert.strictEqual(
      result.models.currentModelId,
      "anthropic/claude-3-sonnet"
    );
    assert.strictEqual(result.modes, null);
  });

  test("should extract mode from select configOption", () => {
    const configOptions: SessionConfigOption[] = [
      {
        id: "mode",
        name: "Session Mode",
        category: "mode",
        type: "select",
        currentValue: "code",
        options: [
          { value: "code", name: "Code" },
          { value: "architect", name: "Architect" },
        ],
      },
    ];
    const result = extractModelsAndModesFromConfigOptions(configOptions);
    assert.strictEqual(result.models, null);
    assert.ok(result.modes);
    assert.strictEqual(result.modes.availableModes.length, 2);
    assert.strictEqual(result.modes.availableModes[0].id, "code");
    assert.strictEqual(result.modes.availableModes[0].name, "Code");
    assert.strictEqual(result.modes.currentModeId, "code");
  });

  test("should extract both model and mode", () => {
    const configOptions: SessionConfigOption[] = [
      {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "gpt-4",
        options: [{ value: "gpt-4", name: "GPT-4" }],
      },
      {
        id: "mode",
        name: "Mode",
        type: "select",
        currentValue: "build",
        options: [{ value: "build", name: "Build" }],
      },
    ];
    const result = extractModelsAndModesFromConfigOptions(configOptions);
    assert.ok(result.models);
    assert.ok(result.modes);
    assert.strictEqual(result.models.currentModelId, "gpt-4");
    assert.strictEqual(result.modes.currentModeId, "build");
  });

  test("should skip non-select configOptions", () => {
    const configOptions = [
      {
        id: "theme",
        name: "Theme",
        type: "boolean",
        currentValue: true,
      },
    ] as unknown as SessionConfigOption[];
    const result = extractModelsAndModesFromConfigOptions(configOptions);
    assert.strictEqual(result.models, null);
    assert.strictEqual(result.modes, null);
  });

  test("should skip unknown configOption ids", () => {
    const configOptions: SessionConfigOption[] = [
      {
        id: "unknown",
        name: "Unknown",
        type: "select",
        currentValue: "a",
        options: [{ value: "a", name: "A" }],
      },
    ];
    const result = extractModelsAndModesFromConfigOptions(configOptions);
    assert.strictEqual(result.models, null);
    assert.strictEqual(result.modes, null);
  });
});

suite("ACPClient with configOptions format", () => {
  let client: ACPClient;

  setup(() => {
    const mockSpawn = (
      _command: string,
      _args: string[],
      _options: unknown
    ): ChildProcess => {
      return createMockProcess({
        enableLoadSession: true,
        useConfigOptions: true,
      }) as unknown as ChildProcess;
    };

    client = new ACPClient({
      agentConfig: {
        id: "mock-agent",
        name: "Mock Agent",
        command: "mock",
        args: [],
      },
      spawn: mockSpawn,
      skipAvailabilityCheck: true,
    });
  });

  teardown(() => {
    client.dispose();
  });

  test("newSession should extract models/modes from configOptions", async () => {
    await client.connect();
    const response = await client.newSession("/test/dir");

    assert.ok(response.configOptions);
    assert.strictEqual(response.modes, undefined);

    const metadata = client.getSessionMetadata();
    assert.ok(metadata);
    assert.ok(metadata.models);
    assert.ok(metadata.modes);
    assert.strictEqual(
      metadata.models.currentModelId,
      "anthropic/claude-3-sonnet"
    );
    assert.strictEqual(metadata.modes.currentModeId, "code");
    assert.strictEqual(metadata.models.availableModels.length, 2);
    assert.strictEqual(metadata.modes.availableModes.length, 2);
  });

  test("setModel should use setSessionConfigOption and update metadata", async () => {
    await client.connect();
    await client.newSession("/test/dir");

    await client.setModel("anthropic/claude-3-opus");

    const metadata = client.getSessionMetadata();
    assert.ok(metadata);
    assert.ok(metadata.models);
    assert.strictEqual(
      metadata.models.currentModelId,
      "anthropic/claude-3-opus"
    );
  });

  test("setMode should use setSessionConfigOption and update metadata", async () => {
    await client.connect();
    await client.newSession("/test/dir");

    await client.setMode("architect");

    const metadata = client.getSessionMetadata();
    assert.ok(metadata);
    assert.ok(metadata.modes);
    assert.strictEqual(metadata.modes.currentModeId, "architect");
  });

  test("newSession should surface thought_level as a generic config option", async () => {
    await client.connect();
    await client.newSession("/test/dir");

    const metadata = client.getSessionMetadata();
    assert.ok(metadata);
    assert.ok(Array.isArray(metadata.genericConfigOptions));
    const thought = metadata.genericConfigOptions.find(
      (o) => o.id === "thought_level"
    );
    assert.ok(thought, "expected thought_level in genericConfigOptions");
    assert.strictEqual(thought!.category, "thought_level");
    assert.strictEqual(thought!.currentValue, "medium");
    assert.strictEqual(thought!.options.length, 4);
  });

  test("setConfigOption should update generic config option state", async () => {
    await client.connect();
    await client.newSession("/test/dir");

    await client.setConfigOption("thought_level", "high");

    const metadata = client.getSessionMetadata();
    assert.ok(metadata);
    const thought = metadata.genericConfigOptions.find(
      (o) => o.id === "thought_level"
    );
    assert.ok(thought);
    assert.strictEqual(thought!.currentValue, "high");
  });

  suite("closeSession", () => {
    test("should throw if not connected", async () => {
      await assert.rejects(
        () => client.closeSession({ sessionId: "session-1" }),
        /Not connected/
      );
    });

    test("should throw when agent does not support close", async () => {
      const noCloseSpawn = (
        _command: string,
        _args: string[],
        _options: unknown
      ): ChildProcess => {
        return createMockProcess({
          enableCloseSession: false,
        }) as unknown as ChildProcess;
      };

      const noCloseClient = new ACPClient({
        agentConfig: {
          id: "mock-no-close",
          name: "Mock No Close",
          command: "mock",
          args: [],
        },
        spawn: noCloseSpawn,
        skipAvailabilityCheck: true,
      });

      try {
        await noCloseClient.connect();
        const session = await noCloseClient.newSession("/test/dir");

        await assert.rejects(
          () =>
            noCloseClient.closeSession({
              sessionId: session.sessionId,
            }),
          /does not support the "session\/close" capability/
        );
      } finally {
        noCloseClient.dispose();
      }
    });

    test("should close active session and remove from session metadata map", async () => {
      const closeSpawn = (
        _command: string,
        _args: string[],
        _options: unknown
      ): ChildProcess => {
        return createMockProcess({
          enableCloseSession: true,
        }) as unknown as ChildProcess;
      };

      const closeClient = new ACPClient({
        agentConfig: {
          id: "mock-close",
          name: "Mock Close",
          command: "mock",
          args: [],
        },
        spawn: closeSpawn,
        skipAvailabilityCheck: true,
      });

      try {
        await closeClient.connect();
        const session = await closeClient.newSession("/test/dir");

        assert.ok(closeClient.getSessionMetadata(session.sessionId));

        await closeClient.closeSession({ sessionId: session.sessionId });

        assert.strictEqual(
          closeClient.getSessionMetadata(session.sessionId),
          null
        );
      } finally {
        closeClient.dispose();
      }
    });

    test("should not remove other session metadata when closing another session", async () => {
      const closeSpawn = (
        _command: string,
        _args: string[],
        _options: unknown
      ): ChildProcess => {
        return createMockProcess({
          enableCloseSession: true,
        }) as unknown as ChildProcess;
      };

      const closeClient = new ACPClient({
        agentConfig: {
          id: "mock-close",
          name: "Mock Close",
          command: "mock",
          args: [],
        },
        spawn: closeSpawn,
        skipAvailabilityCheck: true,
      });

      try {
        await closeClient.connect();
        const first = await closeClient.newSession("/test/dir");
        const second = await closeClient.newSession("/test/other");

        await closeClient.closeSession({ sessionId: first.sessionId });

        assert.strictEqual(
          closeClient.getSessionMetadata(first.sessionId),
          null
        );
        assert.ok(closeClient.getSessionMetadata(second.sessionId));
      } finally {
        closeClient.dispose();
      }
    });
  });
});

suite("extractConfigOptions", () => {
  test("returns empty generic array for null input", () => {
    const result = extractConfigOptions(null);
    assert.strictEqual(result.models, null);
    assert.strictEqual(result.modes, null);
    assert.deepStrictEqual(result.generic, []);
  });

  test("extracts thought_level into generic with category preserved", () => {
    const configOptions: SessionConfigOption[] = [
      {
        id: "thought_level",
        name: "Thought Level",
        category: "thought_level",
        type: "select",
        currentValue: "medium",
        options: [
          { value: "off", name: "Off" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
        ],
      },
    ];
    const result = extractConfigOptions(configOptions);
    assert.strictEqual(result.models, null);
    assert.strictEqual(result.modes, null);
    assert.strictEqual(result.generic.length, 1);
    assert.strictEqual(result.generic[0].id, "thought_level");
    assert.strictEqual(result.generic[0].category, "thought_level");
    assert.strictEqual(result.generic[0].currentValue, "medium");
    assert.strictEqual(result.generic[0].options.length, 3);
  });

  test("extracts unknown id into generic and leaves model/mode intact", () => {
    const configOptions: SessionConfigOption[] = [
      {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "gpt-4",
        options: [{ value: "gpt-4", name: "GPT-4" }],
      },
      {
        id: "custom_knob",
        name: "Custom Knob",
        type: "select",
        currentValue: "a",
        options: [{ value: "a", name: "A" }],
      },
    ];
    const result = extractConfigOptions(configOptions);
    assert.ok(result.models);
    assert.strictEqual(result.models.currentModelId, "gpt-4");
    assert.strictEqual(result.generic.length, 1);
    assert.strictEqual(result.generic[0].id, "custom_knob");
    assert.strictEqual(result.generic[0].category, null);
  });

  test("backwards-compatible wrapper still returns only models/modes", () => {
    const configOptions: SessionConfigOption[] = [
      {
        id: "thought_level",
        name: "Thought Level",
        category: "thought_level",
        type: "select",
        currentValue: "low",
        options: [{ value: "low", name: "Low" }],
      },
    ];
    const result = extractModelsAndModesFromConfigOptions(configOptions);
    assert.strictEqual(result.models, null);
    assert.strictEqual(result.modes, null);
  });
});
