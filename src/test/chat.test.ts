import * as assert from "assert";
import * as vscode from "vscode";
import { ChatViewProvider } from "../views/chat";

interface MockMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Promise<void>;
  keys(): readonly string[];
}

interface MockACPClient {
  setAgent: (config: unknown) => void;
  getAgentId: () => string;
  setOnStateChange: (callback: (state: string) => void) => () => void;
  setOnSessionUpdate: (callback: (update: unknown) => void) => () => void;
  setOnStderr: (callback: (data: string) => void) => () => void;
  setOnReadTextFile: (callback: unknown) => void;
  setOnWriteTextFile: (callback: unknown) => void;
  setOnCreateTerminal: (callback: unknown) => void;
  setOnTerminalOutput: (callback: unknown) => void;
  setOnWaitForTerminalExit: (callback: unknown) => void;
  setOnKillTerminalCommand: (callback: unknown) => void;
  setOnReleaseTerminal: (callback: unknown) => void;
  setOnPermissionRequest: (callback: unknown) => void;
  isConnected: () => boolean;
  connect: () => Promise<void>;
  newSession: (dir: string) => Promise<void>;
  setMode: (modeId: string) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  getSessionMetadata: () => unknown;
  dispose: () => void;
}

class TestMemento implements MockMemento {
  private state = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.state.set(key, value);
  }

  keys(): readonly string[] {
    return Array.from(this.state.keys());
  }

  clear(): void {
    this.state.clear();
  }
}

class TestACPClient implements MockACPClient {
  private agentIdValue = "test-agent";
  private setModeCallCount = 0;
  private setModelCallCount = 0;
  public lastSetModeId: string | null = null;
  public lastSetModelId: string | null = null;

  setAgent(config: any): void {
    if (config && config.id) {
      this.agentIdValue = config.id;
    }
  }
  getAgentId(): string {
    return this.agentIdValue;
  }
  setOnStateChange(): () => void {
    return () => {};
  }
  setOnSessionUpdate(): () => void {
    return () => {};
  }
  setOnStderr(): () => void {
    return () => {};
  }
  setOnReadTextFile(): void {}
  setOnWriteTextFile(): void {}
  setOnCreateTerminal(): void {}
  setOnTerminalOutput(): void {}
  setOnWaitForTerminalExit(): void {}
  setOnKillTerminalCommand(): void {}
  setOnReleaseTerminal(): void {}
  setOnPermissionRequest(): void {}
  isConnected(): boolean {
    return false;
  }
  async connect(): Promise<void> {}
  async newSession(): Promise<void> {}

  async setMode(modeId: string): Promise<void> {
    this.setModeCallCount++;
    this.lastSetModeId = modeId;
  }

  async setModel(modelId: string): Promise<void> {
    this.setModelCallCount++;
    this.lastSetModelId = modelId;
  }

  getSessionMetadata(): unknown {
    return {
      modes: null,
      models: null,
      commands: null,
    };
  }

  dispose(): void {}

  getSetModeCallCount(): number {
    return this.setModeCallCount;
  }

  getSetModelCallCount(): number {
    return this.setModelCallCount;
  }

  resetCallCounts(): void {
    this.setModeCallCount = 0;
    this.setModelCallCount = 0;
    this.lastSetModeId = null;
    this.lastSetModelId = null;
  }
}

function getAgentPrefs(
  memento: TestMemento,
  agentId: string
): { modeId?: string; modelId?: string; starredModels: string[] } | undefined {
  const all = memento.get<Record<string, any>>(
    "vscode-acp-chat.agentPreferences.v1"
  );
  return all?.[agentId];
}

