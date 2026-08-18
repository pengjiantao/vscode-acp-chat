/* eslint-disable @typescript-eslint/no-explicit-any */
import * as assert from "assert";
import * as vscode from "vscode";
import { JSDOM } from "jsdom";
import { ChatViewProvider } from "../views/chat";
import { WebviewController } from "../views/webview/main";
import type { VsCodeApi } from "../views/webview/types";

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

const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body>
  <div id="welcome-view" class="welcome-view">
    <div class="welcome-logo" role="img" aria-label="VSCode ACP Logo"></div>
    <h3>Welcome to VSCode ACP</h3>
  </div>
  <div id="agent-plan-container"></div>
  <div id="messages-container">
    <div id="messages"></div>
  </div>
  <div id="typing-indicator">
    <div class="zed-loader"><div></div><div></div><div></div></div>
  </div>
  <div id="diff-summary-container"></div>
  <div id="chat-input-area">
    <div id="input-container">
      <div id="command-autocomplete" role="listbox"></div>
      <div id="input" contenteditable="true"></div>
    </div>
    <div id="options-bar">
      <div id="left-options">
        <button id="attach-image">Attach</button>
        <div class="custom-dropdown" id="mode-dropdown">
          <div class="dropdown-trigger"><span class="selected-label"></span></div>
          <div class="dropdown-popover"></div>
        </div>
        <div class="custom-dropdown" id="model-dropdown">
          <div class="dropdown-trigger"><span class="selected-label"></span></div>
          <div class="dropdown-popover"></div>
        </div>
        <div id="config-options-container"></div>
        <div id="context-usage-ring" class="context-usage" hidden>
          <svg viewBox="0 0 18 18" width="18" height="18" role="img">
            <circle class="context-usage__bg" cx="9" cy="9" r="7"></circle>
            <circle class="context-usage__fg" cx="9" cy="9" r="7" transform="rotate(-90 9 9)"></circle>
          </svg>
        </div>
      </div>
      <div id="right-options">
        <button id="send">Send</button>
        <button id="stop">Stop</button>
      </div>
    </div>
  </div>
  <div id="image-preview-popover">
    <img src="">
  </div>
