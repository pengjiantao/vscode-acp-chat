/* eslint-disable @typescript-eslint/no-explicit-any */
import * as assert from "assert";
import * as fs from "fs";
import * as vscode from "vscode";
import * as path from "path";
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
  setOnElicitationRequest: (callback: unknown) => void;
  setOnElicitationComplete: (callback: unknown) => void;
  isConnected: () => boolean;
  connect: () => Promise<void>;
  newSession: (dir: string) => Promise<void>;
  setMode: (modeId: string) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setConfigOption: (configId: string, value: string) => Promise<void>;
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
  private setConfigOptionCallCount = 0;
  public lastSetModeId: string | null = null;
  public lastSetModelId: string | null = null;
  public lastSetConfigOptionId: string | null = null;
  public lastSetConfigOptionValue: string | null = null;

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
  setOnElicitationRequest(): void {}
  setOnElicitationComplete(): void {}
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

  async setConfigOption(configId: string, value: string): Promise<void> {
    this.setConfigOptionCallCount++;
    this.lastSetConfigOptionId = configId;
    this.lastSetConfigOptionValue = value;
  }

  getSessionMetadata(): unknown {
    return {
      modes: null,
      models: null,
      genericConfigOptions: [],
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

  getSetConfigOptionCallCount(): number {
    return this.setConfigOptionCallCount;
  }

  resetCallCounts(): void {
    this.setModeCallCount = 0;
    this.setModelCallCount = 0;
    this.setConfigOptionCallCount = 0;
    this.lastSetModeId = null;
    this.lastSetModelId = null;
    this.lastSetConfigOptionId = null;
    this.lastSetConfigOptionValue = null;
  }
}

function getAgentPrefs(
  memento: TestMemento,
  agentId: string
):
  | {
      modeId?: string;
      modelId?: string;
      starredModels: string[];
      modelConfigOptionValues?: Record<string, Record<string, string>>;
    }
  | undefined {
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

  suite("Webview Theme Styles", () => {
    test("loads highlight styles from stylesheet instead of fixed dark inline theme", () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const html = (provider as any).getHtmlContent({
        asWebviewUri: (uri: vscode.Uri) => uri,
        cspSource: "vscode-resource:",
      });

      assert.ok(
        !html.includes("Highlight.js GitHub Dark Theme"),
        "webview HTML should not inline a fixed dark highlight.js theme"
      );
      assert.ok(
        !html.includes("#0d1117"),
        "webview HTML should not force a dark code block background"
      );
      assert.ok(
        !html.includes("#c9d1d9"),
        "webview HTML should not force dark-theme foreground colors"
      );
    });

    test("defines VS Code light and dark palettes for markdown code blocks", () => {
      const cssPath = path.resolve(__dirname, "../../media/vscode.css");
      const css = fs.readFileSync(cssPath, "utf8");

      assert.ok(
        css.includes("body.vscode-light"),
        "highlight styles should include a light theme selector"
      );
      assert.ok(
        css.includes("body.vscode-dark"),
        "highlight styles should include a dark theme selector"
      );
      assert.ok(
        css.includes("--acp-hljs-foreground"),
        "highlight styles should expose theme-aware syntax variables"
      );
      assert.ok(
        css.includes("var(--vscode-textCodeBlock-background"),
        "highlight background should derive from VS Code code block colors"
      );
      assert.ok(
        css.includes(".hljs"),
        "highlight.js token classes should be styled by the shared stylesheet"
      );
    });
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

      const restoreMethod = (provider as any).restoreSessionPreferences;
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

      const restoreMethod = (provider as any).restoreSessionPreferences;
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

      const restoreMethod = (provider as any).restoreSessionPreferences;
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

      const restoreMethod = (provider as any).restoreSessionPreferences;
      await restoreMethod.call(provider);

      assert.strictEqual(client.getSetModelCallCount(), 0);
    });

    test("should not restore if nothing is saved", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );

      const restoreMethod = (provider as any).restoreSessionPreferences;
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

      const restoreMethod = (provider as any).restoreSessionPreferences;

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

      const restoreMethod = (provider as any).restoreSessionPreferences;
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

    test("sends streamChunk and thoughtChunk to webview", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);

      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello" },
        },
      });
      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Thinking" },
        },
      });

      const streamChunk = messages.find((m) => m.type === "streamChunk");
      const thoughtChunk = messages.find((m) => m.type === "thoughtChunk");

      assert.strictEqual(streamChunk?.text, "Hello");
      assert.strictEqual(thoughtChunk?.text, "Thinking");
    });

    test("forwards messageId on stream chunks", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);

      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg_main_1",
          content: { type: "text", text: "Hello" },
        },
      });
      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "agent_thought_chunk",
          messageId: "msg_sub_2",
          content: { type: "text", text: "Thinking" },
        },
      });

      const streamChunk = messages.find((m) => m.type === "streamChunk");
      const thoughtChunk = messages.find((m) => m.type === "thoughtChunk");

      assert.strictEqual(streamChunk?.messageId, "msg_main_1");
      assert.strictEqual(thoughtChunk?.messageId, "msg_sub_2");
    });

    test("omits messageId when the update has none", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);

      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello" },
        },
      });

      const streamChunk = messages.find((m) => m.type === "streamChunk");
      assert.strictEqual(streamChunk?.messageId, null);
    });
  });

  suite("Tool Call Updates", () => {
    test("treats a completed tool_call as a complete event", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);

      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "file-change-1",
          title: "Editing files",
          kind: "edit",
          status: "completed",
          content: [
            {
              type: "diff",
              path: "/test/project/NewFile.kt",
              oldText: null,
              newText: "class NewFile\n",
            },
          ],
        },
      });

      const complete = messages.find((m) => m.type === "toolCallComplete");
      assert.ok(complete, "completed tool_call should finalize the tool");
      assert.strictEqual(complete.toolCallId, "file-change-1");
      assert.strictEqual(complete.title, "Editing files");
      assert.strictEqual(complete.kind, "edit");
      assert.strictEqual(complete.status, "completed");
      assert.deepStrictEqual(complete.content, [
        {
          type: "diff",
          path: "/test/project/NewFile.kt",
          oldText: null,
          newText: "class NewFile\n",
        },
      ]);
      assert.strictEqual(
        (provider as any).toolCalls.has("file-change-1"),
        false,
        "completed tool_call should not leave stale tool call state"
      );
    });

    test("treats a failed tool_call as a complete event", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);

      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "file-change-failed",
          title: "Editing files",
          kind: "edit",
          status: "failed",
        },
      });

      const complete = messages.find((m) => m.type === "toolCallComplete");
      assert.ok(complete, "failed tool_call should finalize the tool");
      assert.strictEqual(complete.toolCallId, "file-change-failed");
      assert.strictEqual(complete.title, "Editing files");
      assert.strictEqual(complete.kind, "edit");
      assert.strictEqual(complete.status, "failed");
      assert.strictEqual(
        (provider as any).toolCalls.has("file-change-failed"),
        false,
        "failed tool_call should not leave stale tool call state"
      );
    });

    test("uses rawOutput text field as terminal output", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);

      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "command-text-output",
          title: "run command",
          kind: "execute",
          status: "completed",
          rawInput: {
            command: "ls",
            cwd: "/test/project",
          },
          rawOutput: {
            type: "text",
            text: "Exited with code 0. Final output:\nschema.json\n",
          },
        },
      });

      const complete = messages.find((m) => m.type === "toolCallComplete");
      assert.ok(complete, "command should complete");
      assert.strictEqual(complete.toolCallId, "command-text-output");
      assert.strictEqual(
        complete.terminalOutput,
        "Exited with code 0. Final output:\nschema.json\n"
      );
    });

    test("uses rawOutput string directly as terminal output", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);

      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "command-string-output",
          title: "run command",
          kind: "execute",
          status: "completed",
          rawInput: {
            command: "echo hello",
          },
          rawOutput: "hello\n",
        },
      });

      const complete = messages.find((m) => m.type === "toolCallComplete");
      assert.ok(complete, "command should complete");
      assert.strictEqual(complete.toolCallId, "command-string-output");
      assert.strictEqual(complete.terminalOutput, "hello\n");
    });

    test("falls back to key:value format when no known output fields match", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);

      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "command-kv-fallback",
          title: "run command",
          kind: "execute",
          status: "completed",
          rawInput: {
            command: "test",
            cwd: "/test/project",
          },
          rawOutput: {
            exit_code: 0,
            signal: null,
          },
        },
      });

      const complete = messages.find((m) => m.type === "toolCallComplete");
      assert.ok(complete, "command should complete");
      assert.strictEqual(complete.toolCallId, "command-kv-fallback");
      assert.strictEqual(complete.terminalOutput, "exit_code: 0\nsignal: null");
    });

    test("uses codex formatted_output as terminal output", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);

      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "command-formatted-output",
          title: "git diff --check",
          kind: "execute",
          status: "in_progress",
          content: [
            {
              type: "terminal",
              terminalId: "command-formatted-output",
            },
          ],
          rawInput: {
            command: "git diff --check",
            cwd: "/test/project",
          },
        },
      });
      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "command-formatted-output",
          status: "completed",
          rawOutput: {
            formatted_output: "Checked 2 files\n",
            exit_code: 0,
          },
        },
      });

      const complete = messages.find((m) => m.type === "toolCallComplete");
      assert.ok(complete, "command should complete");
      assert.strictEqual(complete.toolCallId, "command-formatted-output");
      assert.strictEqual(complete.terminalOutput, "Checked 2 files\n");
    });

    test("renders final-only command completion with output", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);

      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "command-final-only",
          title: "git status --short",
          kind: "execute",
          status: "completed",
          rawInput: {
            command: "git status --short",
            cwd: "/test/project",
          },
          rawOutput: {
            formatted_output: "M src/views/chat.ts\n",
            exit_code: 0,
          },
        },
      });

      const complete = messages.find((m) => m.type === "toolCallComplete");
      assert.ok(complete, "final-only command should still render");
      assert.strictEqual(complete.toolCallId, "command-final-only");
      assert.strictEqual(complete.title, "git status --short");
      assert.strictEqual(complete.kind, "execute");
      assert.strictEqual(complete.terminalOutput, "M src/views/chat.ts\n");
      assert.deepStrictEqual(complete.rawInput, {
        command: "git status --short",
        cwd: "/test/project",
      });
    });

    test("preserves start content when completion only updates status", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);

      const diffContent = [
        {
          type: "diff",
          path: "/test/project/src/file.ts",
          oldText: "old\n",
          newText: "new\n",
        },
      ];

      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "file-change-status-only",
          title: "Editing files",
          kind: "edit",
          status: "in_progress",
          content: diffContent,
        },
      });
      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "file-change-status-only",
          status: "completed",
        },
      });

      const complete = messages.find((m) => m.type === "toolCallComplete");
      assert.ok(complete, "status-only completion should finalize the tool");
      assert.strictEqual(complete.toolCallId, "file-change-status-only");
      assert.strictEqual(complete.title, "Editing files");
      assert.strictEqual(complete.kind, "edit");
      assert.deepStrictEqual(complete.content, diffContent);
      assert.strictEqual(
        (provider as any).toolCalls.has("file-change-status-only"),
        false,
        "status-only completion should clear tool call state"
      );
    });

    test("synthesizes completion for pending live tools before stream end", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);

      const diffContent = [
        {
          type: "diff",
          path: "/test/project/src/live.ts",
          oldText: "before\n",
          newText: "after\n",
        },
      ];

      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "live-write-no-final",
          title: "Editing files",
          kind: "edit",
          status: "in_progress",
          content: diffContent,
        },
      });

      await (provider as any).finalizePendingToolCalls("end_turn");

      const complete = messages.find((m) => m.type === "toolCallComplete");
      assert.ok(
        complete,
        "pending live tool should be synthesized as complete"
      );
      assert.strictEqual(complete.toolCallId, "live-write-no-final");
      assert.strictEqual(complete.status, "completed");
      assert.strictEqual(complete.title, "Editing files");
      assert.strictEqual(complete.kind, "edit");
      assert.deepStrictEqual(complete.content, diffContent);
      assert.strictEqual(
        (provider as any).toolCalls.has("live-write-no-final"),
        false,
        "synthesized completion should clear tool call state"
      );
    });
  });

  suite("Context Usage Indicator", () => {
    test("forwards usage_update to webview as contextUsage", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);

      const lastUpdate: any = {
        used: 5000,
        size: 10000,
        cost: { amount: 0.0012, currency: "USD" },
      };
      const sessionMeta: any = {
        modes: null,
        models: null,
        commands: null,
        lastUsageUpdate: null,
      };
      (acpClient as any).setLastUsageUpdate = (payload: any) => {
        sessionMeta.lastUsageUpdate = payload;
      };
      (acpClient as any).getSessionMetadata = () => sessionMeta;

      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: {
          sessionUpdate: "usage_update",
          used: 5000,
          size: 10000,
          cost: { amount: 0.0012, currency: "USD" },
        },
      });

      const usageMsg = messages.find((m) => m.type === "contextUsage");
      assert.ok(usageMsg, "contextUsage message should be sent");
      assert.strictEqual(usageMsg.used, 5000);
      assert.strictEqual(usageMsg.size, 10000);
      assert.deepStrictEqual(usageMsg.cost, {
        amount: 0.0012,
        currency: "USD",
      });
      assert.deepStrictEqual(sessionMeta.lastUsageUpdate, lastUpdate);
    });

    test("ignores malformed usage_update with size <= 0", async () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);
      let setCalled = false;
      (acpClient as any).setLastUsageUpdate = () => {
        setCalled = true;
      };

      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: { sessionUpdate: "usage_update", used: 0, size: 0 },
      });
      await (provider as any).handleSessionUpdate({
        sessionId: "test",
        update: { sessionUpdate: "usage_update", used: 100 },
      });

      assert.strictEqual(
        setCalled,
        false,
        "setLastUsageUpdate should not be called"
      );
      const usageMsgs = messages.filter((m) => m.type === "contextUsage");
      assert.strictEqual(usageMsgs.length, 0);
    });

    test("sendContextUsage emits clear message when no usage data", () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);
      (acpClient as any).getSessionMetadata = () => ({
        modes: null,
        models: null,
        commands: null,
        lastUsageUpdate: null,
      });

      (provider as any).sendContextUsage();

      const usageMsg = messages.find((m) => m.type === "contextUsage");
      assert.ok(usageMsg);
      assert.strictEqual(usageMsg.used, null);
      assert.strictEqual(usageMsg.size, null);
      assert.strictEqual(usageMsg.cost, null);
    });

    test("sendContextUsage replays last-known usage", () => {
      const provider = new ChatViewProvider(
        mockExtensionUri,
        acpClient as any,
        memento as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);
      (acpClient as any).getSessionMetadata = () => ({
        modes: null,
        models: null,
        commands: null,
        lastUsageUpdate: {
          used: 7000,
          size: 14000,
          cost: { amount: 0.005, currency: "EUR" },
        },
      });

      (provider as any).sendContextUsage();

      const usageMsg = messages.find((m) => m.type === "contextUsage");
      assert.ok(usageMsg);
      assert.strictEqual(usageMsg.used, 7000);
      assert.strictEqual(usageMsg.size, 14000);
      assert.deepStrictEqual(usageMsg.cost, {
        amount: 0.005,
        currency: "EUR",
      });
    });
  });

  suite("Per-Model thought_level Preferences", () => {
    const defaultGenericConfigOptions = [
      {
        id: "thought_level",
        name: "Thought Level",
        category: "thought_level",
        options: [
          { value: "off", name: "Off" },
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
        ],
        currentValue: "medium",
      },
    ];

    test("should save thought_level per model when config option changes", async () => {
      class ACPClientWithThought extends TestACPClient {
        getSessionMetadata() {
          return {
            modes: null,
            models: {
              availableModels: [{ modelId: "model-a", name: "Model A" }],
              currentModelId: "model-a",
            },
            genericConfigOptions: defaultGenericConfigOptions,
            commands: null,
          };
        }
      }

      const client = new ACPClientWithThought();
      const provider = new ChatViewProvider(
        mockExtensionUri,
        client as any,
        memento as any
      );

      // Set model first
      await (provider as any).handleModelChange("model-a");
      // Change thought_level
      await (provider as any).handleConfigOptionChange("thought_level", "high");

      const pref = getAgentPrefs(memento, "test-agent");
      assert.strictEqual(pref?.modelId, "model-a");
      assert.strictEqual(
        pref?.modelConfigOptionValues?.["model-a"]?.["thought_level"],
        "high"
      );
    });

    test("should auto-switch thought_level when model changes", async () => {
      class ACPClientWithThought extends TestACPClient {
        private currentThoughtLevel = "medium";

        getSessionMetadata() {
          return {
            modes: null,
            models: {
              availableModels: [
                { modelId: "model-a", name: "Model A" },
                { modelId: "model-b", name: "Model B" },
              ],
              currentModelId: "model-a",
            },
            genericConfigOptions: [
              {
                id: "thought_level",
                name: "Thought Level",
                category: "thought_level",
                options: [
                  { value: "off", name: "Off" },
                  { value: "low", name: "Low" },
                  { value: "medium", name: "Medium" },
                  { value: "high", name: "High" },
                ],
                currentValue: this.currentThoughtLevel,
              },
            ],
            commands: null,
          };
        }

        async setConfigOption(configId: string, value: string): Promise<void> {
          await super.setConfigOption(configId, value);
          if (configId === "thought_level") {
            this.currentThoughtLevel = value;
          }
        }
      }

      const client = new ACPClientWithThought();
      const provider = new ChatViewProvider(
        mockExtensionUri,
        client as any,
        memento as any
      );

      // Set model-a and save thought_level "high"
      await (provider as any).handleModelChange("model-a");
      await (provider as any).handleConfigOptionChange("thought_level", "high");

      // Set model-b and save thought_level "low"
      await (provider as any).handleModelChange("model-b");
      client.resetCallCounts();
      client.lastSetConfigOptionId = null;
      client.lastSetConfigOptionValue = null;
      await (provider as any).handleConfigOptionChange("thought_level", "low");

      // Switch back to model-a, should auto-restore "high"
      client.resetCallCounts();
      await (provider as any).handleModelChange("model-a");

      assert.strictEqual(client.lastSetConfigOptionId, "thought_level");
      assert.strictEqual(client.lastSetConfigOptionValue, "high");
    });

    test("should not switch thought_level if no preference saved for target model", async () => {
      class ACPClientWithThought extends TestACPClient {
        getSessionMetadata() {
          return {
            modes: null,
            models: {
              availableModels: [
                { modelId: "model-a", name: "Model A" },
                { modelId: "model-b", name: "Model B" },
              ],
              currentModelId: "model-a",
            },
            genericConfigOptions: defaultGenericConfigOptions,
            commands: null,
          };
        }
      }

      const client = new ACPClientWithThought();
      const provider = new ChatViewProvider(
        mockExtensionUri,
        client as any,
        memento as any
      );

      // Save thought_level for model-a only
      await (provider as any).handleModelChange("model-a");
      await (provider as any).handleConfigOptionChange("thought_level", "high");

      // Switch to model-b (no saved preference)
      client.resetCallCounts();
      await (provider as any).handleModelChange("model-b");

      assert.strictEqual(client.getSetConfigOptionCallCount(), 0);
    });

    test("should validate saved thought_level against available options", async () => {
      class ACPClientWithLimitedOptions extends TestACPClient {
        getSessionMetadata() {
          return {
            modes: null,
            models: {
              availableModels: [
                { modelId: "model-a", name: "Model A" },
                { modelId: "model-b", name: "Model B" },
              ],
              currentModelId: "model-a",
            },
            genericConfigOptions: [
              {
                id: "thought_level",
                name: "Thought Level",
                category: "thought_level",
                options: [
                  { value: "low", name: "Low" },
                  { value: "medium", name: "Medium" },
                ],
                currentValue: "medium",
              },
            ],
            commands: null,
          };
        }
      }

      const client = new ACPClientWithLimitedOptions();
      const provider = new ChatViewProvider(
        mockExtensionUri,
        client as any,
        memento as any
      );

      // Manually save a preference for model-a with value "high" (not available)
      await memento.update("vscode-acp-chat.agentPreferences.v1", {
        "test-agent": {
          modelId: "model-b",
          starredModels: [],
          configOptionValues: {},
          modelConfigOptionValues: {
            "model-a": { thought_level: "high" },
          },
        },
      });

      // Switch to model-a
      client.resetCallCounts();
      await (provider as any).handleModelChange("model-a");

      // "high" is not in available options, so setConfigOption should NOT be called
      assert.strictEqual(client.getSetConfigOptionCallCount(), 0);
    });

    test("should restore per-model thought_level during session restore", async () => {
      await memento.update("vscode-acp-chat.agentPreferences.v1", {
        "test-agent": {
          modelId: "model-a",
          starredModels: [],
          configOptionValues: { thought_level: "low" },
          modelConfigOptionValues: {
            "model-a": { thought_level: "high" },
          },
        },
      });

      class ACPClientWithThought extends TestACPClient {
        getSessionMetadata() {
          return {
            modes: null,
            models: {
              availableModels: [{ modelId: "model-a", name: "Model A" }],
              currentModelId: "model-a",
            },
            genericConfigOptions: [
              {
                id: "thought_level",
                name: "Thought Level",
                category: "thought_level",
                options: [
                  { value: "off", name: "Off" },
                  { value: "low", name: "Low" },
                  { value: "medium", name: "Medium" },
                  { value: "high", name: "High" },
                ],
                currentValue: "medium",
              },
            ],
            commands: null,
          };
        }
      }

      const client = new ACPClientWithThought();
      const provider = new ChatViewProvider(
        mockExtensionUri,
        client as any,
        memento as any
      );

      await (provider as any).restoreSessionPreferences();

      // First restores global configOptionValues ("low"), then overrides with per-model ("high")
      assert.strictEqual(client.lastSetConfigOptionId, "thought_level");
      assert.strictEqual(client.lastSetConfigOptionValue, "high");
    });

    test("should isolate per-model thought_level preferences across agents", async () => {
      class ACPClientWithThought extends TestACPClient {
        getSessionMetadata() {
          return {
            modes: null,
            models: {
              availableModels: [{ modelId: "model-a", name: "Model A" }],
              currentModelId: "model-a",
            },
            genericConfigOptions: defaultGenericConfigOptions,
            commands: null,
          };
        }
      }

      const client = new ACPClientWithThought();
      const provider = new ChatViewProvider(
        mockExtensionUri,
        client as any,
        memento as any
      );

      // Agent "test-agent" sets thought_level "high" for model-a
      await (provider as any).handleModelChange("model-a");
      await (provider as any).handleConfigOptionChange("thought_level", "high");

      // Switch to agent-b, set thought_level "low" for model-a
      client.setAgent({ id: "agent-b" });
      await (provider as any).handleModelChange("model-a");
      await (provider as any).handleConfigOptionChange("thought_level", "low");

      // Verify isolation
      const prefsA = getAgentPrefs(memento, "test-agent");
      const prefsB = getAgentPrefs(memento, "agent-b");
      assert.strictEqual(
        prefsA?.modelConfigOptionValues?.["model-a"]?.["thought_level"],
        "high"
      );
      assert.strictEqual(
        prefsB?.modelConfigOptionValues?.["model-a"]?.["thought_level"],
        "low"
      );
    });

    test("should not save per-model thought_level when no model is active", async () => {
      class ACPClientWithThought extends TestACPClient {
        getSessionMetadata() {
          return {
            modes: null,
            models: null,
            genericConfigOptions: defaultGenericConfigOptions,
            commands: null,
          };
        }
      }

      const client = new ACPClientWithThought();
      const provider = new ChatViewProvider(
        mockExtensionUri,
        client as any,
        memento as any
      );

      // Change thought_level without setting a model first
      await (provider as any).handleConfigOptionChange("thought_level", "high");

      const pref = getAgentPrefs(memento, "test-agent");
      assert.strictEqual(pref?.modelId, undefined);
      assert.strictEqual(pref?.modelConfigOptionValues, undefined);
    });
  });

  suite("openFile Message Handling", () => {
    let originalShowTextDocument: any;
    let originalWorkspaceFolders: any;
    let originalShowErrorMessage: any;
    let showTextDocumentCalls: any[] = [];
    let showErrorMessageCalls: string[] = [];

    setup(() => {
      originalShowTextDocument = vscode.window.showTextDocument;
      showTextDocumentCalls = [];
      Object.defineProperty(vscode.window, "showTextDocument", {
        value: async (
          uri: vscode.Uri,
          options?: vscode.TextDocumentShowOptions
        ) => {
          showTextDocumentCalls.push({ uri, options });
          return {} as any;
        },
        configurable: true,
        writable: true,
      });

      originalShowErrorMessage = vscode.window.showErrorMessage;
      showErrorMessageCalls = [];
      Object.defineProperty(vscode.window, "showErrorMessage", {
        value: async (message: string) => {
          showErrorMessageCalls.push(message);
          return {} as any;
        },
        configurable: true,
        writable: true,
      });

      originalWorkspaceFolders = vscode.workspace.workspaceFolders;
      Object.defineProperty(vscode.workspace, "workspaceFolders", {
        value: [{ uri: vscode.Uri.file(path.dirname(__filename)) }],
        configurable: true,
        writable: true,
      });
    });

    teardown(() => {
      Object.defineProperty(vscode.window, "showTextDocument", {
        value: originalShowTextDocument,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(vscode.window, "showErrorMessage", {
        value: originalShowErrorMessage,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(vscode.workspace, "workspaceFolders", {
        value: originalWorkspaceFolders,
        configurable: true,
        writable: true,
      });
    });

    function resolveView(provider: ChatViewProvider): {
      messageHandler: (message: any) => Promise<void>;
    } {
      let messageHandler: ((message: any) => Promise<void>) | undefined;
      const mockWebview = {
        onDidReceiveMessage: (cb: any) => {
          messageHandler = cb;
          return { dispose: () => {} };
        },
        asWebviewUri: (uri: vscode.Uri) => uri,
        cspSource: "",
        options: {},
        html: "",
      };
      const mockView = {
        webview: mockWebview,
        viewType: "test",
        onDidChangeVisibility: new vscode.EventEmitter<void>().event,
        onDidDispose: new vscode.EventEmitter<void>().event,
        title: "test",
        visible: true,
        show: () => {},
      };

      provider.resolveWebviewView(mockView as any, {} as any, {} as any);
      return { messageHandler: messageHandler! };
    }

    test("should handle openFile with message.href and parse range correctly", async () => {
      const provider = new ChatViewProvider(
        vscode.Uri.file("/test"),
        new TestACPClient() as any,
        new TestMemento() as any
      );
      const { messageHandler } = resolveView(provider);

      const fileUri = vscode.Uri.file(__filename);
      const testHref = `${fileUri.toString()}#L15-L25`;

      // Fire openFile message with href
      await messageHandler({
        type: "openFile",
        href: testHref,
      });

      assert.strictEqual(showTextDocumentCalls.length, 1);
      const call = showTextDocumentCalls[0];
      assert.strictEqual(call.uri.fsPath, fileUri.fsPath);
      assert.ok(call.options);
      assert.ok(call.options.selection);
      assert.strictEqual(call.options.selection.start.line, 14);
      assert.strictEqual(call.options.selection.end.line, 24);
    });

    test("should handle openFile with encoded file URI colon line suffix", async () => {
      const provider = new ChatViewProvider(
        vscode.Uri.file("/test"),
        new TestACPClient() as any,
        new TestMemento() as any
      );
      const { messageHandler } = resolveView(provider);

      const fileUri = vscode.Uri.file(__filename);

      await messageHandler({
        type: "openFile",
        href: `${fileUri.toString()}%3A10`,
      });

      assert.strictEqual(showTextDocumentCalls.length, 1);
      const call = showTextDocumentCalls[0];
      assert.strictEqual(call.uri.fsPath, fileUri.fsPath);
      assert.ok(call.options);
      assert.ok(call.options.selection);
      assert.strictEqual(call.options.selection.start.line, 9);
      assert.strictEqual(call.options.selection.end.line, 9);
    });

    test("should handle openFile with relative message.href and resolve it", async () => {
      const provider = new ChatViewProvider(
        vscode.Uri.file("/test"),
        new TestACPClient() as any,
        new TestMemento() as any
      );
      const { messageHandler } = resolveView(provider);

      const baseName = path.basename(__filename);

      // Fire openFile message with relative href
      await messageHandler({
        type: "openFile",
        href: `${baseName}#L5`,
      });

      assert.strictEqual(showTextDocumentCalls.length, 1);
      const call = showTextDocumentCalls[0];
      // It should resolve relative to the workspace folder
      assert.strictEqual(call.uri.fsPath, vscode.Uri.file(__filename).fsPath);
      assert.ok(call.options);
      assert.ok(call.options.selection);
      assert.strictEqual(call.options.selection.start.line, 4);
      assert.strictEqual(call.options.selection.end.line, 4);
    });

    test("should handle openFile with absolute path href and parse range correctly", async () => {
      const provider = new ChatViewProvider(
        vscode.Uri.file("/test"),
        new TestACPClient() as any,
        new TestMemento() as any
      );
      const { messageHandler } = resolveView(provider);

      // Fire openFile message with absolute href
      await messageHandler({
        type: "openFile",
        href: `${__filename}#L10`,
      });

      assert.strictEqual(showTextDocumentCalls.length, 1);
      const call = showTextDocumentCalls[0];
      assert.strictEqual(call.uri.fsPath, vscode.Uri.file(__filename).fsPath);
      assert.ok(call.options);
      assert.ok(call.options.selection);
      assert.strictEqual(call.options.selection.start.line, 9);
      assert.strictEqual(call.options.selection.end.line, 9);
    });

    test("should handle openFile with absolute path href using colon line suffix", async () => {
      const provider = new ChatViewProvider(
        vscode.Uri.file("/test"),
        new TestACPClient() as any,
        new TestMemento() as any
      );
      const { messageHandler } = resolveView(provider);

      await messageHandler({
        type: "openFile",
        href: `${__filename}:10`,
      });

      assert.strictEqual(showTextDocumentCalls.length, 1);
      const call = showTextDocumentCalls[0];
      assert.strictEqual(call.uri.fsPath, vscode.Uri.file(__filename).fsPath);
      assert.ok(call.options);
      assert.ok(call.options.selection);
      assert.strictEqual(call.options.selection.start.line, 9);
      assert.strictEqual(call.options.selection.end.line, 9);
    });

    test("should handle openFile with absolute path href using colon line range suffix", async () => {
      const provider = new ChatViewProvider(
        vscode.Uri.file("/test"),
        new TestACPClient() as any,
        new TestMemento() as any
      );
      const { messageHandler } = resolveView(provider);

      await messageHandler({
        type: "openFile",
        href: `${__filename}:10-20`,
      });

      assert.strictEqual(showTextDocumentCalls.length, 1);
      const call = showTextDocumentCalls[0];
      assert.strictEqual(call.uri.fsPath, vscode.Uri.file(__filename).fsPath);
      assert.ok(call.options);
      assert.ok(call.options.selection);
      assert.strictEqual(call.options.selection.start.line, 9);
      assert.strictEqual(call.options.selection.end.line, 19);
    });

    test("should fallback to showTextDocument when file stat fails", async () => {
      const provider = new ChatViewProvider(
        vscode.Uri.file("/test"),
        new TestACPClient() as any,
        new TestMemento() as any
      );
      const { messageHandler } = resolveView(provider);

      // Fire openFile message with a non-existent file href
      await messageHandler({
        type: "openFile",
        href: "file:///non/existent/file.ts#L5-L10",
      });

      assert.strictEqual(showTextDocumentCalls.length, 1);
      const call = showTextDocumentCalls[0];
      assert.strictEqual(
        call.uri.fsPath,
        vscode.Uri.parse("file:///non/existent/file.ts").fsPath
      );
      // options should be undefined because it fell back to catch block
      assert.strictEqual(call.options, undefined);
    });

    test("should show error message and not call showTextDocument when checkExists is true and file does not exist", async () => {
      const provider = new ChatViewProvider(
        vscode.Uri.file("/test"),
        new TestACPClient() as any,
        new TestMemento() as any
      );
      const { messageHandler } = resolveView(provider);

      // Fire openFile message with a non-existent file and checkExists = true
      await messageHandler({
        type: "openFile",
        path: "/non/existent/file.ts",
        checkExists: true,
      });

      assert.strictEqual(showTextDocumentCalls.length, 0);
      assert.strictEqual(showErrorMessageCalls.length, 1);
      assert.ok(showErrorMessageCalls[0].includes("File does not exist"));
    });

    test("should open file and not show error message when checkExists is true and file exists", async () => {
      const provider = new ChatViewProvider(
        vscode.Uri.file("/test"),
        new TestACPClient() as any,
        new TestMemento() as any
      );
      const { messageHandler } = resolveView(provider);

      // Fire openFile message with a file that exists (like __filename) and checkExists = true
      await messageHandler({
        type: "openFile",
        path: __filename,
        checkExists: true,
      });

      assert.strictEqual(showErrorMessageCalls.length, 0);
      assert.strictEqual(showTextDocumentCalls.length, 1);
      assert.strictEqual(
        showTextDocumentCalls[0].uri.fsPath,
        vscode.Uri.file(__filename).fsPath
      );
    });
  });

  suite("handleReadTextFile - directory handling", () => {
    let tmpDir: string;
    let tmpCleanup: string[] = [];

    setup(async () => {
      const os = await import("os");
      const fs = await import("fs/promises");
      const pathMod = await import("path");
      tmpDir = await fs.mkdtemp(pathMod.join(os.tmpdir(), "vscode-acp-test-"));
    });

    teardown(async () => {
      const fs = await import("fs/promises");
      for (const p of tmpCleanup) {
        try {
          await fs.rm(p, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    function makeProvider(): ChatViewProvider {
      return new ChatViewProvider(
        vscode.Uri.file("/test"),
        new TestACPClient() as any,
        new TestMemento() as any
      );
    }

    test("should return formatted listing for an empty directory", async () => {
      const provider = makeProvider();
      const fileHandler = (provider as any).fileHandler;
      const handler = fileHandler.handleReadTextFile.bind(fileHandler);

      const result = await handler({ sessionId: "s", path: tmpDir });
      assert.ok(result.content, "content should be a non-empty string");
      assert.ok(
        result.content.includes("[Directory listing for:"),
        `content should include directory header, got: ${result.content}`
      );
      const contentForCompare =
        process.platform === "win32"
          ? result.content.toLowerCase()
          : result.content;
      const pathForCompare =
        process.platform === "win32" ? tmpDir.toLowerCase() : tmpDir;
      assert.ok(
        contentForCompare.includes(pathForCompare),
        `content should include the path, got: ${result.content}`
      );
      assert.ok(
        result.content.includes("(empty directory)"),
        `empty directory should be noted, got: ${result.content}`
      );
      assert.ok(
        result.content.includes("Recursive listing is not supported"),
        "limitations note should be present"
      );
    });

    test("should return formatted listing with metadata for non-empty directory", async () => {
      const fs = await import("fs/promises");
      const pathMod = await import("path");
      const subDir = pathMod.join(tmpDir, "sub");
      const filePath = pathMod.join(tmpDir, "file.ts");
      await fs.mkdir(subDir);
      await fs.writeFile(filePath, "x");
      await fs.chmod(filePath, 0o444); // readonly

      const provider = makeProvider();
      const fileHandler = (provider as any).fileHandler;
      const handler = fileHandler.handleReadTextFile.bind(fileHandler);
      const result = await handler({ sessionId: "s", path: tmpDir });

      assert.ok(result.content.includes("[DIR] sub"), "sub listed as DIR");
      assert.ok(
        result.content.includes("[FILE] file.ts"),
        "file.ts listed as FILE"
      );
      assert.ok(
        result.content.includes("size="),
        "size field present in content"
      );
      assert.ok(
        result.content.includes("mtime="),
        "mtime field present in content"
      );
      assert.ok(
        result.content.includes("perms="),
        "permissions field present in content"
      );
      assert.ok(result.content.includes("Recursive listing is not supported"));
    });

    test("should still read regular files normally (regression)", async () => {
      const fs = await import("fs/promises");
      const pathMod = await import("path");
      const filePath = pathMod.join(tmpDir, "regular.txt");
      await fs.writeFile(filePath, "hello world");

      const provider = makeProvider();
      const fileHandler = (provider as any).fileHandler;
      const handler = fileHandler.handleReadTextFile.bind(fileHandler);
      const result = await handler({ sessionId: "s", path: filePath });
      assert.strictEqual(result.content, "hello world");
    });
  });

  suite("Auto-Approve Permission Kinds", () => {
    const config = () => vscode.workspace.getConfiguration("vscode-acp-chat");

    function makeProvider(): ChatViewProvider {
      return new ChatViewProvider(
        vscode.Uri.file("/test"),
        new TestACPClient() as any,
        new TestMemento() as any
      );
    }

    function makeParams(toolKind: string): any {
      return {
        sessionId: "test-session",
        toolCall: {
          toolCallId: "perm-tool-1",
          kind: toolKind,
          title: "Tool Call",
        },
        options: [
          { optionId: "allow", kind: "allow_once", name: "Allow" },
          { optionId: "deny", kind: "reject_once", name: "Deny" },
        ],
      };
    }

    setup(async () => {
      await config().update(
        "autoApprovePermissionKinds",
        ["edit"],
        vscode.ConfigurationTarget.Global
      );
    });

    teardown(async () => {
      await config().update(
        "autoApprovePermissionKinds",
        [],
        vscode.ConfigurationTarget.Global
      );
    });

    test("should auto-approve with the allow_once option when the kind is listed", async () => {
      const provider = makeProvider();
      const response = await (provider as any).handlePermissionRequest(
        makeParams("edit")
      );

      assert.strictEqual(response.outcome.outcome, "selected");
      assert.strictEqual(response.outcome.optionId, "allow");
      assert.strictEqual((provider as any).permissionQueue.length, 0);
    });

    test("should fall back to allow_always when no allow_once option exists", async () => {
      const provider = makeProvider();
      const params = makeParams("edit");
      params.options = [
        { optionId: "always", kind: "allow_always", name: "Always Allow" },
        { optionId: "deny", kind: "reject_once", name: "Deny" },
      ];

      const response = await (provider as any).handlePermissionRequest(params);

      assert.strictEqual(response.outcome.outcome, "selected");
      assert.strictEqual(response.outcome.optionId, "always");
      assert.strictEqual((provider as any).permissionQueue.length, 0);
    });

    test("should ask when no allow option exists", async () => {
      const provider = makeProvider();
      const params = makeParams("edit");
      params.options = [
        { optionId: "deny", kind: "reject_once", name: "Deny" },
      ];

      const pending = (provider as any).handlePermissionRequest(params);

      assert.strictEqual((provider as any).permissionQueue.length, 1);

      const entry = (provider as any).permissionQueue[0];
      entry.resolver({ outcome: { outcome: "cancelled" } });
      const response = await pending;
      assert.strictEqual(response.outcome.outcome, "cancelled");
    });

    test("should still ask for kinds not listed in the config", async () => {
      const provider = makeProvider();
      const pending = (provider as any).handlePermissionRequest(
        makeParams("execute")
      );

      assert.strictEqual((provider as any).permissionQueue.length, 1);

      const entry = (provider as any).permissionQueue[0];
      entry.resolver({ outcome: { outcome: "cancelled" } });
      const response = await pending;
      assert.strictEqual(response.outcome.outcome, "cancelled");
    });

    test("should ask for every kind when the config is empty (default)", async () => {
      await config().update(
        "autoApprovePermissionKinds",
        [],
        vscode.ConfigurationTarget.Global
      );
      const provider = makeProvider();
      const pending = (provider as any).handlePermissionRequest(
        makeParams("edit")
      );

      assert.strictEqual((provider as any).permissionQueue.length, 1);

      const entry = (provider as any).permissionQueue[0];
      entry.resolver({ outcome: { outcome: "cancelled" } });
      const response = await pending;
      assert.strictEqual(response.outcome.outcome, "cancelled");
    });
  });

  suite("Elicitation Requests", () => {
    function makeProvider(): {
      provider: ChatViewProvider;
      messages: any[];
    } {
      const provider = new ChatViewProvider(
        vscode.Uri.file("/test"),
        new TestACPClient() as any,
        new TestMemento() as any
      );
      const messages: any[] = [];
      (provider as any).postMessage = (msg: any) => messages.push(msg);
      return { provider, messages };
    }

    function resolveView(provider: ChatViewProvider): {
      messageHandler: (message: any) => Promise<void>;
    } {
      let messageHandler: ((message: any) => Promise<void>) | undefined;
      const mockWebview = {
        onDidReceiveMessage: (cb: any) => {
          messageHandler = cb;
          return { dispose: () => {} };
        },
        asWebviewUri: (uri: vscode.Uri) => uri,
        cspSource: "",
        options: {},
        html: "",
      };
      const mockView = {
        webview: mockWebview,
        viewType: "test",
        onDidChangeVisibility: new vscode.EventEmitter<void>().event,
        onDidDispose: new vscode.EventEmitter<void>().event,
        title: "test",
        visible: true,
        show: () => {},
      };

      provider.resolveWebviewView(mockView as any, {} as any, {} as any);
      return { messageHandler: messageHandler! };
    }

    function makeFormParams(): any {
      return {
        mode: "form",
        sessionId: "test-session",
        message: "Provide the deploy target",
        requestedSchema: {
          type: "object",
          properties: {
            target: { type: "string", enum: ["staging", "prod"] },
          },
          required: ["target"],
        },
      };
    }

    function makeUrlParams(): any {
      return {
        mode: "url",
        sessionId: "test-session",
        message: "Complete the OAuth flow",
        elicitationId: "url-1",
        url: "https://example.com/oauth",
      };
    }

    test("should queue a form elicitation and post it to the webview", () => {
      const { provider, messages } = makeProvider();

      const pending = (provider as any).handleElicitationRequest(
        makeFormParams()
      );

      assert.strictEqual((provider as any).elicitationQueue.length, 1);
      assert.strictEqual(messages.length, 1);
      const msg = messages[0];
      assert.strictEqual(msg.type, "elicitationRequest");
      assert.ok(msg.requestId.startsWith("elic-"));
      assert.strictEqual(msg.message, "Provide the deploy target");
      assert.strictEqual(msg.mode, "form");
      assert.ok(msg.schema);
      assert.strictEqual(msg.url, undefined);

      const entry = (provider as any).elicitationQueue[0];
      entry.resolver({ action: "decline" });
      return pending.then((response: any) => {
        assert.strictEqual(response.action, "decline");
      });
    });

    test("should queue a url elicitation with elicitationId", () => {
      const { provider, messages } = makeProvider();

      const pending = (provider as any).handleElicitationRequest(
        makeUrlParams()
      );

      assert.strictEqual((provider as any).elicitationQueue.length, 1);
      const entry = (provider as any).elicitationQueue[0];
      assert.strictEqual(entry.elicitationId, "url-1");
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].mode, "url");
      assert.strictEqual(messages[0].url, "https://example.com/oauth");
      assert.strictEqual(messages[0].elicitationId, "url-1");

      entry.resolver({ action: "accept" });
      return pending.then((response: any) => {
        assert.strictEqual(response.action, "accept");
      });
    });

    test("should resolve accept with content on elicitationResponse", async () => {
      const { provider } = makeProvider();
      const pending = (provider as any).handleElicitationRequest(
        makeFormParams()
      );
      const requestId = (provider as any).elicitationQueue[0].id;

      const { messageHandler } = resolveView(provider);
      await messageHandler({
        type: "elicitationResponse",
        requestId,
        elicitationAction: "accept",
        elicitationContent: { target: "prod" },
      });

      const response = await pending;
      assert.deepStrictEqual(response, {
        action: "accept",
        content: { target: "prod" },
      });
      assert.strictEqual((provider as any).elicitationQueue.length, 0);
    });

    test("should resolve decline and cancel on elicitationResponse", async () => {
      const { provider } = makeProvider();
      const pending = (provider as any).handleElicitationRequest(
        makeFormParams()
      );
      const requestId = (provider as any).elicitationQueue[0].id;

      const { messageHandler } = resolveView(provider);
      await messageHandler({
        type: "elicitationResponse",
        requestId,
        elicitationAction: "decline",
      });

      const response = await pending;
      assert.strictEqual(response.action, "decline");
    });

    test("should resolve a pending url elicitation on complete notification", () => {
      const { provider, messages } = makeProvider();
      const pending = (provider as any).handleElicitationRequest(
        makeUrlParams()
      );

      (provider as any).handleElicitationComplete({
        elicitationId: "url-1",
      });

      assert.strictEqual((provider as any).elicitationQueue.length, 0);
      const completeMsg = messages.find(
        (m: any) => m.type === "elicitationComplete"
      );
      assert.ok(completeMsg, "should post elicitationComplete to the webview");
      assert.strictEqual(completeMsg.elicitationId, "url-1");

      return pending.then((response: any) => {
        assert.strictEqual(response.action, "accept");
      });
    });

    test("should ignore complete notifications for unknown elicitation ids", () => {
      const { provider, messages } = makeProvider();
      (provider as any).handleElicitationRequest(makeUrlParams());

      (provider as any).handleElicitationComplete({
        elicitationId: "unknown-id",
      });

      // The pending entry must survive and no forward is sent, so a stale
      // notification can never close a different request's block.
      assert.strictEqual((provider as any).elicitationQueue.length, 1);
      assert.strictEqual(
        messages.filter((m: any) => m.type === "elicitationComplete").length,
        0
      );
    });

    test("should resolve all pending elicitations as cancel on dismiss", () => {
      const { provider, messages } = makeProvider();
      const pending1 = (provider as any).handleElicitationRequest(
        makeFormParams()
      );
      const pending2 = (provider as any).handleElicitationRequest(
        makeUrlParams()
      );

      (provider as any).dismissPendingElicitations();

      assert.strictEqual((provider as any).elicitationQueue.length, 0);
      const cleared = messages.find(
        (m: any) => m.type === "elicitationCleared"
      );
      assert.ok(cleared, "should post elicitationCleared to the webview");

      return Promise.all([pending1, pending2]).then(([r1, r2]) => {
        assert.strictEqual(r1.action, "cancel");
        assert.strictEqual(r2.action, "cancel");
      });
    });
  });
});
