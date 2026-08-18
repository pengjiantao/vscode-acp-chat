/* eslint-disable @typescript-eslint/no-explicit-any */
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

function createCloseSessionClient() {
  const calls: string[] = [];
  const sessionUpdateListeners: Array<(update: any) => void | Promise<void>> =
    [];
  const client = {
    setAgent: () => {},
    getAgentId: () => "test-agent",
    getAgentName: () => "Test Agent",
    getState: () => "connected",
    getCurrentSessionId: () => null,
    getAgentCapabilities: () => ({
      loadSession: true,
      sessionCapabilities: { close: {} },
    }),
    getNesDocumentCapabilities: () => ({
      didOpen: false,
      didChange: null,
      didClose: false,
      didSave: false,
      didFocus: false,
    }),
    getSessionMetadata: () => ({
      modes: null,
      models: null,
      genericConfigOptions: [],
      commands: null,
      lastUsageUpdate: null,
    }),
    clearLastUsageUpdate: () => {},
    setOnStateChange: () => () => {},
    setOnSessionUpdate: (cb: any) => {
      sessionUpdateListeners.push(cb);
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
    setOnElicitationRequest: () => {},
    setOnElicitationComplete: () => {},
    isConnected: () => true,
    connect: async () => {},
    newSession: async () => {
      calls.push("new");
      return { sessionId: "replacement-session" };
    },
    closeSession: async (params: { sessionId: string }) => {
      calls.push(`close:${params.sessionId}`);
    },
    cancel: async () => {
      calls.push("cancel");
    },
    listSessions: async () => ({ sessions: [] }),
    loadSession: async () => {},
    dispose: () => {},
    calls,
  };

  return client;
}

async function waitForProviderQueues(
  provider: ChatViewProvider
): Promise<void> {
  await (provider as any).sessionUpdateNotifier.waitForIdle();
  await (provider as any).webviewPostNotifier.waitForIdle();
}

async function tick() {
  // Allow microtasks (fire-and-forget createNewSession promise) to settle.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

suite("closeSession auto-creates a replacement when last tab is closed", () => {
  test("closing the last active tab auto-creates a new session with the closed tab's agent", async () => {
    const memento = new MockMemento();
    const mockAcpClient = createCloseSessionClient();
    const provider = ChatViewProvider.createForTest(
      vscode.Uri.file("/test"),
      mockAcpClient as any,
      memento
    );
    const mockView = new MockWebviewView();
    (provider as any).view = mockView;

    (provider as any).activeSessionId = "only-session";
    (provider as any).activeAgentId = "claude-code";
    (provider as any).openSessions.set("only-session", {
      sessionId: "only-session",
      agentId: "claude-code",
      agentName: "Claude Code",
      title: "Only session",
    });

    await provider.closeSession("claude-code", "only-session");
    await waitForProviderQueues(provider);
    await tick();

    // The close RPC happened.
    assert.ok(
      mockAcpClient.calls.includes("close:only-session"),
      `expected close:only-session in calls, got ${mockAcpClient.calls.join(", ")}`
    );
    // And a new session was created for the same agent.
    assert.ok(
      mockAcpClient.calls.includes("new"),
      `expected new session creation, got ${mockAcpClient.calls.join(", ")}`
    );

    // The replacement session is now the only one, and it's active.
    const openSessions = (provider as any).openSessions as Map<string, any>;
    assert.strictEqual(openSessions.size, 1);
    assert.strictEqual(
      openSessions.get("replacement-session").agentId,
      "claude-code"
    );
    assert.strictEqual(
      (provider as any).activeSessionId,
      "replacement-session"
    );
    assert.strictEqual((provider as any).activeAgentId, "claude-code");

    // A sessionCreated message was posted to the webview.
    const createdMessages = mockView.webview.messages.filter(
      (m: any) => m.type === "sessionCreated"
    );
    assert.strictEqual(createdMessages.length, 1);
    assert.strictEqual(
      createdMessages[0].session.sessionId,
      "replacement-session"
    );
    assert.strictEqual(createdMessages[0].session.agentId, "claude-code");
  });

  test("auto-create uses the closed tab's agentId even when it differs from activeAgentId", async () => {
    const memento = new MockMemento();
    const mockAcpClient = createCloseSessionClient();
    const provider = ChatViewProvider.createForTest(
      vscode.Uri.file("/test"),
      mockAcpClient as any,
      memento
    );
    const mockView = new MockWebviewView();
    (provider as any).view = mockView;

    // The closed tab belongs to opencode, but activeAgentId was previously set
    // to a different agent. The replacement must follow the closed tab.
    (provider as any).activeSessionId = "opencode-session";
    (provider as any).activeAgentId = "opencode";
    (provider as any).openSessions.set("opencode-session", {
      sessionId: "opencode-session",
      agentId: "opencode",
      agentName: "OpenCode",
      title: "OpenCode session",
    });

    await provider.closeSession("opencode", "opencode-session");
    await waitForProviderQueues(provider);
    await tick();

    const openSessions = (provider as any).openSessions as Map<string, any>;
    assert.strictEqual(openSessions.size, 1);
    assert.strictEqual(
      openSessions.get("replacement-session").agentId,
      "opencode"
    );
    assert.strictEqual((provider as any).activeAgentId, "opencode");
  });

  test("closing a tab while other tabs remain does NOT auto-create a new session", async () => {
    const memento = new MockMemento();
    const mockAcpClient = createCloseSessionClient();
    const provider = ChatViewProvider.createForTest(
      vscode.Uri.file("/test"),
      mockAcpClient as any,
      memento
    );
    const mockView = new MockWebviewView();
    (provider as any).view = mockView;

    (provider as any).activeSessionId = "session-a";
    (provider as any).activeAgentId = "agent-a";
    (provider as any).openSessions.set("session-a", {
      sessionId: "session-a",
      agentId: "agent-a",
      agentName: "Agent A",
      title: "A",
    });
    (provider as any).openSessions.set("session-b", {
      sessionId: "session-b",
      agentId: "agent-b",
      agentName: "Agent B",
      title: "B",
    });

    await provider.closeSession("agent-a", "session-a");
    await waitForProviderQueues(provider);
    await tick();

    assert.ok(
      !mockAcpClient.calls.includes("new"),
      `did not expect new session creation when a tab remains, got calls: ${mockAcpClient.calls.join(", ")}`
    );

    const openSessions = (provider as any).openSessions as Map<string, any>;
    assert.strictEqual(openSessions.size, 1);
    assert.strictEqual((provider as any).activeSessionId, "session-b");
  });

  test("closing a non-active tab as the last one DOES auto-create (it is the active tab by definition)", async () => {
    // If there is only one tab and it's not active, closing it still leaves
    // an empty panel — the auto-create path must still fire.
    const memento = new MockMemento();
    const mockAcpClient = createCloseSessionClient();
    const provider = ChatViewProvider.createForTest(
      vscode.Uri.file("/test"),
      mockAcpClient as any,
      memento
    );
    const mockView = new MockWebviewView();
    (provider as any).view = mockView;

    (provider as any).activeSessionId = "some-other-session";
    (provider as any).activeAgentId = "agent-a";
    (provider as any).openSessions.set("only-remaining", {
      sessionId: "only-remaining",
      agentId: "agent-b",
      agentName: "Agent B",
      title: "B",
    });

    await provider.closeSession("agent-b", "only-remaining");
    await waitForProviderQueues(provider);
    await tick();

    assert.ok(
      mockAcpClient.calls.includes("new"),
      `expected auto-create when closing the only remaining tab, got calls: ${mockAcpClient.calls.join(", ")}`
    );

    const openSessions = (provider as any).openSessions as Map<string, any>;
    assert.strictEqual(openSessions.size, 1);
    assert.strictEqual(
      openSessions.get("replacement-session").agentId,
      "agent-b"
    );
  });
});