</body>
</html>`;

function createMockController() {
  const dom = new JSDOM(html, {
    url: "http://localhost",
    runScripts: "dangerously",
  });
  const document = dom.window.document;
  const window = dom.window as unknown as Window;

  const messages: any[] = [];
  const mockVsCode: VsCodeApi & { _getMessages: () => any[] } = {
    postMessage: (msg: any) => messages.push(msg),
    getState: () => undefined,
    setState: (s) => s,
    _getMessages: () => messages,
  };

  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    return setTimeout(() => cb(Date.now()), 0) as unknown as number;
  };
  (window as any).cancelAnimationFrame = (id: number) => clearTimeout(id);

  const controller = new WebviewController(mockVsCode, document, window);
  return { dom, document, window, controller, mockVsCode };
}

suite("Session Loading Feedback Test Suite", () => {
  test("Webview controller displays loading placeholder on sessionCreated with isLoading: true", async () => {
    const { controller, document } = createMockController();

    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "pending-123",
        agentId: "claude-code",
        agentName: "Claude Code",
        title: "New session",
        isLoading: true,
        loadingTitle: "Starting agent...",
      },
    });

    const activeTab = document.querySelector(".tab-item.active");
    assert.ok(activeTab, "active tab should exist");
    assert.strictEqual(
      activeTab.getAttribute("data-session-id"),
      "pending-123"
    );

    // Tab spinner should be visible
    const tabSpinner = activeTab.querySelector(
      ".tab-generating-indicator"
    ) as HTMLElement;
    assert.ok(tabSpinner);
    assert.strictEqual(tabSpinner.style.display, "inline-block");

    // Message list should show loading placeholder
    const placeholder = document.querySelector(".session-loading-placeholder");
    assert.ok(placeholder, "loading placeholder should be in the DOM");
    assert.ok(placeholder.textContent?.includes("Starting agent..."));

    // Welcome view should be hidden, messages container shown
    const welcomeView = document.getElementById("welcome-view") as HTMLElement;
    const messagesContainer = document.getElementById(
      "messages-container"
    ) as HTMLElement;
    assert.strictEqual(welcomeView.style.display, "none");
    assert.strictEqual(messagesContainer.style.display, "flex");

    // Send button should be disabled while loading
    const sendBtn = document.getElementById("send") as HTMLButtonElement;
    assert.strictEqual(sendBtn.disabled, true);
  });

  test("Webview controller migrates tab and clears loading placeholder on sessionIdChanged", async () => {
    const { controller, document } = createMockController();

    // 1. Initial pending session
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "pending-123",
        agentId: "claude-code",
        agentName: "Claude Code",
        title: "New session",
        isLoading: true,
        loadingTitle: "Starting agent...",
      },
    });

    assert.ok(document.querySelector(".session-loading-placeholder"));

    // 2. Real session resolves
    await controller.handleMessage({
      type: "sessionIdChanged",
      oldSessionId: "pending-123",
      newSessionId: "real-session-456",
      session: {
        sessionId: "real-session-456",
        agentId: "claude-code",
        agentName: "Claude Code",
        title: "New session",
        isLoading: false,
      },
    });

    // Loading placeholder removed
    assert.strictEqual(
      document.querySelector(".session-loading-placeholder"),
      null,
      "loading placeholder should be removed"
    );

    // Tab ID updated
    const activeTab = document.querySelector(".tab-item.active");
    assert.ok(activeTab);
    assert.strictEqual(
      activeTab.getAttribute("data-session-id"),
      "real-session-456"
    );

    // Tab spinner hidden
    const tabSpinner = activeTab.querySelector(
      ".tab-generating-indicator"
    ) as HTMLElement;
    assert.strictEqual(tabSpinner.style.display, "none");

    // Empty new session should now show welcome view
    const welcomeView = document.getElementById("welcome-view") as HTMLElement;
    assert.strictEqual(welcomeView.style.display, "flex");
  });

  test("Webview controller clears loading placeholder as soon as history messages start arriving", async () => {
    const { controller, document } = createMockController();

    // 1. Load history session
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "history-session-789",
        agentId: "claude-code",
        agentName: "Claude Code",
        title: "Existing Chat",
        isLoading: true,
        loadingTitle: "Loading conversation...",
      },
    });

    assert.ok(document.querySelector(".session-loading-placeholder"));

    // 2. First message arrives
    await controller.handleMessage({
      type: "userMessage",
      sessionId: "history-session-789",
      text: "Hello from the past",
    });

    // Loading placeholder should be dismissed immediately
    assert.strictEqual(
      document.querySelector(".session-loading-placeholder"),
      null,
      "loading placeholder should be removed on first message"
    );

    // Message container displayed with message
    const welcomeView = document.getElementById("welcome-view") as HTMLElement;
    const messagesContainer = document.getElementById(
      "messages-container"
    ) as HTMLElement;
    assert.strictEqual(welcomeView.style.display, "none");
    assert.strictEqual(messagesContainer.style.display, "flex");

    const messageEls = document.querySelectorAll(".message.user");
    assert.strictEqual(messageEls.length, 1);
    assert.ok(messageEls[0].textContent?.includes("Hello from the past"));
  });

  test("Webview controller dismisses loading and shows error on sessionLoadFailed", async () => {
    const { controller, document } = createMockController();

    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "pending-err",
        agentId: "claude-code",
        agentName: "Claude Code",
        title: "New session",
        isLoading: true,
      },
    });

    assert.ok(document.querySelector(".session-loading-placeholder"));

    await controller.handleMessage({
      type: "sessionLoadFailed",
      sessionId: "pending-err",
      error: "Agent process failed to start",
    });

    // Loading placeholder removed
    assert.strictEqual(
      document.querySelector(".session-loading-placeholder"),
      null
    );

    // Error message added
    const errorMsg = document.querySelector(".message.error");
    assert.ok(errorMsg, "error message should be displayed");
    assert.ok(errorMsg.textContent?.includes("Agent process failed to start"));
  });

  test("ChatViewProvider immediately emits sessionCreated with isLoading: true on createNewSession", async () => {
    const memento = new MockMemento();
    let resolveNewSession: (value: any) => void;
    const client = {
      setAgent: () => {},
      getAgentId: () => "claude-code",
      getAgentName: () => "Claude Code",
      getState: () => "connected",
      getCurrentSessionId: () => "real-session",
      getAgentCapabilities: () => ({ sessionCapabilities: { close: {} } }),
      getNesDocumentCapabilities: () => ({}),
      getSessionMetadata: (_sessionId: string) => ({
        modes: null,
        models: null,
        genericConfigOptions: [],
        commands: null,
        lastUsageUpdate: null,
      }),
      getLastUsageUpdate: (_sessionId: string) => null,
      clearLastUsageUpdate: (_sessionId: string) => {},
      setOnStateChange: () => () => {},
      setOnSessionUpdate: () => () => {},
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
      newSession: () =>
        new Promise((resolve) => {
          resolveNewSession = resolve;
        }),
      closeSession: async () => {},
      cancel: async () => {},
      listSessions: async () => ({ sessions: [] }),
      loadSession: async () => {},
      dispose: () => {},
    };

    const provider = ChatViewProvider.createForTest(
      vscode.Uri.file("/test"),
      client as any,
      memento
    );
    const mockView = new MockWebviewView();
    (provider as any).view = mockView;

    // Start session creation (which hangs on client.newSession)
    const creationPromise = provider.createNewSession("claude-code");

    await (provider as any).webviewPostNotifier.waitForIdle();

    // Immediately, sessionCreated was sent
    const createdMessages = mockView.webview.messages.filter(
      (m: any) => m.type === "sessionCreated"
    );
    assert.strictEqual(createdMessages.length, 1);
    assert.ok(createdMessages[0].session.sessionId.startsWith("pending-"));
    assert.strictEqual(createdMessages[0].session.isLoading, true);

    // Wait for async getClient to resolve and newSession to be invoked
    await new Promise((r) => setTimeout(r, 20));

    // Now resolve the backend RPC
    resolveNewSession!({ sessionId: "resolved-session-999" });
    const resolvedTab = await creationPromise;

    await (provider as any).webviewPostNotifier.waitForIdle();

    assert.strictEqual(resolvedTab.sessionId, "resolved-session-999");
    assert.strictEqual(resolvedTab.isLoading, false);

    const changedMessages = mockView.webview.messages.filter(
      (m: any) => m.type === "sessionIdChanged"
    );
    assert.strictEqual(changedMessages.length, 1);
    assert.strictEqual(changedMessages[0].newSessionId, "resolved-session-999");
  });

  test("Background session loading and resolution updates tab spinner without disturbing active session", async () => {
    const { controller, document } = createMockController();

    // 1. Session A is active and ready
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "session-a",
        agentId: "claude-code",
        agentName: "Claude Code",
        title: "Session A",
        isLoading: false,
      },
    });

    // Input panel should not be in loading state
    assert.strictEqual(controller.inputPanel.getIsLoading(), false);

    // 2. Session B is created in background (loading)
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "pending-b",
        agentId: "opencode",
        agentName: "OpenCode",
        title: "Session B",
        isLoading: true,
      },
    });

    // Switch back to Session A
    controller.switchActiveSession("session-a");

    const tabA = document.querySelector(
      '.tab-item[data-session-id="session-a"]'
    ) as HTMLElement;
    const tabB = document.querySelector(
      '.tab-item[data-session-id="pending-b"]'
    ) as HTMLElement;
    assert.ok(tabA && tabB);
    assert.strictEqual(tabA.classList.contains("active"), true);

    const spinnerB = tabB.querySelector(
      ".tab-generating-indicator"
    ) as HTMLElement;
    assert.strictEqual(spinnerB.style.display, "inline-block");
    assert.strictEqual(controller.inputPanel.getIsLoading(), false);

    // 3. Background session B finishes loading / changes ID
    await controller.handleMessage({
      type: "sessionIdChanged",
      oldSessionId: "pending-b",
      newSessionId: "real-session-b",
      session: {
        sessionId: "real-session-b",
        agentId: "opencode",
        agentName: "OpenCode",
        title: "Session B",
        isLoading: false,
      },
    });

    // Tab B should have updated ID and hidden spinner
    const updatedTabB = document.querySelector(
      '.tab-item[data-session-id="real-session-b"]'
    ) as HTMLElement;
    assert.ok(updatedTabB, "Tab B should have updated session ID");
    const updatedSpinnerB = updatedTabB.querySelector(
      ".tab-generating-indicator"
    ) as HTMLElement;
    assert.strictEqual(updatedSpinnerB.style.display, "none");

    // Active session A remains active and input remains not loading
    assert.strictEqual(tabA.classList.contains("active"), true);
    assert.strictEqual(controller.inputPanel.getIsLoading(), false);
  });

  test("Closing tab while loadHistorySession is in-flight prevents ghost messages and unregisters session", async () => {
    const memento = new MockMemento();
    let resolveLoadSession: () => void;
    const calls: string[] = [];

    const client = {
      setAgent: () => {},
      getAgentId: () => "claude-code",
      getAgentName: () => "Claude Code",
      getState: () => "connected",
      getCurrentSessionId: () => "history-123",
      getAgentCapabilities: () => ({ sessionCapabilities: { close: {} } }),
      getNesDocumentCapabilities: () => ({}),
      getSessionMetadata: (_sessionId: string) => ({
        modes: null,
        models: null,
        genericConfigOptions: [],
        commands: null,
        lastUsageUpdate: null,
      }),
      getLastUsageUpdate: (_sessionId: string) => null,
      clearLastUsageUpdate: (_sessionId: string) => {},
      setOnStateChange: () => () => {},
      setOnSessionUpdate: () => () => {},
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
      newSession: async () => ({ sessionId: "new-s" }),
      loadSession: () =>
        new Promise<void>((resolve) => {
          calls.push("loadSession:started");
          resolveLoadSession = resolve;
        }),
      closeSession: async (params: { sessionId: string }) => {
        calls.push(`closeSession:${params.sessionId}`);
      },
      cancel: async () => {},
      listSessions: async () => ({ sessions: [] }),
      dispose: () => {},
    };

    const provider = ChatViewProvider.createForTest(
      vscode.Uri.file("/test"),
      client as any,
      memento
    );
    const mockView = new MockWebviewView();
    (provider as any).view = mockView;

    // Start loading history session
    const loadPromise = provider.loadHistorySession(
      "history-123",
      "claude-code"
    );
    await (provider as any).webviewPostNotifier.waitForIdle();

    // Session tab was created with isLoading
    assert.strictEqual((provider as any).openSessions.has("history-123"), true);

    // Wait until loadSession has actually started on client
    while (!calls.includes("loadSession:started")) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // User closes the tab while loadSession is in-flight
    await provider.closeSession("claude-code", "history-123");
    assert.strictEqual(
      (provider as any).openSessions.has("history-123"),
      false
    );

    // Now loadSession backend RPC completes
    resolveLoadSession!();
    await loadPromise;
    await (provider as any).webviewPostNotifier.waitForIdle();

    // Verify NO sessionLoaded or streamEnd message was posted for the closed session
    const sessionLoadedMsgs = mockView.webview.messages.filter(
      (m: any) => m.type === "sessionLoaded" && m.sessionId === "history-123"
    );
    assert.strictEqual(sessionLoadedMsgs.length, 0);

    const historyStreamEndMsgs = mockView.webview.messages.filter(
      (m: any) =>
        m.type === "streamEnd" &&
        m.stopReason === "history_load" &&
        m.sessionId === "history-123"
    );
    assert.strictEqual(historyStreamEndMsgs.length, 0);

    // Verify remote closeSession was called on client to clean up agent resources
    assert.ok(
      calls.includes("closeSession:history-123"),
      "should close remote session on agent"
    );
  });
});
