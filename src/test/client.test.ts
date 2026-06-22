/* eslint-disable @typescript-eslint/no-explicit-any */
import * as assert from "assert";
import { ChildProcess } from "child_process";
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

  setup(() => {
    mockSpawn = (
      _command: string,
      _args: string[],
      _options: unknown
    ): ChildProcess => {
      return createMockProcess({}) as unknown as ChildProcess;
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

    test("should throw if already connected", async () => {
      await client.connect();

      await assert.rejects(async () => {
        await client.connect();
      }, /Already connected or connecting/);
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
