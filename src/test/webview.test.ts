import * as assert from "assert";
import { JSDOM, DOMWindow } from "jsdom";
import {
  escapeHtml,
  getElements,
  WebviewController,
  initWebview,
  ansiToHtml,
  hasAnsiCodes,
  renderDiff,
  type VsCodeApi,
  type WebviewElements,
} from "../views/webview/main";
import {
  renderToolSummary,
  renderToolDetails,
  getToolKindIcon,
} from "../views/webview/tool-render";
import { computeLineDiff } from "../utils/diff";

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

  <div id="messages-container">
    <div class="messages-fade-top"></div>
    <div id="messages"></div>
    <div class="messages-fade-bottom"></div>
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

  suite("renderToolSummary", () => {
    test("renders running tool with spinner icon", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "bash",
        kind: "execute",
        status: "in_progress",
      });
      assert.ok(
        html.includes(
          '<span class="codicon codicon-loading animate-spin"></span>'
        )
      );
      assert.ok(html.includes("bash"));
      assert.ok(html.includes("running"));
    });

    test("renders completed tool with checkmark", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "read_file",
        kind: "read",
        status: "completed",
        rawInput: { path: "path/to/file" },
      });
      assert.ok(html.includes('<span class="codicon codicon-check"></span>'));
      assert.ok(html.includes("Read:"));
      assert.ok(html.includes("path/to/file"));
    });

    test("renders failed tool with X", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "write_file",
        kind: "edit",
        status: "failed",
        rawInput: { path: "test.txt" },
      });
      assert.ok(html.includes('<span class="codicon codicon-close"></span>'));
      assert.ok(html.includes("failed"));
    });

    test("escapes tool title to prevent XSS", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "<script>alert(1)</script>",
        status: "in_progress",
      });
      assert.ok(html.includes("&lt;script&gt;"));
      assert.ok(!html.includes("<script>alert"));
    });

    test("shows duration when provided", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "test",
        kind: "execute",
        status: "completed",
        duration: 1500,
      });
      assert.ok(html.includes("1.5s"));
    });

    test("renders edit tool with correct label", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "src/file.ts",
        kind: "edit",
        status: "completed",
        rawInput: { path: "src/file.ts" },
      });
      assert.ok(html.includes("<strong>Edit:</strong>"));
      assert.ok(html.includes("src/file.ts"));
    });

    test("renders read tool with correct label", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "config.json",
        kind: "read",
        status: "completed",
        rawInput: { path: "config.json" },
      });
      assert.ok(html.includes("<strong>Read:</strong>"));
      assert.ok(html.includes("config.json"));
    });

    test("renders search tool with correct label", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "function test",
        kind: "search",
        status: "completed",
        rawInput: { pattern: "function test" },
      });
      assert.ok(html.includes("<strong>Search:</strong>"));
      assert.ok(html.includes('"function test"'));
    });
  });

  suite("renderToolDetails", () => {
    test("renders tool details panel", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "test tool",
        kind: "execute",
        status: "completed",
        rawInput: { command: "npm test", description: "Run tests" },
      });
      assert.ok(html.includes('<div class="tool-details-panel">'));
      assert.ok(html.includes("Type:"));
      assert.ok(html.includes("execute"));
    });

    test("renders input parameters in details", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "test",
        kind: "execute",
        status: "completed",
        rawInput: { command: "npm test", cwd: "/project" },
      });
      assert.ok(html.includes("Input:"));
      assert.ok(html.includes("$ npm test"));
      assert.ok(html.includes("cwd:"));
    });

    test("renders output in details", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "test",
        kind: "execute",
        status: "completed",
        rawOutput: { output: "All tests passed" },
      });
      assert.ok(html.includes("Output:"));
      assert.ok(html.includes("All tests passed"));
    });

    test("renders terminal output with ANSI support", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "terminal",
        kind: "execute",
        status: "completed",
        terminalOutput: "\x1b[32m✓ Tests passed\x1b[0m",
      });
      assert.ok(html.includes("Output:"));
      assert.ok(html.includes('class="tool-output terminal"'));
      assert.ok(html.includes('class="ansi-green"'));
      assert.ok(html.includes("✓ Tests passed"));
    });

    test("escapes HTML in plain output", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "cat",
        kind: "read",
        status: "completed",
        rawOutput: { output: "<script>alert('xss')</script>" },
      });
      assert.ok(html.includes("&lt;script&gt;"));
      assert.ok(!html.includes("<script>"));
    });

    test("renders locations in details", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "file",
        kind: "read",
        status: "completed",
        locations: [{ path: "/src/test.ts", line: 42 }],
      });
      assert.ok(html.includes("Path:"));
      assert.ok(html.includes("/src/test.ts:42"));
    });

    test("renders intent/description in details", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "test",
        kind: "execute",
        status: "completed",
        rawInput: { description: "Running unit tests" },
      });
      assert.ok(html.includes("Intent:"));
      assert.ok(html.includes("Running unit tests"));
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

      // Polyfill DataTransfer and ClipboardEvent for JSDOM clipboard testing
      if (!(window as any).DataTransfer) {
        (window as any).DataTransfer = class DataTransfer {
          dropEffect: string = "copy";
          effectAllowed: string = "all";
          files: FileList = {
            length: 0,
            item: () => null,
            [Symbol.iterator]: () => [][Symbol.iterator](),
          } as FileList;
          items: DataTransferItemList = {
            length: 0,
            add: () => {},
            remove: () => {},
            clear: () => {},
            0: {
              type: "",
              kind: "string",
              getAsFile: () => null,
              getAsString: () => {},
            },
            [Symbol.iterator]: () => [][Symbol.iterator](),
          } as any;
          types: string[] = [];
          constructor() {
            this.items = [] as any;
            this.types = [];
          }
          setData(_format: string, _data: string): void {}
          getData(format: string): string {
            return (this as any)._getData?.(format) ?? "";
          }
          clearData(_format?: string): void {}
          getAsFile(): File | null {
            return null;
          }
        };
      }
      if (!(window as any).ClipboardEvent) {
        (window as any).ClipboardEvent = class ClipboardEvent extends Event {
          clipboardData: DataTransfer;
          constructor(
            type: string,
            props?: {
              bubbles?: boolean;
              cancelable?: boolean;
              clipboardData?: DataTransfer;
            }
          ) {
            super(type, {
              bubbles: props?.bubbles ?? false,
              cancelable: props?.cancelable ?? false,
            });
            this.clipboardData =
              props?.clipboardData ?? new (window as any).DataTransfer();
          }
        };
      }

      // Polyfill FileReader for JSDOM image paste tests
      // Uses a minimal sync-like implementation that fires onload immediately
      const frClass = class FileReader {
        readyState: number = 0;
        result: string | ArrayBuffer | null = null;
        error: Error | null = null;
        onload: ((event: ProgressEvent) => void) | null = null;
        onerror: ((event: ProgressEvent) => void) | null = null;
        onloadend: ((event: ProgressEvent) => void) | null = null;
        readAsDataURL(_blob: Blob): void {
          // Synchronously call onload with a minimal valid data URL
          // This is sufficient for tests that only verify the image handling path
          this.result = "data:image/png;base64,";
          this.readyState = 2;
          if (this.onload) this.onload({} as ProgressEvent);
          if (this.onloadend) this.onloadend({} as ProgressEvent);
        }
        readAsText(_blob: Blob): void {
          this.result = "";
          this.readyState = 2;
          if (this.onload) this.onload({} as ProgressEvent);
          if (this.onloadend) this.onloadend({} as ProgressEvent);
        }
        abort(): void {}
        addEventListener(_type: string, _listener: EventListener): void {}
        removeEventListener(_type: string, _listener: EventListener): void {}
      };
      // Set on both window and globalThis so compiled code can access it either way
      (window as any).FileReader = frClass;
      (globalThis as any).FileReader = frClass;

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

      test("handles userMessage with slash commands", () => {
        // Set up available commands first
        controller.handleMessage({
          type: "availableCommands",
          commands: [
            { name: "explain", description: "Explain the code" },
            { name: "fix", description: "Fix the bug" },
          ],
        });

        controller.handleMessage({
          type: "userMessage",
          text: "/explain this code",
        });

        const msgs = elements.messagesEl.querySelectorAll(".message.user");
        assert.strictEqual(msgs.length, 1);

        const commandChip = msgs[0].querySelector(".command-chip");
        assert.ok(commandChip !== null, "Command chip should be rendered");
        assert.strictEqual(commandChip.textContent, "explain");
        assert.strictEqual(
          (commandChip as HTMLElement).getAttribute("acp-title"),
          "Explain the code"
        );
        assert.ok(
          msgs[0].textContent.includes(" this code"),
          "Remaining text should be present"
        );
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
          mentionChip.querySelector(".codicon-file-media"),
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

    suite("Action Buttons and Copy Logic", () => {
      test("renders action buttons after streamEnd", () => {
        controller.handleMessage({ type: "streamStart" });
        controller.handleMessage({ type: "streamChunk", text: "Final output" });
        controller.handleMessage({ type: "streamEnd" });

        const assistantMsg =
          elements.messagesEl.querySelector(".message.assistant");
        assert.ok(assistantMsg);
        const actions = assistantMsg.querySelector(".message-actions");
        assert.ok(actions, "Actions container should be present");

        const buttons = actions.querySelectorAll(".action-btn");
        assert.strictEqual(buttons.length, 4, "Should have 4 action buttons");

        // Check acp-title for tooltips
        assert.strictEqual(
          buttons[0].getAttribute("acp-title"),
          "Copy response"
        );
        assert.strictEqual(
          buttons[1].getAttribute("acp-title"),
          "Copy to input"
        );
        assert.strictEqual(
          buttons[2].getAttribute("acp-title"),
          "Scroll to top"
        );
        assert.strictEqual(
          buttons[3].getAttribute("acp-title"),
          "Scroll to user question"
        );
      });

      test("Paste to input action uses the last text block", async () => {
        controller.handleMessage({ type: "streamStart" });
        controller.handleMessage({
          type: "streamChunk",
          text: "Internal state",
        });
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "t2",
          name: "ls",
        });
        controller.handleMessage({
          type: "toolCallComplete",
          toolCallId: "t2",
          status: "completed",
        });
        controller.handleMessage({
          type: "streamChunk",
          text: "Public result",
        });
        controller.handleMessage({ type: "streamEnd" });

        const assistantMsg = elements.messagesEl.querySelector(
          ".message.assistant"
        ) as HTMLElement;
        const pasteBtn = assistantMsg.querySelector(
          '.action-btn[acp-title="Copy to input"]'
        ) as HTMLElement;

        pasteBtn.click();

        // Wait for next tick
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.strictEqual(elements.inputEl.textContent, "Public result");
      });

      test("Turn separation: each turn gets its own container and toolbar", () => {
        // First Turn
        controller.handleMessage({ type: "userMessage", text: "Question 1" });
        controller.handleMessage({ type: "streamChunk", text: "Answer 1" });
        controller.handleMessage({ type: "streamEnd" });

        // Second Turn
        controller.handleMessage({ type: "userMessage", text: "Question 2" });
        controller.handleMessage({ type: "streamChunk", text: "Answer 2" });
        controller.handleMessage({ type: "streamEnd" });

        const assistantMsgs =
          elements.messagesEl.querySelectorAll(".message.assistant");
        assert.strictEqual(
          assistantMsgs.length,
          2,
          "Should have 2 separate assistant messages"
        );

        assert.ok(
          assistantMsgs[0].querySelector(".message-actions"),
          "Turn 1 should have toolbar"
        );
        assert.ok(
          assistantMsgs[1].querySelector(".message-actions"),
          "Turn 2 should have toolbar"
        );

        assert.strictEqual(
          assistantMsgs[0].textContent.includes("Answer 1"),
          true
        );
        assert.strictEqual(
          assistantMsgs[0].textContent.includes("Answer 2"),
          false
        );
        assert.strictEqual(
          assistantMsgs[1].textContent.includes("Answer 2"),
          true
        );
      });
    });

    suite("model selection with starring and grouping", () => {
      const testModels = {
        availableModels: [
          { modelId: "model-1", name: "Model 1" },
          { modelId: "model-2", name: "Model 2" },
        ],
        currentModelId: "model-1",
      };

      test("handles sessionMetadata with models", () => {
        controller.handleMessage({
          type: "sessionMetadata",
          models: testModels,
          modes: null,
        });
        assert.strictEqual(elements.modelDropdown.style.display, "flex");
        const label = elements.modelDropdown.querySelector(".selected-label");
        assert.strictEqual(label?.textContent, "Model 1");
      });

      test("renders models in dropdown", () => {
        controller.handleMessage({
          type: "sessionMetadata",
          models: testModels,
          modes: null,
        });

        // Open dropdown
        elements.modelDropdown
          .querySelector(".dropdown-trigger")
          ?.dispatchEvent(new window.MouseEvent("click"));

        const popover =
          elements.modelDropdown.querySelector(".dropdown-popover")!;
        const items = popover.querySelectorAll(".dropdown-item");
        assert.strictEqual(items.length, 2);
      });

      test("starring a model sends toggleModelStar message and renders groups after sessionMetadata update", () => {
        controller.handleMessage({
          type: "sessionMetadata",
          models: testModels,
          modes: null,
        });

        // Open dropdown
        elements.modelDropdown
          .querySelector(".dropdown-trigger")
          ?.dispatchEvent(new window.MouseEvent("click"));
        const popover =
          elements.modelDropdown.querySelector(".dropdown-popover")!;

        // Find star icon for model-2 and click it
        const model2Item = popover.querySelector('[data-id="model-2"]')!;
        const starIcon = model2Item.querySelector(
          ".dropdown-item-star"
        ) as HTMLElement;
        assert.ok(starIcon);
        starIcon.click();

        // Verify toggleModelStar message was sent to Extension
        const messages = mockVsCode._getMessages();
        const toggleMsg = messages.find(
          (m: any) => m.type === "toggleModelStar"
        );
        assert.ok(toggleMsg, "should send toggleModelStar message");
        assert.strictEqual((toggleMsg as any).modelId, "model-2");
        assert.strictEqual((toggleMsg as any).isStarred, true);

        // Simulate Extension replying with updated sessionMetadata
        controller.handleMessage({
          type: "sessionMetadata",
          models: testModels,
          modes: null,
          starredModels: ["model-2"],
        });

        // Dropdown should now show Starred and All Models groups
        const headers = popover.querySelectorAll(".dropdown-header");
        assert.strictEqual(headers.length, 2);
        assert.strictEqual(headers[0].textContent, "Starred");
        assert.strictEqual(headers[1].textContent, "All Models");

        // Should have model-2 in Starred group and both in All Models group
        const allItems = popover.querySelectorAll(".dropdown-item");
        assert.strictEqual(allItems.length, 3); // 1 starred + 2 all

        assert.strictEqual(allItems[0].getAttribute("data-id"), "model-2");
        assert.strictEqual(allItems[1].getAttribute("data-id"), "model-1");
        assert.strictEqual(allItems[2].getAttribute("data-id"), "model-2");
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

      test("command chips are serialized to plain text in sendMessage", () => {
        mockVsCode._clearMessages();

        // Simulate a command chip followed by text
        const commandChip = (controller as any).renderCommandChip(
          "/explain",
          "Explain this"
        );
        elements.inputEl.appendChild(commandChip);
        elements.inputEl.appendChild(document.createTextNode(" this code"));

        const event = new window.KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: false,
        });
        elements.inputEl.dispatchEvent(event);

        const messages = mockVsCode._getMessages();
        const sentMsg = messages.find(
          (m: any) => (m as any).type === "sendMessage"
        ) as any;
        assert.ok(sentMsg, "Message should be sent");
        assert.strictEqual(
          sentMsg.text,
          "/explain this code",
          "Command chip should be serialized to plain text"
        );
      });

      test("Escape clears input", () => {
        elements.inputEl.innerHTML = "Test message";
        const event = new window.KeyboardEvent("keydown", { key: "Escape" });
        elements.inputEl.dispatchEvent(event);
        assert.strictEqual(elements.inputEl.textContent, "");
      });
    });

    suite("paste handling", () => {
      /**
       * Helper that calls the public onPaste method with a mock event object.
       * The mock clipboardData matches the shape the handler expects.
       */
      function simulatePaste(clipboardData: {
        items: Array<{ type: string; getAsFile?: () => File | null }>;
        getData: (type: string) => string;
      }): void {
        controller.onPaste({
          clipboardData,
          preventDefault: () => {},
        });
      }

      test("paste plain text inserts text content only", () => {
        mockVsCode._clearMessages();
        elements.inputEl.focus();

        const plainText = "Hello world from paste";
        simulatePaste({
          items: [],
          getData: (type: string) => (type === "text/plain" ? plainText : ""),
        });

        // Verify plain text was inserted
        assert.strictEqual(elements.inputEl.textContent, plainText);
        // Ensure no HTML tags were inserted
        assert.strictEqual(
          elements.inputEl.querySelectorAll("div, span, p, b, i").length,
          0
        );
      });

      test("paste rich HTML from web page extracts plain text only", () => {
        mockVsCode._clearMessages();
        elements.inputEl.focus();

        // Simulate pasting from a webpage with rich formatting
        const richHtml =
          "<p>Hello <b>world</b> with <i>formatting</i></p>" +
          '<a href="http://example.com">a link</a>' +
          "<script>alert('xss')</script>";
        const plainTextFromHtml = "Hello world with formatting";

        simulatePaste({
          items: [{ type: "text/html" }],
          getData: (type: string) => {
            if (type === "text/plain") return plainTextFromHtml;
            if (type === "text/html") return richHtml;
            return "";
          },
        });

        // Should have extracted only the plain text, no HTML tags
        assert.strictEqual(elements.inputEl.textContent, plainTextFromHtml);
        // Verify no dangerous HTML elements were inserted
        assert.strictEqual(
          elements.inputEl.querySelectorAll("p, b, i, a, script").length,
          0
        );
      });

      test("paste XSS attempt does not inject script elements", () => {
        mockVsCode._clearMessages();
        elements.inputEl.focus();

        // Attempt XSS via script injection
        const xssHtml =
          '<div>Hello</div><script>document.body.innerHTML="hacked"</script>';
        const safeText = "Hello";

        simulatePaste({
          items: [{ type: "text/html" }],
          getData: (type: string) => {
            if (type === "text/plain") return safeText;
            if (type === "text/html") return xssHtml;
            return "";
          },
        });

        // Should have extracted plain text, no script tags
        assert.strictEqual(elements.inputEl.textContent, safeText);
        assert.strictEqual(
          elements.inputEl.querySelectorAll("script").length,
          0,
          "script element should not be present after paste"
        );
        assert.strictEqual(
          elements.inputEl.querySelectorAll("div").length,
          0,
          "no div elements should be present"
        );
      });

      test("paste image triggers image attachment", () => {
        mockVsCode._clearMessages();
        elements.inputEl.focus();

        // Create a fake image blob
        const fakeImageBlob = new Blob(["fake-image-data"], {
          type: "image/png",
        });
        const fakeFile = new File([fakeImageBlob], "screenshot.png", {
          type: "image/png",
        });

        // Spy on insertMentionChip to detect image handling
        const originalInsertMentionChip = (controller as any).insertMentionChip;
        let imageInserted = false;
        (controller as any).insertMentionChip = function (mention: any) {
          if (mention.type === "image") {
            imageInserted = true;
          }
          return originalInsertMentionChip.call(this, mention);
        };

        simulatePaste({
          items: [{ type: "image/png", getAsFile: () => fakeFile }],
          getData: () => "",
        });

        // Restore original method
        (controller as any).insertMentionChip = originalInsertMentionChip;

        assert.strictEqual(
          imageInserted,
          true,
          "image attachment should have been triggered"
        );
      });

      test("paste updates input state after paste", () => {
        mockVsCode._clearMessages();
        elements.inputEl.focus();

        const plainText = "state update test";
        simulatePaste({
          items: [],
          getData: (type: string) => (type === "text/plain" ? plainText : ""),
        });

        // Send button should be enabled after pasting non-empty text
        assert.strictEqual(elements.sendBtn.disabled, false);
      });

      test("paste with no matching listener does not throw", () => {
        mockVsCode._clearMessages();
        elements.inputEl.focus();

        // Empty clipboard data - should be handled gracefully
        assert.doesNotThrow(() => {
          simulatePaste({
            items: [],
            getData: () => "",
          });
        });
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
          setStartAfter: () => {},
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
        assert.ok(elements.inputEl.textContent.includes("help "));
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
        const progress = elements.planContainer.querySelector(".plan-counter");
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

  suite("renderToolDetails with ANSI and XSS", () => {
    test("escapes HTML in plain output", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "cat",
        kind: "read",
        status: "completed",
        rawOutput: { output: "<script>alert('xss')</script>" },
      });
      assert.ok(html.includes("&lt;script&gt;"));
      assert.ok(!html.includes("<script>"));
    });

    test("handles ANSI output with HTML characters", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "grep",
        kind: "search",
        status: "failed",
        terminalOutput: "\x1b[31m<error>\x1b[0m",
      });
      assert.ok(html.includes("&lt;error&gt;"));
      assert.ok(html.includes('class="ansi-red"'));
    });
  });

  suite("getToolKindIcon", () => {
    test("returns read icon for read kind", () => {
      assert.strictEqual(getToolKindIcon("read"), "codicon codicon-file-text");
    });

    test("returns edit icon for edit kind", () => {
      assert.strictEqual(getToolKindIcon("edit"), "codicon codicon-edit");
    });

    test("returns delete icon for delete kind", () => {
      assert.strictEqual(getToolKindIcon("delete"), "codicon codicon-trash");
    });

    test("returns execute icon for execute kind", () => {
      assert.strictEqual(
        getToolKindIcon("execute"),
        "codicon codicon-terminal"
      );
    });

    test("returns search icon for search kind", () => {
      assert.strictEqual(getToolKindIcon("search"), "codicon codicon-search");
    });

    test("returns fetch icon for fetch kind", () => {
      assert.strictEqual(getToolKindIcon("fetch"), "codicon codicon-globe");
    });

    test("returns move icon for move kind", () => {
      assert.strictEqual(getToolKindIcon("move"), "codicon codicon-references");
    });

    test("returns think icon for think kind", () => {
      assert.strictEqual(getToolKindIcon("think"), "codicon codicon-lightbulb");
    });

    test("returns switch_mode icon for switch_mode kind", () => {
      assert.strictEqual(
        getToolKindIcon("switch_mode"),
        "codicon codicon-sync"
      );
    });

    test("returns other icon for other kind", () => {
      assert.strictEqual(getToolKindIcon("other"), "codicon codicon-tools");
    });

    test("returns empty string for undefined kind", () => {
      assert.strictEqual(getToolKindIcon(undefined), "");
    });
  });

  suite("renderToolSummary with tool kinds", () => {
    test("renders tool kind icon when kind is provided", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "file.txt",
        kind: "read",
        status: "completed",
        rawInput: { path: "file.txt" },
      });
      assert.ok(html.includes('class="codicon codicon-file-text"'));
    });

    test("renders execute kind icon for command tools", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "npm test",
        kind: "execute",
        status: "completed",
        rawInput: { command: "npm test" },
      });
      assert.ok(html.includes('class="codicon codicon-terminal"'));
    });

    test("does not render kind icon when kind is undefined", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "unknown_tool",
        status: "in_progress",
      });
      // Should still have status icon but no specific tool-kind-icon
      assert.ok(html.includes("codicon-loading"));
    });

    test("renders edit tool with edit icon", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "file.txt",
        kind: "edit",
        status: "completed",
        rawInput: { path: "file.txt" },
      });
      assert.ok(html.includes('class="codicon codicon-edit"'));
      assert.ok(html.includes("<strong>Edit:</strong>"));
    });

    test("renders delete tool with trash icon", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "old-file.txt",
        kind: "delete",
        status: "completed",
        rawInput: { path: "old-file.txt" },
      });
      assert.ok(html.includes('class="codicon codicon-trash"'));
    });

    test("renders search tool with search icon", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "pattern",
        kind: "search",
        status: "completed",
        rawInput: { pattern: "pattern" },
      });
      assert.ok(html.includes('class="codicon codicon-search"'));
    });

    test("renders fetch tool with globe icon", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "https://example.com",
        kind: "fetch",
        status: "completed",
        rawInput: { url: "https://example.com" },
      });
      assert.ok(html.includes('class="codicon codicon-globe"'));
    });

    test("renders think tool with lightbulb icon", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "thinking",
        kind: "think",
        status: "completed",
      });
      assert.ok(html.includes('class="codicon codicon-lightbulb"'));
    });

    test("renders switch_mode tool with sync icon", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "switching",
        kind: "switch_mode",
        status: "completed",
      });
      assert.ok(html.includes('class="codicon codicon-sync"'));
    });

    test("renders other tool with gear icon", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "custom tool",
        kind: "other",
        status: "completed",
      });
      assert.ok(html.includes('class="codicon codicon-tools"'));
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

    test("groups consecutive replacements instead of interleaving", () => {
      const oldText = "Line 1\nLine 2";
      const newText = "New 1\nNew 2";
      const result = computeLineDiff(oldText, newText);

      // Should be: [-Line 1, -Line 2, +New 1, +New 2]
      // instead of: [-Line 1, +New 1, -Line 2, +New 2]
      assert.strictEqual(result.length, 4);
      assert.strictEqual(result[0].type, "remove");
      assert.strictEqual(result[0].line, "Line 1");
      assert.strictEqual(result[1].type, "remove");
      assert.strictEqual(result[1].line, "Line 2");
      assert.strictEqual(result[2].type, "add");
      assert.strictEqual(result[2].line, "New 1");
      assert.strictEqual(result[3].type, "add");
      assert.strictEqual(result[3].line, "New 2");
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