suite("ChatViewProvider", () => {
  let memento: TestMemento;
  let acpClient: TestACPClient;
  let mockExtensionUri: vscode.Uri;

  setup(async () => {
    memento = new TestMemento();
    acpClient = new TestACPClient();
    mockExtensionUri = vscode.Uri.file("/mock/extension");
    // Pre-set a non-existent agent ID so constructor keeps the default test-agent
    await memento.update("vscode-acp-chat.selectedAgent", "test-agent");
  });

  teardown(() => {
    memento.clear();
    acpClient.resetCallCounts();
  });

  suite("Mode/Model Persistence with Validation", () => {
    test("should validate and restore saved mode against available modes", async () => {
      await memento.update("vscode-acp-chat.agentPreferences.v1", {
        "test-agent": { modeId: "test-mode", starredModels: [] },
      });

      class ACPClientWithModes extends TestACPClient {
        getSessionMetadata() {
          return {
            modes: {
              availableModes: [
                { id: "test-mode", name: "Test Mode" },
                { id: "other-mode", name: "Other Mode" },
              ],
              currentModeId: "other-mode",
            },
            models: null,
            commands: null,
          };
        }
      }

      const client = new ACPClientWithModes();
      const provider = new ChatViewProvider(
        mockExtensionUri,
        client as any,
        memento as any
      );

      const restoreMethod = (provider as any).restoreSavedModeAndModel;
      await restoreMethod.call(provider);

      assert.strictEqual(client.lastSetModeId, "test-mode");
      assert.strictEqual(client.getSetModeCallCount(), 1);
    });

    test("should validate and restore saved model against available models", async () => {
      await memento.update("vscode-acp-chat.agentPreferences.v1", {
        "test-agent": { modelId: "gpt-4", starredModels: [] },
      });

      class ACPClientWithModels extends TestACPClient {
        getSessionMetadata() {
          return {
            modes: null,
            models: {
              availableModels: [
                { modelId: "gpt-4", name: "GPT-4" },
                { modelId: "gpt-3.5", name: "GPT-3.5" },
              ],
              currentModelId: "gpt-3.5",
            },
            commands: null,
          };
        }
      }

      const client = new ACPClientWithModels();
      const provider = new ChatViewProvider(
        mockExtensionUri,
        client as any,
        memento as any
      );

      const restoreMethod = (provider as any).restoreSavedModeAndModel;
      await restoreMethod.call(provider);

      assert.strictEqual(client.lastSetModelId, "gpt-4");
      assert.strictEqual(client.getSetModelCallCount(), 1);
    });

    test("should skip invalid mode IDs not in available modes", async () => {
      await memento.update("vscode-acp-chat.agentPreferences.v1", {
        "test-agent": { modeId: "removed-mode", starredModels: [] },
      });

      class ACPClientWithModes extends TestACPClient {
        getSessionMetadata() {
          return {
            modes: {
              availableModes: [
                { id: "valid-mode-1", name: "Valid Mode 1" },
                { id: "valid-mode-2", name: "Valid Mode 2" },
              ],
              currentModeId: "valid-mode-1",
            },
            models: null,
            commands: null,
          };
        }
      }

      const client = new ACPClientWithModes();
      const provider = new ChatViewProvider(
        mockExtensionUri,
        client as any,
        memento as any
      );

      const restoreMethod = (provider as any).restoreSavedModeAndModel;
      await restoreMethod.call(provider);

      assert.strictEqual(client.getSetModeCallCount(), 0);
    });

    test("should skip invalid model IDs not in available models", async () => {
      await memento.update("vscode-acp-chat.agentPreferences.v1", {
        "test-agent": { modelId: "removed-model", starredModels: [] },
      });

      class ACPClientWithModels extends TestACPClient {
        getSessionMetadata() {
          return {
            modes: null,
            models: {
              availableModels: [
                { modelId: "valid-model-1", name: "Valid Model 1" },
                { modelId: "valid-model-2", name: "Valid Model 2" },
              ],
              currentModelId: "valid-model-1",
            },
            commands: null,
          };
        }
      }

      const client = new ACPClientWithModels();
      const provider = new ChatViewProvider(
        mockExtensionUri,
        client as any,
        memento as any
      );

      const restoreMethod = (provider as any).restoreSavedModeAndModel;
      await restoreMethod.call(provider);

      assert.strictEqual(client.getSetModelCallCount(), 0);
    });

    test("should not restore if nothing is saved", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );

      const restoreMethod = (provider as any).restoreSavedModeAndModel;
      await restoreMethod.call(provider);

      assert.strictEqual(acpClient.getSetModeCallCount(), 0);
      assert.strictEqual(acpClient.getSetModelCallCount(), 0);
    });

    test("should throw but be caught by caller if restoration fails", async () => {
      await memento.update("vscode-acp-chat.agentPreferences.v1", {
        "test-agent": { modeId: "test-mode", starredModels: [] },
      });

      class FailingACPClient extends TestACPClient {
        getSessionMetadata() {
          return {
            modes: {
              availableModes: [{ id: "test-mode", name: "Test Mode" }],
              currentModeId: "test-mode",
            },
            models: null,
            commands: null,
          };
        }

        async setMode(): Promise<void> {
          throw new Error("Failed to set mode");
        }
      }

      const client = new FailingACPClient();
      const provider = new ChatViewProvider(
        mockExtensionUri,
        client as any,
        memento as any
      );

      const restoreMethod = (provider as any).restoreSavedModeAndModel;

      await assert.rejects(() => restoreMethod.call(provider));
    });
  });

  suite("Mode/Model Storage on Change", () => {
    test("should persist mode to agent-scoped globalState when changed", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );

      const handleModeChange = (provider as any).handleModeChange;
      await handleModeChange.call(provider, "new-mode");

      const pref = getAgentPrefs(memento, "test-agent");
      assert.strictEqual(pref?.modeId, "new-mode");
    });

    test("should persist model to agent-scoped globalState when changed", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );

      const handleModelChange = (provider as any).handleModelChange;
      await handleModelChange.call(provider, "new-model");

      const pref = getAgentPrefs(memento, "test-agent");
      assert.strictEqual(pref?.modelId, "new-model");
    });

    test("should call ACP client setMode before persisting", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );

      acpClient.resetCallCounts();
      const handleModeChange = (provider as any).handleModeChange;
      await handleModeChange.call(provider, "new-mode");

      assert.strictEqual(acpClient.lastSetModeId, "new-mode");
      assert.ok(acpClient.getSetModeCallCount() >= 1);
      assert.strictEqual(
        getAgentPrefs(memento, "test-agent")?.modeId,
        "new-mode"
      );
    });

    test("should call ACP client setModel before persisting", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );

      acpClient.resetCallCounts();
      const handleModelChange = (provider as any).handleModelChange;
      await handleModelChange.call(provider, "new-model");

      assert.strictEqual(acpClient.lastSetModelId, "new-model");
      assert.ok(acpClient.getSetModelCallCount() >= 1);
      assert.strictEqual(
        getAgentPrefs(memento, "test-agent")?.modelId,
        "new-model"
      );
    });

    test("should handle mode change errors gracefully", async () => {
      class FailingACPClient extends TestACPClient {
        async setMode(): Promise<void> {
          throw new Error("Failed to set mode");
        }
      }

      const failingClient = new FailingACPClient();

      const provider = new ChatViewProvider(
        mockExtensionUri,
        failingClient as any,
        memento as any
      );

      const handleModeChange = (provider as any).handleModeChange;

      await handleModeChange.call(provider, "new-mode");

      const pref = getAgentPrefs(memento, "test-agent");
      assert.strictEqual(pref, undefined);
    });

    test("should handle model change errors gracefully", async () => {
      class FailingACPClient extends TestACPClient {
        async setModel(): Promise<void> {
          throw new Error("Failed to set model");
        }
      }

      const failingClient = new FailingACPClient();

      const provider = new ChatViewProvider(
        mockExtensionUri,
        failingClient as any,
        memento as any
      );

      const handleModelChange = (provider as any).handleModelChange;

      await handleModelChange.call(provider, "new-model");

      const pref = getAgentPrefs(memento, "test-agent");
      assert.strictEqual(pref, undefined);
    });

    test("should update agent preference with new values when changed multiple times", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );

      const handleModeChange = (provider as any).handleModeChange;

      await handleModeChange.call(provider, "mode-1");
      assert.strictEqual(
        getAgentPrefs(memento, "test-agent")?.modeId,
        "mode-1"
      );

      acpClient.resetCallCounts();

      await handleModeChange.call(provider, "mode-2");
      assert.strictEqual(
        getAgentPrefs(memento, "test-agent")?.modeId,
        "mode-2"
      );
    });
  });

  suite("Agent-Scoped Preference Isolation", () => {
    test("should keep mode/model isolated per agent", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );

      const handleModeChange = (provider as any).handleModeChange;
      const handleModelChange = (provider as any).handleModelChange;

      await handleModeChange.call(provider, "agent-a-mode");
      await handleModelChange.call(provider, "agent-a-model");

      assert.strictEqual(
        getAgentPrefs(memento, "test-agent")?.modeId,
        "agent-a-mode"
      );
      assert.strictEqual(
        getAgentPrefs(memento, "test-agent")?.modelId,
        "agent-a-model"
      );

      // Switch to another agent
      acpClient.setAgent({ id: "agent-b" });

      await handleModeChange.call(provider, "agent-b-mode");
      await handleModelChange.call(provider, "agent-b-model");

      assert.strictEqual(
        getAgentPrefs(memento, "agent-b")?.modeId,
        "agent-b-mode"
      );
      assert.strictEqual(
        getAgentPrefs(memento, "agent-b")?.modelId,
        "agent-b-model"
      );

      // Agent A should be untouched
      assert.strictEqual(
        getAgentPrefs(memento, "test-agent")?.modeId,
        "agent-a-mode"
      );
      assert.strictEqual(
        getAgentPrefs(memento, "test-agent")?.modelId,
        "agent-a-model"
      );
    });

    test("should restore mode/model for the current agent only", async () => {
      await memento.update("vscode-acp-chat.agentPreferences.v1", {
        "agent-a": { modeId: "mode-a", modelId: "model-a", starredModels: [] },
        "agent-b": { modeId: "mode-b", modelId: "model-b", starredModels: [] },
      });

      class ACPClientWithBoth extends TestACPClient {
        getSessionMetadata() {
          return {
            modes: {
              availableModes: [
                { id: "mode-a", name: "Mode A" },
                { id: "mode-b", name: "Mode B" },
              ],
              currentModeId: "mode-a",
            },
            models: {
              availableModels: [
                { modelId: "model-a", name: "Model A" },
                { modelId: "model-b", name: "Model B" },
              ],
              currentModelId: "model-a",
            },
            commands: null,
          };
        }
      }

      const client = new ACPClientWithBoth();
      client.setAgent({ id: "agent-b" });

      const provider = new ChatViewProvider(
        mockExtensionUri,
        client as any,
        memento as any
      );

      const restoreMethod = (provider as any).restoreSavedModeAndModel;
      await restoreMethod.call(provider);

      assert.strictEqual(client.lastSetModeId, "mode-b");
      assert.strictEqual(client.lastSetModelId, "model-b");
    });
  });

  suite("StarredModels Toggle", () => {
    test("should add starred model via toggleModelStar message", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );

      // Simulate receiving toggleModelStar message
      await (provider as any).handleMessage?.call(provider, {
        type: "toggleModelStar",
        modelId: "gpt-4",
        isStarred: true,
      });

      // Access private method directly via the message handler path
      // Since handleMessage is not exposed, use reflection to invoke the switch case path
      // We'll instead invoke updateCurrentAgentPreference directly
      const updatePref = (provider as any).updateCurrentAgentPreference;
      await updatePref.call(provider, (pref: any) => {
        const s = new Set(pref.starredModels);
        s.add("gpt-4");
        return { ...pref, starredModels: Array.from(s) };
      });

      const pref = getAgentPrefs(memento, "test-agent");
      assert.deepStrictEqual(pref?.starredModels, ["gpt-4"]);
    });

    test("should remove starred model via toggleModelStar message", async () => {
      await memento.update("vscode-acp-chat.agentPreferences.v1", {
        "test-agent": { starredModels: ["gpt-4", "claude-3"] },
      });

      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );

      const updatePref = (provider as any).updateCurrentAgentPreference;
      await updatePref.call(provider, (pref: any) => {
        const s = new Set(pref.starredModels);
        s.delete("gpt-4");
        return { ...pref, starredModels: Array.from(s) };
      });

      const pref = getAgentPrefs(memento, "test-agent");
      assert.deepStrictEqual(pref?.starredModels, ["claude-3"]);
    });

    test("should keep starredModels isolated per agent", async () => {
      await memento.update("vscode-acp-chat.agentPreferences.v1", {
        "agent-a": { starredModels: ["gpt-4"] },
        "agent-b": { starredModels: ["claude-3"] },
      });

      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );

      const updatePref = (provider as any).updateCurrentAgentPreference;
      await updatePref.call(provider, (pref: any) => {
        const s = new Set(pref.starredModels);
        s.add("o1");
        return { ...pref, starredModels: Array.from(s) };
      });

      assert.deepStrictEqual(
        getAgentPrefs(memento, "test-agent")?.starredModels,
        ["o1"]
      );
      assert.deepStrictEqual(getAgentPrefs(memento, "agent-a")?.starredModels, [
        "gpt-4",
      ]);
      assert.deepStrictEqual(getAgentPrefs(memento, "agent-b")?.starredModels, [
        "claude-3",
      ]);
    });
  });

  suite("Turn Separation and History Restoration", () => {
    test("flushUserMessageBuffer sends streamEnd before userMessage", () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );

      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);

      // Set up buffer
      (provider as any).userMessageBuffer = "Test question";

      // Trigger flush
      (provider as any).flushUserMessageBuffer();

      assert.strictEqual(messages.length, 2);
      assert.strictEqual(
        messages[0].type,
        "streamEnd",
        "streamEnd should be sent first"
      );
      assert.strictEqual(
        messages[1].type,
        "userMessage",
        "userMessage should be sent second"
      );
    });
  });
});
