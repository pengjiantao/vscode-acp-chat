import * as assert from "assert";
import * as vscode from "vscode";
import { ChatViewProvider } from "../views/chat";

class MockMemento implements vscode.Memento {
  private data = new Map<string, any>();
  get<T>(key: string): T | undefined {
    return this.data.get(key);
  }
  update(key: string, value: any): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
  keys(): readonly string[] {
    return Array.from(this.data.keys());
  }
}

class MockWebview {
  public messages: any[] = [];
  async postMessage(message: any) {
    this.messages.push(message);
    return true;
  }
  onDidReceiveMessage = new vscode.EventEmitter<any>().event;
  asWebviewUri(uri: vscode.Uri) {
    return uri;
  }
  cspSource = "";
  options = {};
  html = "";
}

class MockWebviewView implements vscode.WebviewView {
  public webview = new MockWebview() as any;
  public viewType = "test";
  public onDidChangeVisibility = new vscode.EventEmitter<void>().event;
  public onDidDispose = new vscode.EventEmitter<void>().event;
  public title = "test";
  public description = "test";
  public visible = true;
  public badge = undefined;
  public show() {}
}

suite("History Restoration Order Integration", () => {
  test("should post userMessage before thoughtChunk during history restoration", async () => {
    const memento = new MockMemento();
    const mockAcpClient = {
      setAgent: () => {},
      getAgentId: () => "test-agent",
      setOnStateChange: () => () => {},
      setOnSessionUpdate: (cb: any) => {
        mockAcpClient.sessionUpdateHandler = cb;
        return () => {};
      },
      setOnStderr: () => () => {},
      setOnReadTextFile: () => {},
      setOnWriteTextFile: () => {},
      setOnCreateTerminal: () => {},
      setOnTerminalOutput: () => {},
      setOnWaitForTerminalExit: () => {},
      setOnKillTerminalCommand: () => {},
      setOnReleaseTerminal: () => {},
      setOnPermissionRequest: () => {},
      isConnected: () => true,
      connect: async () => {},
      newSession: async () => {},
      sessionUpdateHandler: (_update: any) => {},
      dispose: () => {},
    };

    const provider = new ChatViewProvider(
      vscode.Uri.file("/test"),
      mockAcpClient as any,
      memento
    );

    const mockView = new MockWebviewView();
    provider.resolveWebviewView(mockView, {} as any, {} as any);

    // Simulate history loading scenario
    // We need to set isLoadingHistory to true so that user_message_chunk is not ignored
    // (During normal conversation, opencode echoes back user messages which should be ignored)
    (provider as any).isLoadingHistory = true;

    // Simulate history chunks
    const handler = mockAcpClient.sessionUpdateHandler;

    // 1. User message chunks
    await handler({
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "Explain " },
      },
    });
    await handler({
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "this code." },
      },
    });

    // Verify no userMessage posted yet
    assert.strictEqual(
      mockView.webview.messages.filter((m: any) => m.type === "userMessage")
        .length,
      0
    );

    // 2. Agent thought chunk (should trigger flush)
    await handler({
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Thinking..." },
      },
    });

    // 3. Verify order
    const messages = mockView.webview.messages;
    const userMsgIndex = messages.findIndex(
      (m: any) => m.type === "userMessage"
    );
    const thoughtChunkIndex = messages.findIndex(
      (m: any) => m.type === "thoughtChunk"
    );

    assert.notStrictEqual(userMsgIndex, -1, "userMessage should be posted");
    assert.notStrictEqual(
      thoughtChunkIndex,
      -1,
      "thoughtChunk should be posted"
    );
    assert.ok(
      userMsgIndex < thoughtChunkIndex,
      "userMessage should come before thoughtChunk"
    );

    assert.strictEqual(messages[userMsgIndex].text, "Explain this code.");
    assert.strictEqual(messages[thoughtChunkIndex].text, "Thinking...");
  });
});
