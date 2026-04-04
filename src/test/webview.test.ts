import * as assert from "assert";
import { JSDOM, DOMWindow } from "jsdom";
import {
  escapeHtml,
  getToolsHtml,
  getElements,
  WebviewController,
  initWebview,
  ansiToHtml,
  hasAnsiCodes,
  getToolKindIcon,
  computeLineDiff,
  renderDiff,
  type VsCodeApi,
  type Tool,
  type WebviewElements,
} from "../views/webview/main";

function createMockVsCodeApi(): VsCodeApi & {
  _getMessages: () => unknown[];
  _clearMessages: () => void;
} {
  let state: Record<string, unknown> = {};
  const messages: unknown[] = [];

  return {
    postMessage: (message: unknown) => {
      messages.push(message);
    },
    getState: <T>() => state as T,
    setState: <T>(newState: T) => {
      state = newState as Record<string, unknown>;
      return newState;
    },
    _getMessages: () => messages,
    _clearMessages: () => {
      messages.length = 0;
    },
  };
}

function createWebviewHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
</head>
<body>
  <div id="welcome-view" class="welcome-view">
    <img src="logo.svg" class="welcome-logo">
    <h3>Welcome to VSCode ACP</h3>
  </div>

  <div id="agent-plan-container"></div>

  <div id="messages"></div>

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
}

