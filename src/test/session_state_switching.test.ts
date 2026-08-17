/* eslint-disable @typescript-eslint/no-explicit-any */
import * as assert from "assert";
import { JSDOM } from "jsdom";
import { WebviewController } from "../views/webview/main";
import type { VsCodeApi } from "../views/webview/types";

suite("Session State Switching Test Suite", () => {
  let dom: JSDOM;
  let document: Document;
  let window: Window;
  let mockVsCode: VsCodeApi & { _getMessages: () => any[] };
  let controller: WebviewController;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
</head>
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
    <div class="zed-loader">
      <div></div><div></div><div></div><div></div>
    </div>
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
          <div class="dropdown-trigger">
            <span class="selected-label"></span>
          </div>
          <div class="dropdown-popover"></div>
        </div>
        <div class="custom-dropdown" id="model-dropdown">
          <div class="dropdown-trigger">
            <span class="selected-label"></span>
          </div>
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

  setup(() => {
    dom = new JSDOM(html, {
      url: "http://localhost",
      runScripts: "dangerously",
    });
    document = dom.window.document;
    window = dom.window as unknown as Window;

    const messages: any[] = [];
    mockVsCode = {
      postMessage: (msg: any) => messages.push(msg),
      getState: () => undefined,
      setState: (s) => s,
      _getMessages: () => messages,
    };

    (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(Date.now()), 0) as unknown as number;
    };
    (window as any).cancelAnimationFrame = (id: number) => clearTimeout(id);

    controller = new WebviewController(mockVsCode, document, window);
  });

  teardown(() => {
    dom.window.close();
  });

  test("generating state does not bleed from active session to new session on tab switch", async () => {
    // 1. Initialize session 1
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "session-1",
        agentId: "claude",
        agentName: "Claude",
        title: "Session 1",
      },
    });

    assert.strictEqual((controller as any).activeSessionId, "session-1");
    const sendBtn = document.getElementById("send") as HTMLButtonElement;
    const stopBtn = document.getElementById("stop") as HTMLButtonElement;

    assert.strictEqual(sendBtn.style.display, "flex");
    assert.strictEqual(stopBtn.style.display, "none");

    // 2. Stream starts in Session 1
    await controller.handleMessage({
      type: "streamStart",
      sessionId: "session-1",
    });

    assert.strictEqual(sendBtn.style.display, "none");
    assert.strictEqual(stopBtn.style.display, "flex");

    // 3. User creates Session 2
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "session-2",
        agentId: "claude",
        agentName: "Claude",
        title: "Session 2",
      },
    });

    assert.strictEqual((controller as any).activeSessionId, "session-2");
    // Session 2 should NOT be generating!
    assert.strictEqual(sendBtn.style.display, "flex");
    assert.strictEqual(stopBtn.style.display, "none");

    // 4. Switch back to Session 1
    controller.switchActiveSession("session-1");
    assert.strictEqual((controller as any).activeSessionId, "session-1");
    // Session 1 should still be generating
    assert.strictEqual(sendBtn.style.display, "none");
    assert.strictEqual(stopBtn.style.display, "flex");

    // 5. Switch back to Session 2
    controller.switchActiveSession("session-2");
    assert.strictEqual((controller as any).activeSessionId, "session-2");
    // Session 2 MUST NOT become generating
    assert.strictEqual(sendBtn.style.display, "flex");
    assert.strictEqual(stopBtn.style.display, "none");
  });

  test("background streamEnd on inactive session updates session state without disturbing active session", async () => {
    // 1. Create session 1
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "session-1",
        agentId: "claude",
        agentName: "Claude",
        title: "Session 1",
      },
    });

    // 2. Start stream on session 1
    await controller.handleMessage({
      type: "streamStart",
      sessionId: "session-1",
    });

    // 3. Create and switch to session 2
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "session-2",
        agentId: "claude",
        agentName: "Claude",
        title: "Session 2",
      },
    });

    const sendBtn = document.getElementById("send") as HTMLButtonElement;
    const stopBtn = document.getElementById("stop") as HTMLButtonElement;
    assert.strictEqual(sendBtn.style.display, "flex");
    assert.strictEqual(stopBtn.style.display, "none");

    // 4. Stream ends on background session 1
    await controller.handleMessage({
      type: "streamEnd",
      sessionId: "session-1",
    });

    // Session 2 still idle
    assert.strictEqual(sendBtn.style.display, "flex");
    assert.strictEqual(stopBtn.style.display, "none");

    // 5. Switch back to session 1 — it should now be idle (not generating)
    controller.switchActiveSession("session-1");
    assert.strictEqual(sendBtn.style.display, "flex");
    assert.strictEqual(stopBtn.style.display, "none");
  });

  test("background streaming chunks and messages are fully retained when switching back to the session", async () => {
    // 1. Create session 1
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "session-1",
        agentId: "claude",
        agentName: "Claude",
        title: "Session 1",
      },
    });

    // 2. User sends message in session 1
    await controller.handleMessage({
      type: "userMessage",
      sessionId: "session-1",
      text: "Hello from session 1",
    });

    // 3. Stream starts in session 1
    await controller.handleMessage({
      type: "streamStart",
      sessionId: "session-1",
    });

    await controller.handleMessage({
      type: "streamChunk",
      sessionId: "session-1",
      text: "Chunk 1 before switch. ",
    });

    // 4. Create and switch to session 2
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "session-2",
        agentId: "claude",
        agentName: "Claude",
        title: "Session 2",
      },
    });

    assert.strictEqual((controller as any).activeSessionId, "session-2");

    // 5. Background chunks arrive for session-1 while session-2 is active
    await controller.handleMessage({
      type: "thoughtChunk",
      sessionId: "session-1",
      text: "Thinking about background answer...",
    });

    await controller.handleMessage({
      type: "streamChunk",
      sessionId: "session-1",
      text: "Chunk 2 arrived in background! ",
    });

    await controller.handleMessage({
      type: "streamChunk",
      sessionId: "session-1",
      text: "Chunk 3 completed in background.",
    });

    await controller.handleMessage({
      type: "streamEnd",
      sessionId: "session-1",
    });

    // 6. User sends a message in session 2
    await controller.handleMessage({
      type: "userMessage",
      sessionId: "session-2",
      text: "Message in session 2",
    });

    // 7. Switch back to session 1
    controller.switchActiveSession("session-1");
    assert.strictEqual((controller as any).activeSessionId, "session-1");

    // Verify all content from session-1 is rendered and intact
    const messagesEl = document.getElementById("messages") as HTMLElement;
    const session1Container = messagesEl.querySelector(
      '.session-messages-content[data-session-id="session-1"]'
    ) as HTMLElement;

    assert.ok(session1Container, "Session 1 container must exist in DOM");
    assert.strictEqual(session1Container.style.display, "flex");

    const textContent = session1Container.textContent || "";
    assert.ok(
      textContent.includes("Hello from session 1"),
      "Should contain user message"
    );
    assert.ok(
      textContent.includes("Chunk 1 before switch"),
      "Should contain Chunk 1"
    );
    assert.ok(
      textContent.includes("Chunk 2 arrived in background"),
      "Should contain Chunk 2"
    );
    assert.ok(
      textContent.includes("Chunk 3 completed in background"),
      "Should contain Chunk 3"
    );
    assert.ok(
      textContent.includes("Thinking about background answer"),
      "Should contain thought chunk"
    );

    // Switch back to session 2 and check session 2 content
    controller.switchActiveSession("session-2");
    const session2Container = messagesEl.querySelector(
      '.session-messages-content[data-session-id="session-2"]'
    ) as HTMLElement;
    assert.ok(session2Container, "Session 2 container must exist");
    assert.strictEqual(session2Container.style.display, "flex");
    assert.strictEqual(session1Container.style.display, "none");
    assert.ok(session2Container.textContent?.includes("Message in session 2"));
  });

  test("preserves and restores input draft text across session switching", async () => {
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "session-a",
        agentId: "claude",
        agentName: "Claude",
        title: "Session A",
      },
    });

    const inputEl = document.getElementById("input") as HTMLElement;
    inputEl.textContent = "Draft message in Session A";

    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "session-b",
        agentId: "gemini",
        agentName: "Gemini",
        title: "Session B",
      },
    });

    // Session B should have clean or independent input
    assert.strictEqual(inputEl.textContent, "");
    inputEl.textContent = "Draft message in Session B";

    // Switch back to Session A
    controller.switchActiveSession("session-a");
    assert.strictEqual(inputEl.textContent, "Draft message in Session A");

    // Switch back to Session B
    controller.switchActiveSession("session-b");
    assert.strictEqual(inputEl.textContent, "Draft message in Session B");
  });

  test("preserves and restores plan and diff summary state across session switching", async () => {
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "session-p1",
        agentId: "claude",
        agentName: "Claude",
        title: "Plan 1",
      },
    });

    await controller.handleMessage({
      type: "plan",
      sessionId: "session-p1",
      plan: {
        entries: [
          {
            content: "Step 1 in Session 1",
            status: "in_progress",
            priority: "medium",
          },
        ],
      },
    });

    const planContainer = document.getElementById(
      "agent-plan-container"
    ) as HTMLElement;
    assert.ok(planContainer.textContent?.includes("Step 1 in Session 1"));

    // Create session 2 without plan
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "session-p2",
        agentId: "claude",
        agentName: "Claude",
        title: "Plan 2",
      },
    });

    // Plan should be hidden/cleared in Session 2
    assert.strictEqual(planContainer.children.length, 0);

    // Switch back to Session 1
    controller.switchActiveSession("session-p1");
    assert.ok(planContainer.querySelector(".agent-plan-sticky"));
    assert.ok(planContainer.textContent?.includes("Step 1 in Session 1"));
  });

  test("preserves and restores context usage and session metadata across session switching", async () => {
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "session-m1",
        agentId: "claude",
        agentName: "Claude",
        title: "Meta 1",
      },
    });

    await controller.handleMessage({
      type: "contextUsage",
      sessionId: "session-m1",
      used: 5000,
      size: 100000,
      cost: { amount: 0.05, currency: "USD" },
    });

    const ring = document.getElementById("context-usage-ring") as HTMLElement;
    assert.strictEqual(ring.hidden, false);

    // Create session 2 with empty context usage
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "session-m2",
        agentId: "claude",
        agentName: "Claude",
        title: "Meta 2",
      },
    });

    assert.strictEqual(ring.hidden, true);

    // Switch back to session 1
    controller.switchActiveSession("session-m1");
    assert.strictEqual(ring.hidden, false);
  });

  test("background plan and diff updates arriving while another session is active are preserved in store and restored on switch", async () => {
    // 1. Create Session A and Session B
    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "session-a",
        agentId: "claude",
        agentName: "Claude",
        title: "Session A",
      },
    });

    await controller.handleMessage({
      type: "sessionCreated",
      session: {
        sessionId: "session-b",
        agentId: "opencode",
        agentName: "OpenCode",
        title: "Session B",
      },
    });

    assert.strictEqual((controller as any).activeSessionId, "session-b");

    // 2. Session A receives plan and diff updates in background while Session B is active
    await controller.handleMessage({
      type: "plan",
      sessionId: "session-a",
      plan: {
        entries: [
          {
            content: "Background plan step 1",
            status: "completed",
            priority: "high",
          },
        ],
      },
    });

    await controller.handleMessage({
      type: "diffSummary",
      sessionId: "session-a",
      changes: [
        {
          path: "/workspace/file.ts",
          relativePath: "file.ts",
          oldText: "const x = 1;",
          newText: "const x = 2;",
          status: "modified",
        },
      ],
    });

    const planContainer = document.getElementById(
      "agent-plan-container"
    ) as HTMLElement;
    const diffContainer = document.getElementById(
      "diff-summary-container"
    ) as HTMLElement;

    // Active session B should NOT show session A's background plan or diff
    assert.strictEqual(planContainer.children.length, 0);
    assert.strictEqual(diffContainer.children.length, 0);

    // 3. Switch to Session A — plan and diff must be rendered immediately from store
    controller.switchActiveSession("session-a");
    assert.ok(planContainer.textContent?.includes("Background plan step 1"));
    assert.ok(diffContainer.textContent?.includes("files modified"));

    // 4. Switch back to Session B — plan and diff must be hidden
    controller.switchActiveSession("session-b");
    assert.strictEqual(planContainer.children.length, 0);
    assert.strictEqual(diffContainer.children.length, 0);
  });
});