suite("Webview", () => {
  function setupController() {
    const dom = new JSDOM(createWebviewHTML(), {
      runScripts: "dangerously",
      url: "https://localhost",
    });
    const doc = dom.window.document;
    const window = dom.window;
    const mockVsCode = createMockVsCodeApi();
    const elements = getElements(doc);
    (global as any).Node = window.Node;
    const controller = new WebviewController(
      mockVsCode,
      elements,
      doc,
      window as unknown as Window
    );
    return { controller, elements, doc, window, mockVsCode };
  }

  suite("escapeHtml", () => {
    test("escapes ampersands", () => {
      assert.strictEqual(escapeHtml("foo & bar"), "foo &amp; bar");
    });

    test("escapes less than", () => {
      assert.strictEqual(escapeHtml("a < b"), "a &lt; b");
    });

    test("escapes greater than", () => {
      assert.strictEqual(escapeHtml("a > b"), "a &gt; b");
    });

    test("escapes all special characters together", () => {
      assert.strictEqual(
        escapeHtml("<script>alert('xss')</script>"),
        "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;"
      );
    });

    test("escapes double quotes", () => {
      assert.strictEqual(
        escapeHtml('a "quoted" string'),
        "a &quot;quoted&quot; string"
      );
    });

    test("escapes single quotes", () => {
      assert.strictEqual(escapeHtml("it's"), "it&#39;s");
    });

    test("returns empty string for empty input", () => {
      assert.strictEqual(escapeHtml(""), "");
    });

    test("preserves normal text", () => {
      assert.strictEqual(escapeHtml("Hello World"), "Hello World");
    });
  });

  suite("getToolsHtml", () => {
    test("returns empty string for no tools", () => {
      assert.strictEqual(getToolsHtml({}), "");
    });

    test("renders running tool with spinner icon", () => {
      const tools: Record<string, Tool> = {
        "tool-1": {
          id: "tool-1",
          name: "bash",
          input: null,
          output: null,
          status: "running",
        },
      };
      const html = getToolsHtml(tools);
      assert.ok(
        html.includes('<span class="icon icon-sparkle animate-spin"></span>')
      );
      assert.ok(html.includes("bash"));
      assert.ok(html.includes("running"));
    });

    test("renders completed tool with checkmark", () => {
      const tools: Record<string, Tool> = {
        "tool-1": {
          id: "tool-1",
          name: "read_file",
          input: "path/to/file",
          output: "file contents",
          status: "completed",
        },
      };
      const html = getToolsHtml(tools);
      assert.ok(html.includes('<span class="icon icon-checkmark"></span>'));
      assert.ok(html.includes("read_file"));
    });

    test("renders failed tool with X", () => {
      const tools: Record<string, Tool> = {
        "tool-1": {
          id: "tool-1",
          name: "write_file",
          input: null,
          output: "Permission denied",
          status: "failed",
        },
      };
      const html = getToolsHtml(tools);
      assert.ok(html.includes('<span class="icon icon-dismiss"></span>'));
    });

    test("escapes tool name to prevent XSS", () => {
      const tools: Record<string, Tool> = {
        "tool-1": {
          id: "tool-1",
          name: "<script>alert(1)</script>",
          input: null,
          output: null,
          status: "running",
        },
      };
      const html = getToolsHtml(tools);
      assert.ok(html.includes("&lt;script&gt;"));
      assert.ok(!html.includes("<script>alert"));
    });

    test("truncates long output", () => {
      const longOutput = "x".repeat(600);
      const tools: Record<string, Tool> = {
        "tool-1": {
          id: "tool-1",
          name: "test",
          input: null,
          output: longOutput,
          status: "completed",
        },
      };
      const html = getToolsHtml(tools);
      assert.ok(html.includes("..."));
      assert.ok(!html.includes("x".repeat(600)));
    });

    test("shows tool count in summary", () => {
      const tools: Record<string, Tool> = {
        "tool-1": {
          id: "tool-1",
          name: "a",
          input: null,
          output: null,
          status: "completed",
        },
        "tool-2": {
          id: "tool-2",
          name: "b",
          input: null,
          output: null,
          status: "completed",
        },
        "tool-3": {
          id: "tool-3",
          name: "c",
          input: null,
          output: null,
          status: "completed",
        },
      };
      const html = getToolsHtml(tools);
      assert.ok(html.includes("3 tools"));
    });

    test("shows singular tool for single tool", () => {
      const tools: Record<string, Tool> = {
        "tool-1": {
          id: "tool-1",
          name: "a",
          input: null,
          output: null,
          status: "completed",
        },
      };
      const html = getToolsHtml(tools);
      assert.ok(html.includes(">1 tool<"));
    });
  });

  suite("getElements", () => {
    let dom: JSDOM;
    let document: Document;

    setup(() => {
      dom = new JSDOM(createWebviewHTML());
      document = dom.window.document;
    });

    teardown(() => {
      dom.window.close();
    });

    test("returns all required elements", () => {
      const elements = getElements(document);
      assert.ok(elements.messagesEl);
      assert.ok(elements.inputEl);
      assert.ok(elements.sendBtn);
      assert.ok(elements.stopBtn);
      assert.ok(elements.modeDropdown);
      assert.ok(elements.modelDropdown);
      assert.ok(elements.welcomeView);
      assert.ok(elements.commandAutocomplete);
      assert.ok(elements.typingIndicatorEl);
    });

    test("returns correct element types", () => {
      const elements = getElements(document);
      assert.strictEqual(elements.inputEl.tagName, "DIV");
      assert.strictEqual(elements.sendBtn.tagName, "BUTTON");
    });
  });

  suite("WebviewController", () => {
    let dom: JSDOM;
    let document: Document;
    let window: DOMWindow;
    let mockVsCode: ReturnType<typeof createMockVsCodeApi>;
    let elements: WebviewElements;
    let controller: WebviewController;

    setup(() => {
      dom = new JSDOM(createWebviewHTML(), {
        runScripts: "dangerously",
        url: "https://localhost",
      });
      document = dom.window.document;
      window = dom.window;
      mockVsCode = createMockVsCodeApi();
      elements = getElements(document);
      (global as any).Node = window.Node;
      controller = new WebviewController(
        mockVsCode,
        elements,
        document,
        window as unknown as Window
      );
    });

    teardown(() => {
      dom.window.close();
    });

    test("sends ready message on initialization", () => {
      const messages = mockVsCode._getMessages();
      assert.ok(
        messages.some((m: unknown) => (m as { type: string }).type === "ready")
      );
    });

    suite("addMessage", () => {
      test("adds user message to DOM", () => {
        controller.addMessage("Hello!", "user");
        const msgs = elements.messagesEl.querySelectorAll(".message.user");
        assert.strictEqual(msgs.length, 1);
        assert.strictEqual(msgs[0].textContent, "Hello!");
      });

      test("adds assistant message to DOM", () => {
        controller.addMessage("Hi there!", "assistant");
        const msgs = elements.messagesEl.querySelectorAll(".message.assistant");
        assert.strictEqual(msgs.length, 1);
        assert.strictEqual(msgs[0].textContent, "Hi there!");
      });

      test("adds error message to DOM", () => {
        controller.addMessage("Error occurred", "error");
        const msgs = elements.messagesEl.querySelectorAll(".message.error");
        assert.strictEqual(msgs.length, 1);
      });

      test("sets accessibility attributes", () => {
        const msg = controller.addMessage("Test", "user");
        assert.strictEqual(msg.getAttribute("role"), "article");
        assert.strictEqual(msg.getAttribute("tabindex"), "0");
        assert.strictEqual(msg.getAttribute("aria-label"), "Your message");
      });

      test("returns the created element", () => {
        const msg = controller.addMessage("Test", "user");
        assert.ok(msg instanceof dom.window.HTMLElement);
        assert.strictEqual(msg.textContent, "Test");
      });
    });

    suite("updateStatus", () => {
      test("saves state after update", () => {
        controller.updateStatus("connected");
        const state = mockVsCode.getState<{ isConnected: boolean }>();
        assert.strictEqual(state?.isConnected, true);
      });
    });

    suite("showThinking/hideThinking", () => {
      test("showThinking adds thinking element", () => {
        controller.showThinking();
        const thinking = elements.messagesEl.querySelector(".agent-thought");
        assert.ok(thinking);
        assert.strictEqual(thinking?.getAttribute("open"), "");
      });

      test("hideThinking closes thinking element", () => {
        controller.showThinking();
        controller.hideThinking();
        const thinking = elements.messagesEl.querySelector(".agent-thought");
        assert.strictEqual(thinking?.getAttribute("open"), null);
      });
    });

    suite("handleMessage", () => {
      test("handles userMessage", () => {
        controller.handleMessage({ type: "userMessage", text: "Hello" });
        const msgs = elements.messagesEl.querySelectorAll(".message.user");
        assert.strictEqual(msgs.length, 1);
      });

      test("handles userMessage with mentions", () => {
        controller.handleMessage({
          type: "userMessage",
          text: "Check this file __MENTION_0__",
          mentions: [
            {
              name: "test.ts",
              path: "/path/to/test.ts",
              type: "file",
              content: "console.log('test')",
            },
          ],
        });
        const msgs = elements.messagesEl.querySelectorAll(".message.user");
        assert.strictEqual(msgs.length, 1);
        // Check that mention chip is rendered
        const mentionChip = msgs[0].querySelector(".mention-chip");
        assert.ok(mentionChip !== null, "Mention chip should be rendered");
        assert.strictEqual(mentionChip.textContent, "test.ts");
      });

      test("handles userMessage with image mentions", () => {
        controller.handleMessage({
          type: "userMessage",
          text: "Look at this image __MENTION_0__",
          mentions: [
            {
              name: "screenshot.png",
              type: "image",
              dataUrl: "data:image/png;base64,abc123",
            },
          ],
        });
        const msgs = elements.messagesEl.querySelectorAll(".message.user");
        assert.strictEqual(msgs.length, 1);
        // Check that image mention chip is rendered (readonly mode shows icon, not img directly)
        const mentionChip = msgs[0].querySelector(
          ".mention-chip"
        ) as HTMLElement;
        assert.ok(
          mentionChip !== null,
          "Image mention chip should be rendered"
        );
        assert.strictEqual(
          mentionChip.dataset?.type,
          "image",
          "Chip type should be image"
        );
        assert.strictEqual(
          mentionChip.dataset?.name,
          "screenshot.png",
          "Chip name should match"
        );
        assert.ok(
          mentionChip.querySelector(".icon-image"),
          "Image icon should exist"
        );
      });

      test("handles connectionState", () => {
        controller.handleMessage({
          type: "connectionState",
          state: "connected",
        });
        assert.strictEqual(controller.getIsConnected(), true);
      });

      test("handles error", () => {
        controller.handleMessage({
          type: "error",
          text: "Something went wrong",
        });
        const msgs = elements.messagesEl.querySelectorAll(".message.error");
        assert.strictEqual(msgs.length, 1);
      });

      test("handles sessionMetadata with modes", () => {
        controller.handleMessage({
          type: "sessionMetadata",
          modes: {
            availableModes: [
              { id: "code", name: "Code" },
              { id: "architect", name: "Architect" },
            ],
            currentModeId: "code",
          },
          models: null,
        });
        assert.strictEqual(elements.modeDropdown.style.display, "flex");
        const label = elements.modeDropdown.querySelector(".selected-label");
        assert.strictEqual(label?.textContent, "Code");
      });

      test("handles chatCleared", () => {
        // Set up some state that should persist
        controller.handleMessage({
          type: "sessionMetadata",
          modes: {
            availableModes: [{ id: "code", name: "Code" }],
            currentModeId: "code",
          },
          models: null,
        });
        controller.handleMessage({
          type: "availableCommands",
          commands: [{ name: "help", description: "Show help" }],
        });

        controller.addMessage("Test", "user");
        controller.handleMessage({ type: "chatCleared" });

        // Messages should be cleared
        assert.strictEqual(elements.messagesEl.children.length, 0);
        // Mode dropdown should still be visible
        assert.strictEqual(elements.modeDropdown.style.display, "flex");
        // Commands should still be available
        const result = controller.getFilteredCommands("/");
        assert.strictEqual(result.length, 1);
      });

      test("handles toolCallStart", () => {
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "tool-1",
          name: "bash",
        });
        const tools = controller.getTools();
        assert.ok(tools["tool-1"]);
        assert.strictEqual(tools["tool-1"].status, "running");
      });

      test("handles toolCallComplete", () => {
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "tool-1",
          name: "bash",
        });
        controller.handleMessage({
          type: "toolCallComplete",
          toolCallId: "tool-1",
          status: "completed",
          rawInput: { command: "ls -la" },
          rawOutput: { output: "file1\nfile2" },
        });
        const tools = controller.getTools();
        assert.strictEqual(tools["tool-1"].status, "completed");
        assert.strictEqual(tools["tool-1"].input, "ls -la");
      });

      test("handles toolCallComplete and uses cached title if missing in message", () => {
        // Start tool call with a name and kind
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "tool-cache-test",
          name: "Original Descriptive Name",
          kind: "execute",
        });

        // Complete tool call WITHOUT title (common in incremental updates)
        controller.handleMessage({
          type: "toolCallComplete",
          toolCallId: "tool-cache-test",
          status: "completed",
          rawInput: { command: "ls -la" },
        });

        const tools = controller.getTools();
        // Should use cached title because it's descriptive
        assert.strictEqual(
          tools["tool-cache-test"].name,
          "Run: Original Descriptive Name"
        );
      });

      test("handles streaming", () => {
        controller.handleMessage({ type: "streamStart" });
        controller.handleMessage({ type: "streamChunk", text: "Hello " });
        controller.handleMessage({ type: "streamChunk", text: "World" });

        const msgs = elements.messagesEl.querySelectorAll(".message.assistant");
        assert.strictEqual(msgs.length, 1);
        assert.strictEqual(msgs[0].textContent.trim(), "Hello World");
      });

      test("handles streamEnd with HTML", () => {
        controller.handleMessage({ type: "streamStart" });
        controller.handleMessage({ type: "streamChunk", text: "**bold**" });
        controller.handleMessage({
          type: "streamEnd",
        });

        const msgs = elements.messagesEl.querySelectorAll(".message.assistant");
        assert.ok(msgs[0].innerHTML.includes("<strong>"));
      });
    });

    suite("input handling", () => {
      test("Enter key sends message", () => {
        mockVsCode._clearMessages();
        elements.inputEl.innerHTML = "Test message";
        const event = new window.KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: false,
        });
        elements.inputEl.dispatchEvent(event);

        const messages = mockVsCode._getMessages();
        assert.ok(
          messages.some(
            (m: unknown) =>
              (m as { type: string; text?: string }).type === "sendMessage" &&
              (m as { type: string; text?: string }).text === "Test message"
          )
        );
      });

      test("Shift+Enter does not send message", () => {
        mockVsCode._clearMessages();
        elements.inputEl.innerHTML = "Test message";
        const event = new window.KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
        });
        elements.inputEl.dispatchEvent(event);

        const messages = mockVsCode._getMessages();
        assert.ok(
          !messages.some(
            (m: unknown) => (m as { type: string }).type === "sendMessage"
          )
        );
      });

      test("empty input does not send message", () => {
        mockVsCode._clearMessages();
        elements.inputEl.innerHTML = "   ";
        const event = new window.KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: false,
        });
        elements.inputEl.dispatchEvent(event);

        const messages = mockVsCode._getMessages();
        assert.ok(
          !messages.some(
            (m: unknown) => (m as { type: string }).type === "sendMessage"
          )
        );
      });

      test("Escape clears input", () => {
        elements.inputEl.innerHTML = "Test message";
        const event = new window.KeyboardEvent("keydown", { key: "Escape" });
        elements.inputEl.dispatchEvent(event);
        assert.strictEqual(elements.inputEl.textContent, "");
      });
    });

    suite("slash command autocomplete", () => {
      const testCommands = [
        { name: "help", description: "Show help" },
        { name: "history", description: "Show history" },
        { name: "clear", description: "Clear chat" },
      ];

      test("getFilteredCommands returns empty for non-slash input", () => {
        const result = controller.getFilteredCommands("hello");
        assert.deepStrictEqual(result, []);
      });

      test("getFilteredCommands returns empty for plain slash", () => {
        controller.handleMessage({
          type: "availableCommands",
          commands: testCommands,
        });
        const result = controller.getFilteredCommands("/");
        assert.strictEqual(result.length, 3);
      });

      test("getFilteredCommands filters by prefix", () => {
        controller.handleMessage({
          type: "availableCommands",
          commands: testCommands,
        });
        const result = controller.getFilteredCommands("/he");
        assert.strictEqual(result.length, 1);
        assert.ok(result.some((c) => c.name === "help"));
      });

      test("getFilteredCommands filters by description", () => {
        controller.handleMessage({
          type: "availableCommands",
          commands: testCommands,
        });
        const result = controller.getFilteredCommands("/chat");
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].name, "clear");
      });

      test("hideAutocomplete clears and hides", () => {
        controller.handleMessage({
          type: "availableCommands",
          commands: testCommands,
        });
        elements.inputEl.textContent = "/";
        // Simulate input and manual render if needed, but here we just test hide
        elements.commandAutocomplete.innerHTML =
          '<div class="command-item"></div>';
        elements.commandAutocomplete.classList.add("visible");

        controller.hideAutocomplete();
        assert.ok(!elements.commandAutocomplete.classList.contains("visible"));
        assert.strictEqual(elements.commandAutocomplete.innerHTML, "");
      });

      test("selectAutocomplete fills input with command", () => {
        controller.handleMessage({
          type: "availableCommands",
          commands: testCommands,
        });

        elements.inputEl.textContent = "/he";

        // Mock range and selection
        const range = {
          setStart: () => {},
          deleteContents: () => {
            elements.inputEl.textContent = "";
          },
          insertNode: (node: Node) => {
            elements.inputEl.textContent += node.textContent;
          },
          startContainer: {
            textContent: "/he",
          },
          startOffset: 3,
          collapse: () => {},
        };

        window.getSelection = () =>
          ({
            rangeCount: 1,
            getRangeAt: () => range,
            collapseToEnd: () => {},
            collapse: () => {},
          }) as any;

        // Trigger updateAutocomplete to set mode and trigger pos
        elements.inputEl.dispatchEvent(new window.Event("input"));

        // Manual render for test purposes if needed, but selectAutocomplete doesn't check visibility
        // but it does check autocompleteMode
        const item = document.createElement("div");
        item.className = "command-item";
        item.setAttribute("data-index", "0");
        elements.commandAutocomplete.appendChild(item);

        item.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        assert.ok(elements.inputEl.textContent.includes("/help "));
      });

      test("availableCommands message updates commands", () => {
        controller.handleMessage({
          type: "availableCommands",
          commands: testCommands,
        });
        const result = controller.getFilteredCommands("/");
        assert.strictEqual(result.length, 3);
      });

      test("sessionMetadata with commands updates commands", () => {
        controller.handleMessage({
          type: "sessionMetadata",
          commands: testCommands,
          modes: null,
          models: null,
        });
        const result = controller.getFilteredCommands("/");
        assert.strictEqual(result.length, 3);
      });

      test("chatCleared does not clear commands", () => {
        controller.handleMessage({
          type: "availableCommands",
          commands: testCommands,
        });
        controller.handleMessage({ type: "chatCleared" });
        const result = controller.getFilteredCommands("/");
        assert.strictEqual(result.length, 3);
      });

      test("Tab key selects command when autocomplete visible", () => {
        controller.handleMessage({
          type: "availableCommands",
          commands: testCommands,
        });
        elements.inputEl.textContent = "/he";
        elements.commandAutocomplete.classList.add("visible");

        const tabEvent = new window.KeyboardEvent("keydown", { key: "Tab" });
        elements.inputEl.dispatchEvent(tabEvent);

        assert.ok(elements.inputEl.textContent.startsWith("/he"));
      });

      test("ArrowDown navigates commands", () => {
        controller.handleMessage({
          type: "availableCommands",
          commands: testCommands,
        });

        // Mock range and selection for input event
        const range = {
          startContainer: {
            textContent: "/h",
          },
          startOffset: 2,
        };
        window.getSelection = () =>
          ({
            rangeCount: 1,
            getRangeAt: () => range,
          }) as any;

        elements.inputEl.textContent = "/h";
        elements.inputEl.dispatchEvent(new window.Event("input"));

        const downEvent = new window.KeyboardEvent("keydown", {
          key: "ArrowDown",
        });
        elements.inputEl.dispatchEvent(downEvent);

        assert.ok(
          elements.commandAutocomplete.querySelector(".command-item.selected")
        );
      });
    });

    suite("agent plan display", () => {
      const testPlan = {
        entries: [
          {
            content: "Read files",
            priority: "high" as const,
            status: "completed" as const,
          },
          {
            content: "Analyze code",
            priority: "medium" as const,
            status: "in_progress" as const,
          },
          {
            content: "Generate report",
            priority: "low" as const,
            status: "pending" as const,
          },
        ],
      };

      test("showPlan creates plan element", () => {
        controller.showPlan(testPlan.entries);
        const planEl =
          elements.planContainer.querySelector(".agent-plan-sticky");
        assert.ok(planEl);
      });

      test("showPlan displays all entries", () => {
        controller.showPlan(testPlan.entries);
        const entries = elements.planContainer.querySelectorAll(".plan-entry");
        assert.strictEqual(entries.length, 3);
      });

      test("showPlan shows progress count", () => {
        controller.showPlan(testPlan.entries);
        const progress = elements.planContainer.querySelector(".plan-progress");
        assert.ok(progress);
        assert.strictEqual(progress?.textContent, "1/3");
      });

      test("showPlan applies status classes", () => {
        controller.showPlan(testPlan.entries);
        const completed = elements.planContainer.querySelector(
          ".plan-entry-completed"
        );
        const inProgress = elements.planContainer.querySelector(
          ".plan-entry-in_progress"
        );
        const pending = elements.planContainer.querySelector(
          ".plan-entry-pending"
        );
        assert.ok(completed);
        assert.ok(inProgress);
        assert.ok(pending);
      });

      test("showPlan applies priority classes", () => {
        controller.showPlan(testPlan.entries);
        const high = elements.planContainer.querySelector(
          ".plan-priority-high"
        );
        const medium = elements.planContainer.querySelector(
          ".plan-priority-medium"
        );
        const low = elements.planContainer.querySelector(".plan-priority-low");
        assert.ok(high);
        assert.ok(medium);
        assert.ok(low);
      });

      test("showPlan is collapsed by default", () => {
        controller.showPlan(testPlan.entries);
        const planEntries =
          elements.planContainer.querySelector(".plan-entries");
        assert.ok(planEntries?.classList.contains("collapsed"));
      });

      test("showPlan header is clickable", () => {
        controller.showPlan(testPlan.entries);
        const header = elements.planContainer.querySelector(".plan-header");
        assert.ok(header);
        // Verify it has the collapsed state initially
        const toggleIcon = header?.querySelector(".plan-toggle-icon");
        assert.ok(toggleIcon?.classList.contains("collapsed"));
      });

      test("plan header click toggles expand/collapse", () => {
        controller.showPlan(testPlan.entries);
        let header = elements.planContainer.querySelector(
          ".plan-header"
        ) as HTMLElement;
        let planEntries = elements.planContainer.querySelector(".plan-entries");

        // Initially collapsed
        assert.ok(planEntries?.classList.contains("collapsed"));

        // Click to expand
        if (header) {
          header.click();
        }

        // Re-query after click since DOM is re-rendered
        planEntries = elements.planContainer.querySelector(".plan-entries");

        // Should now be expanded
        assert.ok(!planEntries?.classList.contains("collapsed"));
      });

      test("hidePlan removes plan element", () => {
        controller.showPlan(testPlan.entries);
        controller.hidePlan();
        const planEl =
          elements.planContainer.querySelector(".agent-plan-sticky");
        assert.strictEqual(planEl, null);
      });

      test("plan message updates display", () => {
        controller.handleMessage({
          type: "plan",
          plan: testPlan,
        });
        const planEl =
          elements.planContainer.querySelector(".agent-plan-sticky");
        assert.ok(planEl);
      });

      test("planComplete message removes display", () => {
        controller.handleMessage({ type: "plan", plan: testPlan });
        controller.handleMessage({ type: "planComplete" });
        const planEl =
          elements.planContainer.querySelector(".agent-plan-sticky");
        assert.strictEqual(planEl, null);
      });

      test("chatCleared removes plan", () => {
        controller.handleMessage({ type: "plan", plan: testPlan });
        controller.handleMessage({ type: "chatCleared" });
        const planEl =
          elements.planContainer.querySelector(".agent-plan-sticky");
        assert.strictEqual(planEl, null);
      });

      test("showPlan with empty entries hides plan", () => {
        controller.showPlan(testPlan.entries);
        controller.showPlan([]);
        const planEl =
          elements.planContainer.querySelector(".agent-plan-sticky");
        assert.strictEqual(planEl, null);
      });
    });

    suite("agent thought display", () => {
      test("thoughtChunk message creates thought element", () => {
        controller.handleMessage({
          type: "thoughtChunk",
          text: "Let me think...",
        });
        const thoughtEl = elements.messagesEl.querySelector(".agent-thought");
        assert.ok(thoughtEl);
      });

      test("thoughtChunk accumulates text", () => {
        controller.handleMessage({
          type: "thoughtChunk",
          text: "First part. ",
        });
        controller.handleMessage({
          type: "thoughtChunk",
          text: "Second part.",
        });
        const contentEl = elements.messagesEl.querySelector(".thought-content");
        assert.ok(contentEl);
        assert.ok(contentEl?.textContent?.includes("First part."));
        assert.ok(contentEl?.textContent?.includes("Second part."));
      });

      test("appendThought creates details element", () => {
        controller.appendThought("Thinking about this...");
        const thoughtEl = elements.messagesEl.querySelector(
          "details.agent-thought"
        );
        assert.ok(thoughtEl);
        assert.strictEqual(thoughtEl?.getAttribute("open"), "");
      });

      test("appendThought includes ARIA accessibility attributes", () => {
        controller.appendThought("Thinking...");
        const thoughtEl = elements.messagesEl.querySelector(
          "details.agent-thought"
        );
        assert.ok(thoughtEl);
        assert.strictEqual(thoughtEl?.getAttribute("role"), "status");
        assert.strictEqual(thoughtEl?.getAttribute("aria-live"), "polite");
        assert.strictEqual(
          thoughtEl?.getAttribute("aria-label"),
          "Assistant is thinking"
        );
      });

      test("hideThought closes thought element", () => {
        controller.appendThought("Some thought");
        controller.hideThought();
        const thoughtEl = elements.messagesEl.querySelector(".agent-thought");
        assert.ok(thoughtEl);
        assert.strictEqual(thoughtEl?.getAttribute("open"), null);
      });

      test("streamStart starts new assistant message", () => {
        controller.appendThought("Old thought");
        controller.handleMessage({ type: "streamStart" });
        // Old thought stays in previous message
        const thoughtEl = elements.messagesEl.querySelector(".agent-thought");
        assert.ok(thoughtEl);
      });

      test("streamEnd finalizes thought", () => {
        controller.appendThought("Thinking...");
        controller.handleMessage({ type: "streamEnd" });
        const thoughtEl = elements.messagesEl.querySelector(".agent-thought");
        assert.ok(thoughtEl);
        assert.strictEqual(thoughtEl?.getAttribute("open"), null);
      });

      test("chatCleared removes thought", () => {
        controller.appendThought("Some thought");
        controller.handleMessage({ type: "chatCleared" });
        const thoughtEl = elements.messagesEl.querySelector(".agent-thought");
        assert.strictEqual(thoughtEl, null);
      });
    });

    suite("state persistence", () => {
      test("restores input value from state", () => {
        mockVsCode.setState({ isConnected: false, inputValue: "saved text" });
        new WebviewController(
          mockVsCode,
          elements,
          document,
          window as unknown as Window
        );
        assert.strictEqual(elements.inputEl.textContent, "saved text");
      });

      test("restores connection state from state", () => {
        mockVsCode.setState({ isConnected: true, inputValue: "" });
        const restoredController = new WebviewController(
          mockVsCode,
          elements,
          document,
          window as unknown as Window
        );
        assert.strictEqual(restoredController.getIsConnected(), true);
      });
    });
  });

  suite("initWebview", () => {
    let dom: JSDOM;

    setup(() => {
      dom = new JSDOM(createWebviewHTML(), {
        runScripts: "dangerously",
        url: "https://localhost",
      });
    });

    teardown(() => {
      dom.window.close();
    });

    test("creates and returns WebviewController", () => {
      const mockVsCode = createMockVsCodeApi();
      const controller = initWebview(
        mockVsCode,
        dom.window.document,
        dom.window as unknown as Window
      );
      assert.ok(controller instanceof WebviewController);
    });
  });

  suite("hasAnsiCodes", () => {
    test("returns true for text with ANSI escape codes", () => {
      assert.strictEqual(hasAnsiCodes("\x1b[31mred\x1b[0m"), true);
    });

    test("returns true for text with bold ANSI code", () => {
      assert.strictEqual(hasAnsiCodes("\x1b[1mbold\x1b[0m"), true);
    });

    test("returns false for plain text", () => {
      assert.strictEqual(hasAnsiCodes("plain text"), false);
    });

    test("returns false for empty string", () => {
      assert.strictEqual(hasAnsiCodes(""), false);
    });

    test("returns true for multiple ANSI codes", () => {
      assert.strictEqual(
        hasAnsiCodes("\x1b[1;31;42mbold red on green\x1b[0m"),
        true
      );
    });
  });

  suite("ansiToHtml", () => {
    test("returns plain text unchanged", () => {
      assert.strictEqual(ansiToHtml("hello world"), "hello world");
    });

    test("escapes HTML in plain text", () => {
      assert.strictEqual(ansiToHtml("<script>"), "&lt;script&gt;");
    });

    test("converts red foreground color", () => {
      const result = ansiToHtml("\x1b[31mred text\x1b[0m");
      assert.ok(result.includes('class="ansi-red"'));
      assert.ok(result.includes("red text"));
    });

    test("converts green foreground color", () => {
      const result = ansiToHtml("\x1b[32mgreen\x1b[0m");
      assert.ok(result.includes('class="ansi-green"'));
    });

    test("converts bold style", () => {
      const result = ansiToHtml("\x1b[1mbold\x1b[0m");
      assert.ok(result.includes('class="ansi-bold"'));
      assert.ok(result.includes("bold"));
    });

    test("converts dim style", () => {
      const result = ansiToHtml("\x1b[2mdim\x1b[0m");
      assert.ok(result.includes('class="ansi-dim"'));
    });

    test("converts italic style", () => {
      const result = ansiToHtml("\x1b[3mitalic\x1b[0m");
      assert.ok(result.includes('class="ansi-italic"'));
    });

    test("converts underline style", () => {
      const result = ansiToHtml("\x1b[4munderline\x1b[0m");
      assert.ok(result.includes('class="ansi-underline"'));
    });

    test("converts bright red color", () => {
      const result = ansiToHtml("\x1b[91mbright red\x1b[0m");
      assert.ok(result.includes('class="ansi-bright-red"'));
    });

    test("converts background color", () => {
      const result = ansiToHtml("\x1b[44mblue background\x1b[0m");
      assert.ok(result.includes('class="ansi-bg-blue"'));
    });

    test("handles combined styles", () => {
      const result = ansiToHtml("\x1b[1;31mbold red\x1b[0m");
      assert.ok(result.includes("ansi-bold"));
      assert.ok(result.includes("ansi-red"));
    });

    test("resets styles on code 0", () => {
      const result = ansiToHtml("\x1b[31mred\x1b[0m normal");
      assert.ok(result.includes('class="ansi-red"'));
      assert.ok(result.includes("normal"));
      assert.ok(!result.includes('class="ansi-red">normal'));
    });

    test("handles text before first escape code", () => {
      const result = ansiToHtml("prefix \x1b[32mgreen\x1b[0m");
      assert.ok(result.includes("prefix "));
      assert.ok(result.includes('class="ansi-green"'));
    });

    test("handles text after last escape code", () => {
      const result = ansiToHtml("\x1b[31mred\x1b[0m suffix");
      assert.ok(result.includes("suffix"));
    });

    test("replaces foreground color when new one is set", () => {
      const result = ansiToHtml("\x1b[31mred\x1b[32mgreen\x1b[0m");
      assert.ok(result.includes('class="ansi-red"'));
      assert.ok(result.includes('class="ansi-green"'));
    });

    test("replaces background color when new one is set", () => {
      const result = ansiToHtml("\x1b[41mred bg\x1b[42mgreen bg\x1b[0m");
      assert.ok(result.includes('class="ansi-bg-red"'));
      assert.ok(result.includes('class="ansi-bg-green"'));
    });

    test("handles empty input", () => {
      assert.strictEqual(ansiToHtml(""), "");
    });

    test("handles escape code at end of string", () => {
      const result = ansiToHtml("text\x1b[0m");
      assert.strictEqual(result, "text");
    });

    test("escapes HTML within colored text", () => {
      const result = ansiToHtml("\x1b[31m<b>test</b>\x1b[0m");
      assert.ok(result.includes("&lt;b&gt;test&lt;/b&gt;"));
    });
  });

  suite("getToolsHtml with ANSI", () => {
    test("renders tool output with ANSI colors", () => {
      const tools: Record<string, Tool> = {
        "tool-1": {
          id: "tool-1",
          name: "terminal",
          input: "npm test",
          output: "\x1b[32m✓ All tests passed\x1b[0m",
          status: "completed",
        },
      };
      const html = getToolsHtml(tools);
      assert.ok(html.includes('class="tool-output terminal"'));
      assert.ok(html.includes('class="ansi-green"'));
      assert.ok(html.includes("✓ All tests passed"));
    });

    test("renders plain output without terminal class", () => {
      const tools: Record<string, Tool> = {
        "tool-1": {
          id: "tool-1",
          name: "read_file",
          input: "file.txt",
          output: "plain text output",
          status: "completed",
        },
      };
      const html = getToolsHtml(tools);
      assert.ok(html.includes('class="tool-output"'));
      assert.ok(!html.includes('class="tool-output terminal"'));
      assert.ok(html.includes("plain text output"));
    });

    test("escapes HTML in plain output", () => {
      const tools: Record<string, Tool> = {
        "tool-1": {
          id: "tool-1",
          name: "cat",
          input: null,
          output: "<script>alert('xss')</script>",
          status: "completed",
        },
      };
      const html = getToolsHtml(tools);
      assert.ok(html.includes("&lt;script&gt;"));
      assert.ok(!html.includes("<script>"));
    });

    test("handles ANSI output with HTML characters", () => {
      const tools: Record<string, Tool> = {
        "tool-1": {
          id: "tool-1",
          name: "grep",
          input: null,
          output: "\x1b[31m<error>\x1b[0m",
          status: "failed",
        },
      };
      const html = getToolsHtml(tools);
      assert.ok(html.includes("&lt;error&gt;"));
      assert.ok(html.includes('class="ansi-red"'));
    });
  });

  suite("getToolKindIcon", () => {
    test("returns read icon for read kind", () => {
      assert.strictEqual(getToolKindIcon("read"), "icon-document");
    });

    test("returns edit icon for edit kind", () => {
      assert.strictEqual(getToolKindIcon("edit"), "icon-edit");
    });

    test("returns delete icon for delete kind", () => {
      assert.strictEqual(getToolKindIcon("delete"), "icon-trash");
    });

    test("returns execute icon for execute kind", () => {
      assert.strictEqual(getToolKindIcon("execute"), "icon-terminal");
    });

    test("returns search icon for search kind", () => {
      assert.strictEqual(getToolKindIcon("search"), "icon-search");
    });

    test("returns fetch icon for fetch kind", () => {
      assert.strictEqual(getToolKindIcon("fetch"), "icon-globe");
    });

    test("returns move icon for move kind", () => {
      assert.strictEqual(getToolKindIcon("move"), "icon-sync");
    });

    test("returns think icon for think kind", () => {
      assert.strictEqual(getToolKindIcon("think"), "icon-sparkle-ai");
    });

    test("returns switch_mode icon for switch_mode kind", () => {
      assert.strictEqual(getToolKindIcon("switch_mode"), "icon-sync");
    });

    test("returns other icon for other kind", () => {
      assert.strictEqual(getToolKindIcon("other"), "icon-gear");
    });

    test("returns empty string for undefined kind", () => {
      assert.strictEqual(getToolKindIcon(undefined), "");
    });
  });

  suite("getToolsHtml with tool kinds", () => {
    test("renders tool kind icon when kind is provided", () => {
      const tools: Record<string, Tool> = {
        "tool-1": {
          id: "tool-1",
          name: "read_file",
          input: "file.txt",
          output: "content",
          status: "completed",
          kind: "read",
        },
      };
      const html = getToolsHtml(tools);
      assert.ok(html.includes('class="tool-kind-icon icon-document"'));
    });

    test("renders execute kind icon for command tools", () => {
      const tools: Record<string, Tool> = {
        "tool-1": {
          id: "tool-1",
          name: "bash",
          input: "npm test",
          output: "success",
          status: "completed",
          kind: "execute",
        },
      };
      const html = getToolsHtml(tools);
      assert.ok(html.includes('class="tool-kind-icon icon-terminal"'));
    });

    test("does not render kind icon when kind is undefined", () => {
      const tools: Record<string, Tool> = {
        "tool-1": {
          id: "tool-1",
          name: "unknown_tool",
          input: null,
          output: null,
          status: "running",
        },
      };
      const html = getToolsHtml(tools);
      assert.ok(!html.includes('class="tool-kind-icon"'));
    });

    test("includes kind in title attribute for accessibility", () => {
      const tools: Record<string, Tool> = {
        "tool-1": {
          id: "tool-1",
          name: "write_file",
          input: "file.txt",
          output: "done",
          status: "completed",
          kind: "edit",
        },
      };
      const html = getToolsHtml(tools);
      assert.ok(html.includes('title="edit"'));
    });
  });

  suite("diffSummary", () => {
    test("renders diff summary when changes are present", () => {
      const { controller, elements } = setupController();
      const changes = [
        {
          path: "/test/file1.ts",
          relativePath: "file1.ts",
          oldText: "line1\n",
          newText: "line1\nline2\n",
          status: "pending",
        },
      ];

      controller.handleMessage({
        type: "diffSummary",
        changes,
      } as any);

      assert.strictEqual(elements.diffSummaryContainer.style.display, "block");
      assert.ok(
        elements.diffSummaryContainer.innerHTML.includes("1 files modified")
      );
      assert.ok(elements.diffSummaryContainer.innerHTML.includes("+1"));
      assert.ok(elements.diffSummaryContainer.innerHTML.includes("-0"));
    });

    test("hides diff summary when no changes", () => {
      const { controller, elements } = setupController();
      controller.handleMessage({
        type: "diffSummary",
        changes: [],
      } as any);

      assert.strictEqual(elements.diffSummaryContainer.style.display, "none");
    });

    test("expands diff summary when toggle button is clicked", () => {
      const { controller, elements } = setupController();
      const changes = [
        {
          path: "/test/file1.ts",
          relativePath: "file1.ts",
          oldText: "old",
          newText: "new",
          status: "pending",
        },
      ];

      controller.handleMessage({
        type: "diffSummary",
        changes,
      } as any);

      const toggleBtn = elements.diffSummaryContainer.querySelector(
        ".toggle-expand"
      ) as HTMLButtonElement;
      toggleBtn.click();

      assert.ok(
        elements.diffSummaryContainer.innerHTML.includes("diff-summary-list")
      );
      assert.ok(elements.diffSummaryContainer.innerHTML.includes("file1.ts"));
    });
  });

  suite("computeLineDiff", () => {
    test("returns empty array for empty inputs", () => {
      const result = computeLineDiff("", "");
      assert.strictEqual(result.length, 0);
    });

    test("marks all lines as add for new file", () => {
      const result = computeLineDiff(null, "line1\nline2");
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].type, "add");
      assert.strictEqual(result[0].line, "line1");
      assert.strictEqual(result[1].type, "add");
      assert.strictEqual(result[1].line, "line2");
    });

    test("marks all lines as remove for deleted file", () => {
      const result = computeLineDiff("line1\nline2", null);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].type, "remove");
      assert.strictEqual(result[1].type, "remove");
    });

    test("marks old as remove and new as add for modified file", () => {
      const result = computeLineDiff("old", "new");
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].type, "remove");
      assert.strictEqual(result[0].line, "old");
      assert.strictEqual(result[1].type, "add");
      assert.strictEqual(result[1].line, "new");
    });
  });

  suite("renderDiff", () => {
    test("returns no changes message for empty diff", () => {
      const result = renderDiff(undefined, "", "");
      assert.ok(result.includes("diff-container"));
      assert.ok(result.includes("No changes"));
    });

    test("renders file path header when provided", () => {
      const result = renderDiff("/path/to/file.ts", null, "new content");
      assert.ok(result.includes("diff-header"));
      assert.ok(result.includes("/path/to/file.ts"));
    });

    test("renders additions with diff-add class", () => {
      const result = renderDiff(undefined, null, "added line");
      assert.ok(result.includes("diff-add"));
      assert.ok(result.includes('class="diff-line-prefix">+</span>'));
      assert.ok(result.includes('class="diff-line-code">added line</span>'));
    });

    test("renders deletions with diff-remove class", () => {
      const result = renderDiff(undefined, "removed line", null);
      assert.ok(result.includes("diff-remove"));
      assert.ok(result.includes('class="diff-line-prefix">-</span>'));
      assert.ok(result.includes('class="diff-line-code">removed line</span>'));
    });

    test("escapes HTML in diff content", () => {
      const result = renderDiff(
        undefined,
        null,
        "<script>alert('xss')</script>"
      );
      assert.ok(result.includes("&lt;script&gt;"));
      assert.ok(!result.includes("<script>alert"));
    });

    test("omits large sections of unmodified context", () => {
      const oldText = ["match1", ...Array(20).fill("context"), "match2"].join(
        "\n"
      );
      const newText = ["mod1", ...Array(20).fill("context"), "mod2"].join("\n");
      const result = renderDiff(undefined, oldText, newText);
      assert.ok(result.includes("diff-hunk-separator"));
      assert.ok(result.includes("..."));
      assert.ok(result.includes("mod1"));
      assert.ok(result.includes("mod2"));
    });

    test("renders line numbers", () => {
      const result = renderDiff(undefined, "old line", "new line");
      assert.ok(result.includes('class="diff-line-number">1</span>'));
      assert.ok(result.includes('class="diff-line-prefix">-</span>'));
      assert.ok(result.includes('class="diff-line-prefix">+</span>'));
    });
  });
});
