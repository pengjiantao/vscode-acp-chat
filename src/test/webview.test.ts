/* eslint-disable @typescript-eslint/no-explicit-any */
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { JSDOM, DOMWindow } from "jsdom";
import { WebviewController, initWebview } from "../views/webview/main";
import { getRequiredElement } from "../views/webview/widget/dom";
import { StatePersistenceService } from "../views/webview/state-persistence";
import { renderDiff } from "../views/webview/widget/diff-render";
import type {
  VsCodeApi,
  WebviewElements,
  Mention,
} from "../views/webview/types";
import { ansiToHtml, hasAnsiCodes } from "../views/webview/ansi-render";
import { escapeHtml } from "../views/webview/html-utils";
import {
  renderToolSummary,
  renderToolDetails,
  getToolKindIcon,
} from "../views/webview/tool-render";
import { computeLineDiff } from "../utils/diff";
import { EventBus } from "../views/webview/event-bus";
import { TooltipManager } from "../views/webview/widget/tooltip";
import { marked } from "../views/webview/marked-config";

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
    <div class="welcome-logo" style="mask-image: url(logo.svg); -webkit-mask-image: url(logo.svg);" role="img" aria-label="VSCode ACP Logo"></div>
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
}

function getElements(doc: Document): WebviewElements {
  const messageList = {
    containerEl: getRequiredElement(doc, "messages-container"),
    messagesEl: getRequiredElement(doc, "messages"),
    typingIndicatorEl: getRequiredElement(doc, "typing-indicator"),
    welcomeView: getRequiredElement(doc, "welcome-view"),
  };

  const sessionToolbar = {
    modeDropdown: getRequiredElement(doc, "mode-dropdown"),
    modelDropdown: getRequiredElement(doc, "model-dropdown"),
    configOptionsContainer: getRequiredElement(doc, "config-options-container"),
    contextUsageRing: getRequiredElement<HTMLDivElement>(
      doc,
      "context-usage-ring"
    ),
  };

  const inputPanel = {
    inputEl: getRequiredElement(doc, "input"),
    commandAutocomplete: getRequiredElement(doc, "command-autocomplete"),
    attachImageBtn: getRequiredElement<HTMLButtonElement>(doc, "attach-image"),
    imagePreviewPopover: getRequiredElement(doc, "image-preview-popover"),
    sendBtn: getRequiredElement<HTMLButtonElement>(doc, "send"),
    stopBtn: getRequiredElement<HTMLButtonElement>(doc, "stop"),
    toolbar: sessionToolbar,
  };

  const auxiliaryPanels = {
    planContainer: getRequiredElement(doc, "agent-plan-container"),
    diffSummaryContainer: getRequiredElement(doc, "diff-summary-container"),
  };

  return {
    messageList,
    inputPanel,
    sessionToolbar,
    auxiliaryPanels,

    messagesContainerEl: messageList.containerEl,
    messagesEl: messageList.messagesEl,
    inputEl: inputPanel.inputEl,
    attachImageBtn: inputPanel.attachImageBtn,
    imagePreviewPopover: inputPanel.imagePreviewPopover,
    sendBtn: inputPanel.sendBtn,
    stopBtn: inputPanel.stopBtn,
    modeDropdown: sessionToolbar.modeDropdown,
    modelDropdown: sessionToolbar.modelDropdown,
    configOptionsContainer: sessionToolbar.configOptionsContainer,
    contextUsageRing: sessionToolbar.contextUsageRing,
    welcomeView: messageList.welcomeView,
    commandAutocomplete: inputPanel.commandAutocomplete,
    planContainer: auxiliaryPanels.planContainer,
    typingIndicatorEl: messageList.typingIndicatorEl,
    diffSummaryContainer: auxiliaryPanels.diffSummaryContainer,
  };
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
    (global as any).NodeFilter = window.NodeFilter;
    const controller = new WebviewController(
      mockVsCode,
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

  suite("EventBus", () => {
    test("on/emit invokes handler with correct payload", () => {
      const bus = new EventBus<{ test: string }>();
      let received = "";
      bus.on("test", (payload) => {
        received = payload;
      });
      bus.emit("test", "hello");
      assert.strictEqual(received, "hello");
    });

    test("emit with no listeners does not throw", () => {
      const bus = new EventBus<{ test: string }>();
      assert.doesNotThrow(() => bus.emit("test", "hello"));
    });

    test("multiple handlers are all invoked", () => {
      const bus = new EventBus<{ test: number }>();
      const calls: number[] = [];
      bus.on("test", (v) => calls.push(v));
      bus.on("test", (v) => calls.push(v + 1));
      bus.emit("test", 10);
      assert.deepStrictEqual(calls, [10, 11]);
    });

    test("off removes a specific handler", () => {
      const bus = new EventBus<{ test: string }>();
      const calls: string[] = [];
      const handler1 = (v: string) => calls.push("h1:" + v);
      const handler2 = (v: string) => calls.push("h2:" + v);
      bus.on("test", handler1);
      bus.on("test", handler2);
      bus.off("test", handler1);
      bus.emit("test", "x");
      assert.deepStrictEqual(calls, ["h2:x"]);
    });

    test("off for unregistered handler is a no-op", () => {
      const bus = new EventBus<{ test: string }>();
      assert.doesNotThrow(() => bus.off("test", () => {}));
    });

    test("same handler is only added once (Set)", () => {
      const bus = new EventBus<{ test: number }>();
      let count = 0;
      const handler = () => {
        count++;
      };
      bus.on("test", handler);
      bus.on("test", handler);
      bus.emit("test", 0);
      assert.strictEqual(count, 1);
    });

    test("different events are independent", () => {
      const bus = new EventBus<{ a: string; b: string }>();
      const calls: string[] = [];
      bus.on("a", (v) => calls.push("a:" + v));
      bus.on("b", (v) => calls.push("b:" + v));
      bus.emit("a", "1");
      assert.deepStrictEqual(calls, ["a:1"]);
    });

    test("handlers are invoked synchronously in registration order", () => {
      const bus = new EventBus<{ test: number }>();
      const order: number[] = [];
      bus.on("test", () => order.push(1));
      bus.on("test", () => order.push(2));
      bus.on("test", () => order.push(3));
      bus.emit("test", 0);
      assert.deepStrictEqual(order, [1, 2, 3]);
    });
  });

  suite("renderToolSummary", () => {
    test("renders running tool summary without spinner (spinner managed in DOM)", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "bash",
        kind: "execute",
        status: "in_progress",
      });
      // Spinner is now managed separately in the DOM, not in renderToolSummary
      assert.ok(!html.includes("codicon-loading"));
      assert.ok(html.includes("bash"));
    });

    test("renders completed tool without status icon", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "read_file",
        kind: "read",
        status: "completed",
        rawInput: { path: "path/to/file" },
      });
      assert.ok(!html.includes("codicon-check"));
      assert.ok(!html.includes("codicon-close"));
      assert.ok(html.includes("Read:"));
      assert.ok(html.includes("path/to/file"));
    });

    test("renders failed tool summary without status icon", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "write_file",
        kind: "edit",
        status: "failed",
        rawInput: { path: "test.txt" },
      });
      assert.ok(!html.includes("codicon-check"));
      assert.ok(!html.includes("codicon-close"));
      assert.ok(html.includes("Edit:"));
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

    test("renders read tool with line range from offset and limit", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "main.ts",
        kind: "read",
        status: "completed",
        rawInput: { path: "main.ts", offset: 100, limit: 100 },
      });
      assert.ok(html.includes("(lines 101-200)"));
      assert.ok(!html.includes("(100 lines)"));
    });

    test("renders read tool with limit only", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "main.ts",
        kind: "read",
        status: "completed",
        rawInput: { path: "main.ts", limit: 50 },
      });
      assert.ok(html.includes("(lines 1-50)"));
    });

    test("renders read tool without offset or limit", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "main.ts",
        kind: "read",
        status: "completed",
        rawInput: { path: "main.ts" },
      });
      assert.ok(html.includes("<strong>Read:</strong>"));
      assert.ok(!html.includes("lines"));
    });

    test("renders read tool without line range when limit is 0", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "main.ts",
        kind: "read",
        status: "completed",
        rawInput: { path: "main.ts", limit: 0 },
      });
      assert.ok(html.includes("<strong>Read:</strong>"));
      assert.ok(!html.includes("lines"));
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
      assert.ok(html.includes('<div class="io-block">'));
      assert.ok(html.includes("$ npm test"));
    });

    test("renders input parameters in details", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "test",
        kind: "execute",
        status: "completed",
        rawInput: { command: "npm test", cwd: "/project" },
      });
      assert.ok(html.includes('<div class="io-block">'));
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
      assert.ok(html.includes('<div class="io-block">'));
      assert.ok(html.includes("All tests passed"));
    });

    test("renders rawOutput string as output", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "test",
        kind: "execute",
        status: "completed",
        rawOutput: "hello world\n",
      });
      assert.ok(html.includes('<div class="io-block">'));
      assert.ok(html.includes("hello world"));
    });

    test("renders rawOutput text field as output", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "test",
        kind: "execute",
        status: "completed",
        rawOutput: { text: "command output here" },
      });
      assert.ok(html.includes('<div class="io-block">'));
      assert.ok(html.includes("command output here"));
    });

    test("renders terminal output with ANSI support", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "terminal",
        kind: "execute",
        status: "completed",
        terminalOutput: "\x1b[32m✓ Tests passed\x1b[0m",
      });
      assert.ok(html.includes('<div class="io-block">'));
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

    test("renders empty details panel when only locations provided", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "file",
        kind: "read",
        status: "completed",
        locations: [{ path: "/src/test.ts", line: 42 }],
      });
      assert.ok(html.includes("tool-details-panel"));
    });

    test("renders intent/description in details", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "test",
        kind: "execute",
        status: "completed",
        rawInput: { description: "Running unit tests" },
      });
      // Execute tools should use IO block
      assert.ok(html.includes('<div class="io-block">'));
      assert.ok(html.includes("Running unit tests"));
    });
  });

  suite("TooltipManager", () => {
    test("measures a new tooltip from a neutral position", () => {
      const dom = new JSDOM("<!DOCTYPE html><body></body>", {
        url: "https://localhost",
      });
      const doc = dom.window.document;
      const action = doc.createElement("button");
      const dropdown = doc.createElement("button");
      action.setAttribute("acp-title", "Copy response");
      dropdown.setAttribute(
        "acp-title",
        "Reasoning effort\nHow much reasoning effort the model should use"
      );
      doc.body.append(action, dropdown);

      const originalSetTimeout = global.setTimeout;
      (global as typeof globalThis).setTimeout = ((callback: () => void) => {
        callback();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout;

      try {
        new TooltipManager(doc, dom.window as unknown as Window).setup();
        const tooltip = doc.querySelector(".acp-tooltip") as HTMLElement;
        let measuredLeft = "";
        tooltip.getBoundingClientRect = () => {
          measuredLeft = tooltip.style.left;
          return { width: 180, height: 40 } as DOMRect;
        };
        action.getBoundingClientRect = () =>
          ({ left: 20, top: 20, width: 40, height: 20, bottom: 40 }) as DOMRect;
        dropdown.getBoundingClientRect = () =>
          ({
            left: 300,
            top: 300,
            width: 80,
            height: 20,
            bottom: 320,
          }) as DOMRect;

        action.dispatchEvent(
          new dom.window.MouseEvent("mouseover", { bubbles: true })
        );
        tooltip.style.left = "120px";
        dropdown.dispatchEvent(
          new dom.window.MouseEvent("mouseover", { bubbles: true })
        );

        assert.strictEqual(measuredLeft, "0px");
      } finally {
        global.setTimeout = originalSetTimeout;
      }
    });

    test("adds acp-title to markdown links for tooltip", () => {
      const markdown1 = "[file link](file:///path/to/file.ts:10-20)";
      const html1 = marked.parse(markdown1) as string;
      assert.ok(html1.includes('acp-title="file:///path/to/file.ts:10-20"'));

      const markdown2 = '[web link](https://example.com "Custom Title")';
      const html2 = marked.parse(markdown2) as string;
      assert.ok(html2.includes('acp-title="Custom Title"'));
    });

    test("escapes attributes in markdown links to prevent XSS", () => {
      const markdown = '[test](https://example.com/foo"bar)';
      const html = marked.parse(markdown) as string;
      assert.ok(!html.includes('href="https://example.com/foo"bar"'));
      assert.ok(html.includes("&quot;"));
    });

    test("filters dangerous URI schemes in markdown links", () => {
      const jsMarkdown = "[click me](javascript:alert(1))";
      const jsHtml = marked.parse(jsMarkdown) as string;
      assert.ok(!jsHtml.includes("<a "));
      assert.ok(jsHtml.includes("click me"));

      const dataMarkdown =
        "[click me](data:text/html,<script>alert(1)</script>)";
      const dataHtml = marked.parse(dataMarkdown) as string;
      assert.ok(!dataHtml.includes("<a "));
      assert.ok(dataHtml.includes("click me"));
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
      (global as any).NodeFilter = window.NodeFilter;

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
        document,
        window as unknown as Window
      );
    });

    teardown(() => {
      dom.window.close();
    });

    function installAnimationFrameQueue() {
      let nextFrameId = 1;
      const frames: Array<{ id: number; callback: FrameRequestCallback }> = [];
      (window as any).requestAnimationFrame = (
        callback: FrameRequestCallback
      ) => {
        const id = nextFrameId++;
        frames.push({ id, callback });
        return id;
      };
      (window as any).cancelAnimationFrame = (id: number) => {
        const index = frames.findIndex((frame) => frame.id === id);
        if (index >= 0) {
          frames.splice(index, 1);
        }
      };

      return {
        frames,
        runNextFrame: () => {
          const frame = frames.shift();
          assert.ok(frame, "expected a queued animation frame");
          frame.callback(Date.now());
        },
        runAllFrames: () => {
          while (frames.length > 0) {
            const frame = frames.shift();
            assert.ok(frame, "expected a queued animation frame");
            frame.callback(Date.now());
          }
        },
      };
    }

    test("sends ready message on initialization", () => {
      const messages = mockVsCode._getMessages();
      assert.ok(
        messages.some((m: unknown) => (m as { type: string }).type === "ready")
      );
    });

    suite("addMessage", () => {
      test("adds user message to DOM", () => {
        controller.messageList.addMessage("Hello!", "user");
        const msgs = elements.messagesEl.querySelectorAll(".message.user");
        assert.strictEqual(msgs.length, 1);
        assert.strictEqual(msgs[0].textContent, "Hello!");
      });

      test("adds assistant message to DOM", () => {
        controller.messageList.addMessage("Hi there!", "assistant");
        const msgs = elements.messagesEl.querySelectorAll(".message.assistant");
        assert.strictEqual(msgs.length, 1);
        assert.strictEqual(msgs[0].textContent, "Hi there!");
      });

      test("adds error message to DOM", () => {
        controller.messageList.addMessage("Error occurred", "error");
        const msgs = elements.messagesEl.querySelectorAll(".message.error");
        assert.strictEqual(msgs.length, 1);
      });

      test("sets accessibility attributes", () => {
        const msg = controller.messageList.addMessage("Test", "user");
        assert.strictEqual(msg.getAttribute("role"), "article");
        assert.strictEqual(msg.getAttribute("tabindex"), "0");
        assert.strictEqual(msg.getAttribute("aria-label"), "Your message");
      });

      test("returns the created element", () => {
        const msg = controller.messageList.addMessage("Test", "user");
        assert.ok(msg instanceof dom.window.HTMLElement);
        assert.strictEqual(msg.textContent, "Test");
      });
    });

    suite("updateStatus", () => {
      test("saves state after update", () => {
        controller.handleMessage({
          type: "connectionState",
          state: "connected",
        });
        const state = mockVsCode.getState<{ isConnected: boolean }>();
        assert.strictEqual(state?.isConnected, true);
      });
    });

    suite("showThinking/hideThinking", () => {
      test("showThinking adds thinking element", () => {
        const parentEl = controller.messageList.ensureAssistantMessage();
        controller.messageList
          .getBlockManager()
          .ensureBlock("thought", parentEl, elements.typingIndicatorEl);
        const thinking = elements.messagesEl.querySelector(".agent-thought");
        assert.ok(thinking);
        assert.strictEqual(thinking?.getAttribute("open"), "");
      });

      test("hideThinking closes thinking element", () => {
        const parentEl = controller.messageList.ensureAssistantMessage();
        controller.messageList
          .getBlockManager()
          .ensureBlock("thought", parentEl, elements.typingIndicatorEl);
        const block = controller.messageList.getBlockManager().getActiveBlock();
        if (block && block.blockType === "thought") {
          controller.messageList.getBlockManager().finalizeBlock(block);
        }
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
        assert.strictEqual(commandChip.textContent, "/explain");
        assert.strictEqual(commandChip.querySelector(".chip-icon"), null);
        assert.strictEqual(
          commandChip.querySelector(".chip-prefix")?.textContent,
          "/"
        );
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
          mentionChip.querySelector(".file-type-icon"),
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

      suite("contextUsage", () => {
        const RADIUS = 7;
        const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

        function getFg() {
          return elements.contextUsageRing.querySelector(
            ".context-usage__fg"
          ) as SVGCircleElement | null;
        }
        function getTooltip() {
          return elements.contextUsageRing.getAttribute("acp-title") ?? "";
        }

        test("first valid payload reveals ring and applies usage-low tier", () => {
          controller.handleMessage({
            type: "contextUsage",
            used: 100,
            size: 1000,
            cost: null,
          });
          assert.strictEqual(
            elements.contextUsageRing.hasAttribute("hidden"),
            false
          );
          assert.ok(elements.contextUsageRing.classList.contains("usage-low"));
          const fg = getFg();
          assert.ok(fg);
          const expected = `${0.1 * CIRCUMFERENCE} ${CIRCUMFERENCE}`;
          assert.strictEqual(fg.style.strokeDasharray, expected);
          const tooltip = getTooltip();
          assert.ok(tooltip.includes("100"));
          assert.ok(tooltip.includes("1000"));
          assert.ok(tooltip.includes("10.0%"));
        });

        test("applies correct tier at each threshold", () => {
          const cases: Array<{ ratio: number; tier: string }> = [
            { ratio: 0.59, tier: "usage-low" },
            { ratio: 0.6, tier: "usage-medium" },
            { ratio: 0.84, tier: "usage-medium" },
            { ratio: 0.85, tier: "usage-high" },
            { ratio: 0.99, tier: "usage-high" },
            { ratio: 1.0, tier: "usage-full" },
            { ratio: 1.5, tier: "usage-full" },
          ];
          for (const c of cases) {
            const used = Math.round(c.ratio * 1000);
            controller.handleMessage({
              type: "contextUsage",
              used,
              size: 1000,
              cost: null,
            });
            assert.strictEqual(
              elements.contextUsageRing.classList.contains(c.tier),
              true,
              `ratio ${c.ratio} should map to ${c.tier}`
            );
          }
        });

        test("null payload hides the ring", () => {
          controller.handleMessage({
            type: "contextUsage",
            used: 500,
            size: 1000,
            cost: null,
          });
          assert.strictEqual(
            elements.contextUsageRing.hasAttribute("hidden"),
            false
          );
          controller.handleMessage({
            type: "contextUsage",
            used: null,
            size: null,
            cost: null,
          });
          assert.strictEqual(
            elements.contextUsageRing.hasAttribute("hidden"),
            true
          );
          assert.strictEqual(
            elements.contextUsageRing.hasAttribute("acp-title"),
            false
          );
        });

        test("includes cost in tooltip when present", () => {
          controller.handleMessage({
            type: "contextUsage",
            used: 1000,
            size: 10000,
            cost: { amount: 0.0012, currency: "USD" },
          });
          const tooltip = getTooltip();
          assert.ok(tooltip.includes("Cost:"));
        });

        test("strokeDasharray is clamped to 100% for overage", () => {
          controller.handleMessage({
            type: "contextUsage",
            used: 2000,
            size: 1000,
            cost: null,
          });
          const fg = getFg();
          assert.ok(fg);
          const expected = `${CIRCUMFERENCE} ${CIRCUMFERENCE}`;
          assert.strictEqual(fg.style.strokeDasharray, expected);
        });
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

        controller.messageList.addMessage("Test", "user");
        controller.handleMessage({ type: "chatCleared" });

        // Messages should be cleared
        assert.strictEqual(elements.messagesEl.children.length, 0);
        // Mode dropdown should still be visible
        assert.strictEqual(elements.modeDropdown.style.display, "flex");
        // Commands should still be available
        const result =
          controller.inputPanel.autocomplete.getFilteredCommands("/");
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

      test("streamEnd clears stale running tool indicators", () => {
        controller.handleMessage({ type: "streamStart" });
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "tool-stale-running",
          name: "Editing files",
          kind: "edit",
        });

        assert.strictEqual(
          controller.getTools()["tool-stale-running"].status,
          "running"
        );

        controller.handleMessage({ type: "streamEnd" });

        const tools = controller.getTools();
        assert.strictEqual(tools["tool-stale-running"].status, "completed");
        assert.strictEqual(
          elements.messagesEl.querySelectorAll(".tool-status.running").length,
          0
        );
      });

      test("keeps multiple concurrent tool blocks expanded while running", () => {
        controller.handleMessage({ type: "streamStart" });

        // Start multiple tool calls concurrently
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "tool-1",
          name: "Read file",
          kind: "read",
        });
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "tool-2",
          name: "Search files",
          kind: "search",
        });
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "tool-3",
          name: "Run command",
          kind: "execute",
        });

        // All tool blocks should be expanded (have open attribute)
        const toolBlocks = elements.messagesEl.querySelectorAll(".tool-item");
        assert.strictEqual(toolBlocks.length, 3);
        assert.strictEqual(
          toolBlocks[0].getAttribute("open"),
          "",
          "First tool should be expanded"
        );
        assert.strictEqual(
          toolBlocks[1].getAttribute("open"),
          "",
          "Second tool should be expanded"
        );
        assert.strictEqual(
          toolBlocks[2].getAttribute("open"),
          "",
          "Third tool should be expanded"
        );

        // All should show running status
        const runningStatuses = elements.messagesEl.querySelectorAll(
          ".tool-status.running"
        );
        assert.strictEqual(
          runningStatuses.length,
          3,
          "All tools should show running status"
        );
      });

      test("explicit in_progress status keeps tool block expanded", () => {
        controller.handleMessage({ type: "streamStart" });

        // Start a tool and explicitly set in_progress status
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "tool-in-progress-1",
          name: "Read file",
          kind: "read",
          status: "in_progress",
        });

        // Start another tool to trigger finalizeActiveBlocksExcept
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "tool-in-progress-2",
          name: "Search",
          kind: "search",
        });

        // Both tools should be expanded
        const toolBlocks = elements.messagesEl.querySelectorAll(".tool-item");
        assert.strictEqual(toolBlocks.length, 2);
        assert.strictEqual(
          toolBlocks[0].getAttribute("open"),
          "",
          "Explicit in_progress tool should stay expanded"
        );
        assert.strictEqual(
          toolBlocks[1].getAttribute("open"),
          "",
          "Second tool should be expanded"
        );
      });

      test("completed non-special tool blocks are closed after completion", () => {
        controller.handleMessage({ type: "streamStart" });

        // Start a read tool (non-special type)
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "tool-read-1",
          name: "Read file",
          kind: "read",
        });

        // Tool should be expanded while running
        let toolBlock = elements.messagesEl.querySelector(".tool-item");
        assert.strictEqual(
          toolBlock?.getAttribute("open"),
          "",
          "Tool should be expanded while running"
        );

        // Complete the tool
        controller.handleMessage({
          type: "toolCallComplete",
          toolCallId: "tool-read-1",
          status: "completed",
          rawOutput: { output: "file content" },
        });

        // Non-special completed tool should be closed
        toolBlock = elements.messagesEl.querySelector(".tool-item");
        assert.strictEqual(
          toolBlock?.getAttribute("open"),
          null,
          "Completed read tool should be closed"
        );
      });

      test("completed edit/write/execute tool blocks stay expanded", () => {
        controller.handleMessage({ type: "streamStart" });

        // Start and complete an edit tool
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "tool-edit-1",
          name: "Edit file",
          kind: "edit",
        });
        controller.handleMessage({
          type: "toolCallComplete",
          toolCallId: "tool-edit-1",
          status: "completed",
        });

        // Start and complete a write tool
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "tool-write-1",
          name: "Write file",
          kind: "write",
        });
        controller.handleMessage({
          type: "toolCallComplete",
          toolCallId: "tool-write-1",
          status: "completed",
        });

        // Start and complete an execute tool
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "tool-exec-1",
          name: "Run command",
          kind: "execute",
        });
        controller.handleMessage({
          type: "toolCallComplete",
          toolCallId: "tool-exec-1",
          status: "completed",
        });

        // All special tools should stay expanded
        const toolBlocks = elements.messagesEl.querySelectorAll(".tool-item");
        assert.strictEqual(toolBlocks.length, 3);
        assert.strictEqual(
          toolBlocks[0].getAttribute("open"),
          "",
          "Edit tool should stay expanded"
        );
        assert.strictEqual(
          toolBlocks[1].getAttribute("open"),
          "",
          "Write tool should stay expanded"
        );
        assert.strictEqual(
          toolBlocks[2].getAttribute("open"),
          "",
          "Execute tool should stay expanded"
        );
      });

      test("failed tool blocks stay expanded regardless of type", () => {
        controller.handleMessage({ type: "streamStart" });

        // Start and fail a read tool
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "tool-fail-1",
          name: "Read file",
          kind: "read",
        });
        controller.handleMessage({
          type: "toolCallComplete",
          toolCallId: "tool-fail-1",
          status: "failed",
          rawOutput: { output: "Error: file not found" },
        });

        // Failed tool should stay expanded
        const toolBlock = elements.messagesEl.querySelector(".tool-item");
        assert.strictEqual(
          toolBlock?.getAttribute("open"),
          "",
          "Failed tool should stay expanded"
        );
        assert.ok(
          toolBlock?.classList.contains("tool-failed"),
          "Failed tool should have tool-failed class"
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

      test("merges text chunks from different sources into one block", () => {
        controller.handleMessage({ type: "streamStart" });
        controller.handleMessage({
          type: "streamChunk",
          text: "Alpha ",
        });
        controller.handleMessage({
          type: "streamChunk",
          text: "Beta ",
        });
        controller.handleMessage({
          type: "streamChunk",
          text: "one",
        });
        controller.handleMessage({
          type: "streamChunk",
          text: "two",
        });

        const blocks = elements.messagesEl.querySelectorAll(".block-text");
        assert.strictEqual(blocks.length, 1);
        assert.strictEqual(
          (blocks[0] as HTMLElement).dataset.rawContent,
          "Alpha Beta onetwo"
        );
      });

      test("closes thought when text starts regardless of source", () => {
        controller.handleMessage({ type: "streamStart" });
        controller.handleMessage({
          type: "thoughtChunk",
          text: "Planning ",
        });
        controller.handleMessage({
          type: "thoughtChunk",
          text: "Checking ",
        });
        controller.handleMessage({
          type: "thoughtChunk",
          text: "layout",
        });
        controller.handleMessage({
          type: "streamChunk",
          text: "Answer",
        });

        const thoughts = elements.messagesEl.querySelectorAll(".agent-thought");
        assert.strictEqual(thoughts.length, 1);
        assert.strictEqual(
          thoughts[0].querySelector(".thought-content")?.textContent?.trim(),
          "Planning Checking layout"
        );
        assert.strictEqual(thoughts[0].getAttribute("open"), null);
      });

      test("closes legacy thought when a new tool starts", () => {
        controller.handleMessage({ type: "streamStart" });
        controller.handleMessage({
          type: "thoughtChunk",
          text: "Checking before running a command.",
        });
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "legacy-tool",
          name: "Read file",
        });

        const thought = elements.messagesEl.querySelector(".agent-thought");
        assert.ok(thought);
        assert.strictEqual(thought.getAttribute("open"), null);
        assert.strictEqual(
          thought.querySelector(".thought-title")?.textContent,
          "Thought Process"
        );
      });

      test("keeps legacy thought active when an existing tool update arrives", () => {
        controller.handleMessage({ type: "streamStart" });
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "legacy-tool",
          name: "Read file",
        });
        controller.handleMessage({
          type: "thoughtChunk",
          text: "Checking the file ",
        });
        controller.handleMessage({
          type: "toolCallComplete",
          toolCallId: "legacy-tool",
          status: "completed",
          rawOutput: { output: "done" },
        });
        controller.handleMessage({
          type: "thoughtChunk",
          text: "before continuing.",
        });
        controller.handleMessage({ type: "streamEnd" });

        const thoughts = elements.messagesEl.querySelectorAll(".agent-thought");
        assert.strictEqual(thoughts.length, 1);
        assert.strictEqual(
          thoughts[0].querySelector(".thought-content")?.textContent?.trim(),
          "Checking the file before continuing."
        );
        assert.strictEqual(thoughts[0].getAttribute("open"), null);
        assert.strictEqual(
          thoughts[0].querySelector(".thought-title")?.textContent,
          "Thought Process"
        );
      });

      test("keeps legacy text active when an existing tool update arrives", () => {
        controller.handleMessage({ type: "streamStart" });
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "legacy-tool",
          name: "Read file",
        });
        controller.handleMessage({
          type: "streamChunk",
          text: "Final ",
        });
        controller.handleMessage({
          type: "toolCallComplete",
          toolCallId: "legacy-tool",
          status: "completed",
          rawOutput: { output: "done" },
        });
        controller.handleMessage({
          type: "streamChunk",
          text: "answer",
        });

        const textBlocks = elements.messagesEl.querySelectorAll(".block-text");
        assert.strictEqual(textBlocks.length, 1);
        assert.strictEqual(
          (textBlocks[0] as HTMLElement).dataset.rawContent,
          "Final answer"
        );
      });

      test("coalesces automatic bottom scrolling before settling over frames", () => {
        const { frames, runNextFrame, runAllFrames } =
          installAnimationFrameQueue();
        Object.defineProperty(elements.messagesEl, "scrollHeight", {
          configurable: true,
          value: 600,
        });

        controller.handleMessage({ type: "streamStart" });
        controller.handleMessage({ type: "streamChunk", text: "Hello " });
        controller.handleMessage({ type: "streamChunk", text: "World" });

        assert.strictEqual(frames.length, 1);
        assert.notStrictEqual(elements.messagesEl.scrollTop, 600);

        runNextFrame();

        assert.strictEqual(elements.messagesEl.scrollTop, 600);

        runAllFrames();

        assert.ok(elements.messagesEl.dataset.paintBump);
      });

      test("invalidates message paint on scroll events", () => {
        const { frames, runNextFrame } = installAnimationFrameQueue();
        Object.defineProperty(elements.messagesEl, "scrollHeight", {
          configurable: true,
          value: 1000,
        });
        Object.defineProperty(elements.messagesEl, "clientHeight", {
          configurable: true,
          value: 300,
        });
        elements.messagesEl.scrollTop = 200;

        elements.messagesEl.dispatchEvent(new window.Event("scroll"));

        assert.strictEqual(frames.length, 1);

        runNextFrame();

        assert.strictEqual(elements.messagesEl.dataset.paintBump, "1");
      });

      test("keeps bottom pin when content growth fires scroll before the next frame", () => {
        const { runAllFrames } = installAnimationFrameQueue();
        let scrollHeight = 1000;
        let scrollTop = 800;
        const clientHeight = 200;

        Object.defineProperty(elements.messagesEl, "scrollHeight", {
          configurable: true,
          get: () => scrollHeight,
        });
        Object.defineProperty(elements.messagesEl, "clientHeight", {
          configurable: true,
          get: () => clientHeight,
        });
        Object.defineProperty(elements.messagesEl, "scrollTop", {
          configurable: true,
          get: () => scrollTop,
          set: (value: number) => {
            scrollTop = value;
          },
        });

        elements.messagesEl.dispatchEvent(new window.Event("scroll"));

        scrollHeight = 2400;
        controller.handleMessage({ type: "streamChunk", text: "Large output" });

        elements.messagesEl.dispatchEvent(new window.Event("scroll"));
        runAllFrames();

        assert.strictEqual(scrollTop, 2400);
      });

      test("does not auto-scroll after the user wheels up from the bottom", () => {
        const { runAllFrames } = installAnimationFrameQueue();
        let scrollHeight = 1000;
        let scrollTop = 800;
        const clientHeight = 200;

        Object.defineProperty(elements.messagesEl, "scrollHeight", {
          configurable: true,
          get: () => scrollHeight,
        });
        Object.defineProperty(elements.messagesEl, "clientHeight", {
          configurable: true,
          get: () => clientHeight,
        });
        Object.defineProperty(elements.messagesEl, "scrollTop", {
          configurable: true,
          get: () => scrollTop,
          set: (value: number) => {
            scrollTop = value;
          },
        });

        elements.messagesEl.dispatchEvent(new window.Event("scroll"));
        elements.messagesEl.dispatchEvent(
          new window.WheelEvent("wheel", { deltaY: -120, bubbles: true })
        );
        scrollTop = 500;
        elements.messagesEl.dispatchEvent(new window.Event("scroll"));

        scrollHeight = 2400;
        controller.handleMessage({ type: "streamChunk", text: "More output" });
        runAllFrames();

        assert.strictEqual(scrollTop, 500);
      });

      test("does not auto-scroll after a pointer drag scrolls away from the bottom", () => {
        const { runAllFrames } = installAnimationFrameQueue();
        let scrollHeight = 1000;
        let scrollTop = 800;
        const clientHeight = 200;

        Object.defineProperty(elements.messagesEl, "scrollHeight", {
          configurable: true,
          get: () => scrollHeight,
        });
        Object.defineProperty(elements.messagesEl, "clientHeight", {
          configurable: true,
          get: () => clientHeight,
        });
        Object.defineProperty(elements.messagesEl, "scrollTop", {
          configurable: true,
          get: () => scrollTop,
          set: (value: number) => {
            scrollTop = value;
          },
        });

        elements.messagesEl.dispatchEvent(new window.Event("scroll"));
        elements.messagesEl.dispatchEvent(
          new window.Event("pointerdown", { bubbles: true })
        );
        scrollTop = 500;
        elements.messagesEl.dispatchEvent(new window.Event("scroll"));
        window.dispatchEvent(new window.Event("pointerup"));

        scrollHeight = 2400;
        controller.handleMessage({ type: "streamChunk", text: "More output" });
        runAllFrames();

        assert.strictEqual(scrollTop, 500);
      });

      test("does not auto-scroll after a touch gesture scrolls away from the bottom", () => {
        const { runAllFrames } = installAnimationFrameQueue();
        let scrollHeight = 1000;
        let scrollTop = 800;
        const clientHeight = 200;

        Object.defineProperty(elements.messagesEl, "scrollHeight", {
          configurable: true,
          get: () => scrollHeight,
        });
        Object.defineProperty(elements.messagesEl, "clientHeight", {
          configurable: true,
          get: () => clientHeight,
        });
        Object.defineProperty(elements.messagesEl, "scrollTop", {
          configurable: true,
          get: () => scrollTop,
          set: (value: number) => {
            scrollTop = value;
          },
        });

        elements.messagesEl.dispatchEvent(new window.Event("scroll"));
        elements.messagesEl.dispatchEvent(
          new window.Event("touchstart", { bubbles: true })
        );
        elements.messagesEl.dispatchEvent(
          new window.Event("touchmove", { bubbles: true })
        );
        scrollTop = 500;
        elements.messagesEl.dispatchEvent(new window.Event("scroll"));
        window.dispatchEvent(new window.Event("touchend"));

        scrollHeight = 2400;
        controller.handleMessage({ type: "streamChunk", text: "More output" });
        runAllFrames();

        assert.strictEqual(scrollTop, 500);
      });

      test("re-enables auto-scroll when a user message is added", () => {
        const { runAllFrames } = installAnimationFrameQueue();
        let scrollHeight = 1000;
        let scrollTop = 800;
        const clientHeight = 200;

        Object.defineProperty(elements.messagesEl, "scrollHeight", {
          configurable: true,
          get: () => scrollHeight,
        });
        Object.defineProperty(elements.messagesEl, "clientHeight", {
          configurable: true,
          get: () => clientHeight,
        });
        Object.defineProperty(elements.messagesEl, "scrollTop", {
          configurable: true,
          get: () => scrollTop,
          set: (value: number) => {
            scrollTop = value;
          },
        });

        elements.messagesEl.dispatchEvent(new window.Event("scroll"));
        elements.messagesEl.dispatchEvent(
          new window.WheelEvent("wheel", { deltaY: -120, bubbles: true })
        );
        scrollTop = 500;
        elements.messagesEl.dispatchEvent(new window.Event("scroll"));

        scrollHeight = 2400;
        controller.messageList.addMessage("Next question", "user");
        runAllFrames();

        assert.strictEqual(scrollTop, 2400);
      });

      test("ignores wheel intent from nested scrollable message content", () => {
        const { runAllFrames } = installAnimationFrameQueue();
        let scrollHeight = 1000;
        let scrollTop = 800;
        const clientHeight = 200;
        const nestedOutput = document.createElement("pre");
        nestedOutput.className = "tool-output";
        elements.messagesEl.appendChild(nestedOutput);

        Object.defineProperty(elements.messagesEl, "scrollHeight", {
          configurable: true,
          get: () => scrollHeight,
        });
        Object.defineProperty(elements.messagesEl, "clientHeight", {
          configurable: true,
          get: () => clientHeight,
        });
        Object.defineProperty(elements.messagesEl, "scrollTop", {
          configurable: true,
          get: () => scrollTop,
          set: (value: number) => {
            scrollTop = value;
          },
        });

        elements.messagesEl.dispatchEvent(new window.Event("scroll"));
        nestedOutput.dispatchEvent(
          new window.WheelEvent("wheel", { deltaY: -120, bubbles: true })
        );

        scrollHeight = 2400;
        controller.handleMessage({ type: "streamChunk", text: "More output" });
        elements.messagesEl.dispatchEvent(new window.Event("scroll"));
        runAllFrames();

        assert.strictEqual(scrollTop, 2400);
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

      test("Clicking a file:// link posts an openFile message to vscode", () => {
        controller.handleMessage({ type: "streamStart" });
        controller.handleMessage({
          type: "streamChunk",
          text: "Here is [filename](file:///home/fiyqkrc/Documents/project/vscode-acp/src/extension.ts#L10-L20) and [relative](src/extension.ts) and [external](https://github.com) and [anchor](#L10)",
        });
        controller.handleMessage({ type: "streamEnd" });

        const fileLink = elements.messagesEl.querySelector(
          'a[href^="file://"]'
        ) as HTMLAnchorElement;
        const relativeLink = elements.messagesEl.querySelector(
          'a[href="src/extension.ts"]'
        ) as HTMLAnchorElement;
        const externalLink = elements.messagesEl.querySelector(
          'a[href^="https://"]'
        ) as HTMLAnchorElement;
        const anchorLink = elements.messagesEl.querySelector(
          'a[href^="#"]'
        ) as HTMLAnchorElement;

        assert.ok(fileLink, "expected a file link");
        assert.ok(relativeLink, "expected a relative link");
        assert.ok(externalLink, "expected an external link");
        assert.ok(anchorLink, "expected an anchor link");

        // Test file:// link
        mockVsCode._clearMessages();
        fileLink.dispatchEvent(
          new dom.window.MouseEvent("click", {
            bubbles: true,
            cancelable: true,
          })
        );
        let messages = mockVsCode._getMessages();
        assert.strictEqual(messages.length, 1);
        assert.deepStrictEqual(messages[0], {
          type: "openFile",
          href: "file:///home/fiyqkrc/Documents/project/vscode-acp/src/extension.ts#L10-L20",
        });

        // Test relative path link
        mockVsCode._clearMessages();
        relativeLink.dispatchEvent(
          new dom.window.MouseEvent("click", {
            bubbles: true,
            cancelable: true,
          })
        );
        messages = mockVsCode._getMessages();
        assert.strictEqual(messages.length, 1);
        assert.deepStrictEqual(messages[0], {
          type: "openFile",
          href: "src/extension.ts",
        });

        // Test external link (should not post openFile message)
        mockVsCode._clearMessages();
        externalLink.dispatchEvent(
          new dom.window.MouseEvent("click", {
            bubbles: true,
            cancelable: true,
          })
        );
        messages = mockVsCode._getMessages();
        assert.strictEqual(messages.length, 0);

        // Test anchor link (should not post openFile message)
        mockVsCode._clearMessages();
        anchorLink.dispatchEvent(
          new dom.window.MouseEvent("click", {
            bubbles: true,
            cancelable: true,
          })
        );
        messages = mockVsCode._getMessages();
        assert.strictEqual(messages.length, 0);
      });

      test("Clicking a diff-header posts an openFile message with path and checkExists", () => {
        controller.handleMessage({
          type: "toolCallStart",
          toolCallId: "tool-diff-test",
          name: "write",
          kind: "write",
        });
        controller.handleMessage({
          type: "toolCallComplete",
          toolCallId: "tool-diff-test",
          status: "completed",
          title: "Write file",
          content: [
            {
              type: "diff",
              path: "/home/fiyqkrc/Documents/project/vscode-acp/src/extension.ts",
              oldText: "old content",
              newText: "new content",
            },
          ],
        });

        const diffHeader = elements.messagesEl.querySelector(
          ".diff-header"
        ) as HTMLElement;
        assert.ok(diffHeader, "expected a diff-header");

        mockVsCode._clearMessages();
        diffHeader.dispatchEvent(
          new dom.window.MouseEvent("click", {
            bubbles: true,
            cancelable: true,
          })
        );
        const messages = mockVsCode._getMessages();
        assert.strictEqual(messages.length, 1);
        assert.deepStrictEqual(messages[0], {
          type: "openFile",
          path: "/home/fiyqkrc/Documents/project/vscode-acp/src/extension.ts",
          checkExists: true,
        });
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
        const commandChip = controller.chipRenderer.renderCommandChip(
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
        assert.strictEqual(commandChip.textContent?.startsWith("/"), true);
        assert.strictEqual(commandChip.querySelector(".chip-icon"), null);
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
       * Helper that calls the inputPanel.handlePaste method with a mock event object.
       * The mock clipboardData matches the shape the handler expects.
       */
      function simulatePaste(clipboardData: {
        items: Array<{ type: string; getAsFile?: () => File | null }>;
        getData: (type: string) => string;
      }): void {
        controller.inputPanel.handlePaste(
          {
            clipboardData,
            preventDefault: () => {},
          },
          (file) =>
            controller.inputPanel.handleImageAttachment(file, (mention) =>
              controller.inputPanel.insertMentionChip(mention)
            )
        );
        controller.inputPanel.updateInputState();
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
        const originalInsertMentionChip =
          controller.inputPanel.insertMentionChip.bind(controller.inputPanel);
        let imageInserted = false;
        controller.inputPanel.insertMentionChip = function (mention: Mention) {
          if (mention.type === "image") {
            imageInserted = true;
          }
          return originalInsertMentionChip(mention);
        };

        simulatePaste({
          items: [{ type: "image/png", getAsFile: () => fakeFile }],
          getData: () => "",
        });

        // Restore original method
        controller.inputPanel.insertMentionChip = originalInsertMentionChip;

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
        const result =
          controller.inputPanel.autocomplete.getFilteredCommands("hello");
        assert.deepStrictEqual(result, []);
      });

      test("getFilteredCommands returns empty for plain slash", () => {
        controller.handleMessage({
          type: "availableCommands",
          commands: testCommands,
        });
        const result =
          controller.inputPanel.autocomplete.getFilteredCommands("/");
        assert.strictEqual(result.length, 3);
      });

      test("getFilteredCommands filters by prefix", () => {
        controller.handleMessage({
          type: "availableCommands",
          commands: testCommands,
        });
        const result =
          controller.inputPanel.autocomplete.getFilteredCommands("/he");
        assert.strictEqual(result.length, 1);
        assert.ok(result.some((c) => c.name === "help"));
      });

      test("getFilteredCommands filters by description", () => {
        controller.handleMessage({
          type: "availableCommands",
          commands: testCommands,
        });
        const result =
          controller.inputPanel.autocomplete.getFilteredCommands("/chat");
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

        controller.inputPanel.autocomplete.hide();
        assert.ok(!elements.commandAutocomplete.classList.contains("visible"));
        assert.strictEqual(elements.commandAutocomplete.innerHTML, "");
      });

      test("command autocomplete items render without command icon", () => {
        const html = controller.inputPanel.autocomplete.renderCommandItem(
          testCommands[0],
          0
        );
        const wrapper = document.createElement("div");
        wrapper.innerHTML = html;
        const item = wrapper.querySelector(".command-item");

        assert.ok(item, "Command item should be rendered");
        assert.strictEqual(item.querySelector(".command-icon"), null);
        assert.strictEqual(
          item.querySelector(".trigger-char")?.textContent,
          "/"
        );
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
        const result =
          controller.inputPanel.autocomplete.getFilteredCommands("/");
        assert.strictEqual(result.length, 3);
      });

      test("sessionMetadata with commands updates commands", () => {
        controller.handleMessage({
          type: "sessionMetadata",
          commands: testCommands,
          modes: null,
          models: null,
        });
        const result =
          controller.inputPanel.autocomplete.getFilteredCommands("/");
        assert.strictEqual(result.length, 3);
      });

      test("chatCleared does not clear commands", () => {
        controller.handleMessage({
          type: "availableCommands",
          commands: testCommands,
        });
        controller.handleMessage({ type: "chatCleared" });
        const result =
          controller.inputPanel.autocomplete.getFilteredCommands("/");
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

    suite("file autocomplete", () => {
      test("replaces the @ query with the selected file chip", () => {
        mockVsCode._clearMessages();

        const queryNode = document.createTextNode("@auto");
        elements.inputEl.appendChild(queryNode);

        const range = document.createRange();
        range.setStart(queryNode, queryNode.length);
        range.collapse(true);

        const selection = window.getSelection();
        assert.ok(selection);
        selection.removeAllRanges();
        selection.addRange(range);

        elements.inputEl.dispatchEvent(new window.Event("input"));

        assert.deepStrictEqual(mockVsCode._getMessages(), [
          { type: "searchFiles", text: "auto" },
        ]);

        controller.handleMessage({
          type: "fileSearchResults",
          results: [
            {
              name: "autocomplete.ts",
              path: "src/views/webview/component/autocomplete.ts",
              dir: "src/views/webview/component",
              type: "file",
              fsPath: "/repo/src/views/webview/component/autocomplete.ts",
            },
          ],
        });

        assert.ok(
          elements.commandAutocomplete.classList.contains("visible"),
          "file autocomplete should be visible"
        );

        elements.inputEl.dispatchEvent(
          new window.KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          })
        );

        const chip = elements.inputEl.querySelector(
          ".mention-chip"
        ) as HTMLElement | null;
        assert.ok(chip, "selected file should be inserted as a chip");
        assert.strictEqual(chip.dataset.name, "autocomplete.ts");
        assert.strictEqual(
          chip.dataset.path,
          "/repo/src/views/webview/component/autocomplete.ts"
        );
        assert.strictEqual(elements.inputEl.textContent, "autocomplete.ts ");
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
        controller.auxiliaryPanels.showPlan(testPlan.entries);
        const planEl =
          elements.planContainer.querySelector(".agent-plan-sticky");
        assert.ok(planEl);
      });

      test("showPlan displays all entries", () => {
        controller.auxiliaryPanels.showPlan(testPlan.entries);
        const entries = elements.planContainer.querySelectorAll(".plan-entry");
        assert.strictEqual(entries.length, 3);
      });

      test("showPlan shows progress count", () => {
        controller.auxiliaryPanels.showPlan(testPlan.entries);
        const progress = elements.planContainer.querySelector(".plan-counter");
        assert.ok(progress);
        assert.strictEqual(progress?.textContent, "1/3");
      });

      test("showPlan applies status classes", () => {
        controller.auxiliaryPanels.showPlan(testPlan.entries);
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
        controller.auxiliaryPanels.showPlan(testPlan.entries);
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
        controller.auxiliaryPanels.showPlan(testPlan.entries);
        const planEntries =
          elements.planContainer.querySelector(".plan-entries");
        assert.ok(planEntries?.classList.contains("collapsed"));
      });

      test("showPlan header is clickable", () => {
        controller.auxiliaryPanels.showPlan(testPlan.entries);
        const header = elements.planContainer.querySelector(".plan-header");
        assert.ok(header);
        // Verify it has the collapsed state initially
        const toggleIcon = header?.querySelector(".plan-toggle-icon");
        assert.ok(toggleIcon?.classList.contains("collapsed"));
      });

      test("plan header click toggles expand/collapse", () => {
        controller.auxiliaryPanels.showPlan(testPlan.entries);
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
        controller.auxiliaryPanels.showPlan(testPlan.entries);
        controller.auxiliaryPanels.hidePlan();
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
        controller.auxiliaryPanels.showPlan(testPlan.entries);
        controller.auxiliaryPanels.showPlan([]);
        const planEl =
          elements.planContainer.querySelector(".agent-plan-sticky");
        assert.strictEqual(planEl, null);
      });
    });

    suite("generic config options dropdown", () => {
      const thoughtLevel = {
        id: "thought_level",
        name: "Thought Level",
        category: "thought_level",
        currentValue: "medium",
        options: [
          { value: "off", name: "Off" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
        ],
      };
      const otherOption = {
        id: "custom_knob",
        name: "Custom Knob",
        category: null,
        currentValue: "a",
        options: [
          { value: "a", name: "A" },
          { value: "b", name: "B" },
        ],
      };

      test("renders one dropdown per generic config option", () => {
        controller.handleMessage({
          type: "sessionMetadata",
          modes: null,
          models: null,
          genericConfigOptions: [thoughtLevel, otherOption],
        });

        const wrappers =
          elements.configOptionsContainer.querySelectorAll(".custom-dropdown");
        assert.strictEqual(wrappers.length, 2);
        assert.ok(
          elements.configOptionsContainer.querySelector(
            '[data-config-id="thought_level"]'
          )
        );
        assert.ok(
          elements.configOptionsContainer.querySelector(
            '[data-config-id="custom_knob"]'
          )
        );
      });

      test("thought_level option gets lightbulb icon, others do not", () => {
        controller.handleMessage({
          type: "sessionMetadata",
          modes: null,
          models: null,
          genericConfigOptions: [thoughtLevel, otherOption],
        });

        const thoughtWrapper =
          elements.configOptionsContainer.querySelector<HTMLElement>(
            '[data-config-id="thought_level"]'
          )!;
        const customWrapper =
          elements.configOptionsContainer.querySelector<HTMLElement>(
            '[data-config-id="custom_knob"]'
          )!;
        assert.ok(
          thoughtWrapper.querySelector(".codicon-lightbulb"),
          "thought_level should have a lightbulb icon"
        );
        assert.strictEqual(
          customWrapper.querySelector(".dropdown-icon"),
          null,
          "non-thought_level options should not have an icon"
        );
      });

      test("uses option.name as the selected label", () => {
        controller.handleMessage({
          type: "sessionMetadata",
          modes: null,
          models: null,
          genericConfigOptions: [thoughtLevel],
        });

        const label = elements.configOptionsContainer
          .querySelector('[data-config-id="thought_level"]')
          ?.querySelector(".selected-label");
        assert.strictEqual(label?.textContent, "Medium");
      });

      test("sets acp-title to generic config option name and description", () => {
        controller.handleMessage({
          type: "sessionMetadata",
          modes: null,
          models: null,
          genericConfigOptions: [
            {
              ...thoughtLevel,
              description: "Controls the thinking budget",
            },
          ],
        });

        const label = elements.configOptionsContainer
          .querySelector('[data-config-id="thought_level"]')
          ?.querySelector(".selected-label");
        assert.strictEqual(
          label?.getAttribute("acp-title"),
          "Thought Level\nControls the thinking budget"
        );
      });

      test("sets acp-title to generic config option name only if description is absent", () => {
        controller.handleMessage({
          type: "sessionMetadata",
          modes: null,
          models: null,
          genericConfigOptions: [
            {
              ...thoughtLevel,
              description: undefined,
            },
          ],
        });

        const label = elements.configOptionsContainer
          .querySelector('[data-config-id="thought_level"]')
          ?.querySelector(".selected-label");
        assert.strictEqual(label?.getAttribute("acp-title"), "Thought Level");
      });

      test("selecting a value posts selectConfigOption with configId and value", () => {
        controller.handleMessage({
          type: "sessionMetadata",
          modes: null,
          models: null,
          genericConfigOptions: [thoughtLevel],
        });

        const wrapper =
          elements.configOptionsContainer.querySelector<HTMLElement>(
            '[data-config-id="thought_level"]'
          )!;
        wrapper
          .querySelector(".dropdown-trigger")
          ?.dispatchEvent(new window.MouseEvent("click"));
        const popover = wrapper.querySelector(".dropdown-popover")!;
        const items = popover.querySelectorAll(".dropdown-item");
        assert.ok(items.length >= 3);
        const last = items[items.length - 1] as HTMLElement;
        last.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

        const messages = mockVsCode._getMessages();
        const select = messages.find(
          (m): m is { type: string; configId: string; value: string } =>
            typeof m === "object" &&
            m !== null &&
            (m as { type?: unknown }).type === "selectConfigOption"
        );
        assert.ok(select, "expected a selectConfigOption postMessage");
        assert.strictEqual(select!.configId, "thought_level");
        assert.strictEqual(select!.value, "high");
      });

      test("removes dropdown when option no longer present", () => {
        controller.handleMessage({
          type: "sessionMetadata",
          modes: null,
          models: null,
          genericConfigOptions: [thoughtLevel],
        });
        assert.ok(
          elements.configOptionsContainer.querySelector(
            '[data-config-id="thought_level"]'
          )
        );

        controller.handleMessage({
          type: "sessionMetadata",
          modes: null,
          models: null,
          genericConfigOptions: [],
        });
        assert.strictEqual(
          elements.configOptionsContainer.querySelector(
            '[data-config-id="thought_level"]'
          ),
          null
        );
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
        const parentEl = controller.messageList.ensureAssistantMessage();
        const block = controller.messageList
          .getBlockManager()
          .ensureBlock("thought", parentEl, elements.typingIndicatorEl);
        block.appendContent("Thinking about this...");
        const thoughtEl = elements.messagesEl.querySelector(
          "details.agent-thought"
        );
        assert.ok(thoughtEl);
        assert.strictEqual(thoughtEl?.getAttribute("open"), "");
      });

      test("appendThought includes ARIA accessibility attributes", () => {
        const parentEl = controller.messageList.ensureAssistantMessage();
        const block = controller.messageList
          .getBlockManager()
          .ensureBlock("thought", parentEl, elements.typingIndicatorEl);
        block.appendContent("Thinking...");
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
        const parentEl = controller.messageList.ensureAssistantMessage();
        const block = controller.messageList
          .getBlockManager()
          .ensureBlock("thought", parentEl, elements.typingIndicatorEl);
        block.appendContent("Some thought");
        const activeBlock = controller.messageList
          .getBlockManager()
          .getActiveBlock();
        if (activeBlock && activeBlock.blockType === "thought") {
          controller.messageList.getBlockManager().finalizeBlock(activeBlock);
          controller.messageList.getBlockManager().clearActiveBlock();
        }
        const thoughtEl = elements.messagesEl.querySelector(".agent-thought");
        assert.ok(thoughtEl);
        assert.strictEqual(thoughtEl?.getAttribute("open"), null);
      });

      test("streamStart starts new assistant message", () => {
        const parentEl = controller.messageList.ensureAssistantMessage();
        const block = controller.messageList
          .getBlockManager()
          .ensureBlock("thought", parentEl, elements.typingIndicatorEl);
        block.appendContent("Old thought");
        controller.handleMessage({ type: "streamStart" });
        // Old thought stays in previous message
        const thoughtEl = elements.messagesEl.querySelector(".agent-thought");
        assert.ok(thoughtEl);
      });

      test("streamEnd finalizes thought", () => {
        const parentEl = controller.messageList.ensureAssistantMessage();
        const block = controller.messageList
          .getBlockManager()
          .ensureBlock("thought", parentEl, elements.typingIndicatorEl);
        block.appendContent("Thinking...");
        controller.handleMessage({ type: "streamEnd" });
        const thoughtEl = elements.messagesEl.querySelector(".agent-thought");
        assert.ok(thoughtEl);
        assert.strictEqual(thoughtEl?.getAttribute("open"), null);
      });

      test("chatCleared removes thought", () => {
        const parentEl = controller.messageList.ensureAssistantMessage();
        const block = controller.messageList
          .getBlockManager()
          .ensureBlock("thought", parentEl, elements.typingIndicatorEl);
        block.appendContent("Some thought");
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
          document,
          window as unknown as Window
        );
        assert.strictEqual(elements.inputEl.textContent, "saved text");
      });

      test("restores connection state from state", () => {
        mockVsCode.setState({ isConnected: true, inputValue: "" });
        const restoredController = new WebviewController(
          mockVsCode,
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

    test("returns false for plain plus-bracket text", () => {
      assert.strictEqual(hasAnsiCodes("array +[value]"), false);
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

    test("returns true for plus-bracket ANSI codes", () => {
      assert.strictEqual(hasAnsiCodes("+[31mred+[0m"), true);
    });

    test("returns true for plus-bracket bold ANSI code", () => {
      assert.strictEqual(hasAnsiCodes("+[1mbold+[0m"), true);
    });

    test("returns true for terminal cursor and erase control codes", () => {
      assert.strictEqual(hasAnsiCodes("\x1b[2K\x1b[1Gready"), true);
    });
  });

  suite("ansiToHtml", () => {
    test("returns plain text unchanged", () => {
      assert.strictEqual(ansiToHtml("hello world"), "hello world");
    });

    test("escapes HTML in plain text", () => {
      assert.strictEqual(ansiToHtml("<script>"), "&lt;script&gt;");
    });

    test("preserves plain plus-bracket text", () => {
      assert.strictEqual(ansiToHtml("array +[value]"), "array +[value]");
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

    test("converts plus-bracket red foreground color", () => {
      const result = ansiToHtml("+[31mred text+[0m");
      assert.ok(result.includes('class="ansi-red"'));
      assert.ok(result.includes("red text"));
    });

    test("converts plus-bracket green foreground color", () => {
      const result = ansiToHtml("+[32mgreen+[0m");
      assert.ok(result.includes('class="ansi-green"'));
    });

    test("converts plus-bracket bold style", () => {
      const result = ansiToHtml("+[1mbold+[0m");
      assert.ok(result.includes('class="ansi-bold"'));
      assert.ok(result.includes("bold"));
    });

    test("normalizes vitest-style terminal control sequences", () => {
      const result = ansiToHtml(
        [
          "\x1b[?25l\x1b[36m DEV \x1b[39m /repo",
          "\x1b[2K\x1b[1G\x1b[31m> src/test/webview.test.ts\x1b[39m (0 test)",
          "progress 10%\rprogress 100%",
          "\x1b[?25h",
        ].join("\n")
      );

      assert.ok(result.includes('class="ansi-cyan"'));
      assert.ok(result.includes(" DEV "));
      assert.ok(result.includes('class="ansi-red"'));
      assert.ok(result.includes("&gt; src/test/webview.test.ts"));
      assert.ok(result.includes("progress 100%"));
      assert.ok(!result.includes("progress 10%"));
      assert.ok(!result.includes("[2K"));
      assert.ok(!result.includes("[1G"));
      assert.ok(!result.includes("?25"));
      assert.ok(!result.includes("\x1b"));
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

    test("renders terminal output with non-color control codes safely", () => {
      const html = renderToolDetails({
        toolCallId: "tool-1",
        title: "test",
        kind: "execute",
        status: "completed",
        terminalOutput: "\x1b[2K\x1b[1Gdone",
      });

      assert.ok(html.includes('class="tool-output terminal"'));
      assert.ok(html.includes("done"));
      assert.ok(!html.includes("[2K"));
      assert.ok(!html.includes("[1G"));
      assert.ok(!html.includes("\x1b"));
    });
  });

  suite("tool output typography CSS", () => {
    test("keeps terminal output on the monospace command-output font stack", () => {
      const css = fs.readFileSync(
        path.resolve(process.cwd(), "media", "main.css"),
        "utf8"
      );
      const dom = new JSDOM(
        `<!DOCTYPE html><style>${css}</style><pre class="tool-output terminal">abc</pre>`
      );
      const output = dom.window.document.querySelector(".tool-output.terminal");
      assert.ok(output);

      const fontFamily = dom.window.getComputedStyle(output).fontFamily;
      assert.ok(fontFamily.includes("--vscode-editor-font-family"));
      assert.ok(fontFamily.includes("monospace"));
    });

    test("keeps input chips vertically aligned with text", () => {
      const css = fs.readFileSync(
        path.resolve(process.cwd(), "media", "main.css"),
        "utf8"
      );
      const dom = new JSDOM(
        `<!DOCTYPE html><style>${css}</style><div id="input">hello <span class="mention-chip">file.ts</span> <span class="command-chip">/build</span></div>`
      );
      const chips = dom.window.document.querySelectorAll(
        ".mention-chip, .command-chip"
      );
      assert.strictEqual(chips.length, 2);

      chips.forEach((chip) => {
        const style = dom.window.getComputedStyle(chip);
        assert.strictEqual(style.lineHeight, "1.2");
        assert.strictEqual(style.verticalAlign, "middle");
        assert.strictEqual(style.top, "0px");
      });
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

    test("execute tool prefers intent (description) over locations path in summary", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "bash",
        kind: "execute",
        status: "completed",
        locations: [{ path: "/home/user/project" }],
        rawInput: {
          command: "cd /home/user/project && git status",
          description: "Check git status and recent commits",
        },
      });
      assert.ok(html.includes("Check git status and recent commits"));
      assert.ok(!html.includes("/home/user/project"));
    });

    test("execute tool prefers intent over command when no locations", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "bash",
        kind: "execute",
        status: "completed",
        rawInput: {
          command: "npm test --coverage",
          description: "Run tests with coverage",
        },
      });
      assert.ok(html.includes("Run tests with coverage"));
      assert.ok(!html.includes("npm test --coverage"));
    });

    test("execute tool falls back to command when no intent", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "bash",
        kind: "execute",
        status: "completed",
        rawInput: { command: "npm test" },
      });
      assert.ok(html.includes("npm test"));
    });

    test("execute tool falls back to locations path when no intent or command", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "bash",
        kind: "execute",
        status: "completed",
        locations: [{ path: "/home/user/project" }],
      });
      assert.ok(html.includes("/home/user/project"));
    });

    test("does not render kind icon when kind is undefined", () => {
      const html = renderToolSummary({
        toolCallId: "tool-1",
        title: "unknown_tool",
        status: "in_progress",
      });
      // No specific tool-kind-icon when kind is undefined; spinner is managed in DOM
      assert.ok(!html.includes("tool-kind-icon"));
      assert.ok(html.includes("unknown_tool"));
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

    test("restores diff changes from persisted state", () => {
      const changes = [
        {
          path: "/test/file1.ts",
          relativePath: "file1.ts",
          oldText: "old",
          newText: "new",
          status: "pending",
        },
      ];
      const dom = new JSDOM(createWebviewHTML(), {
        runScripts: "dangerously",
        url: "https://localhost",
      });
      const doc = dom.window.document;
      const win = dom.window;
      const mockVsCode = createMockVsCodeApi();
      (global as any).Node = win.Node;
      (global as any).NodeFilter = win.NodeFilter;

      mockVsCode.setState({
        isConnected: false,
        inputValue: "",
        diffChanges: changes,
      });

      const elements = getElements(doc);
      new WebviewController(mockVsCode, doc, win as unknown as Window);

      assert.strictEqual(elements.diffSummaryContainer.style.display, "block");
      assert.ok(
        elements.diffSummaryContainer.innerHTML.includes("1 files modified")
      );
      dom.window.close();
    });
  });

  suite("StatePersistenceService", () => {
    test("update() before restore() preserves existing state", () => {
      const mockVsCode = createMockVsCodeApi();
      mockVsCode.setState({ isConnected: true, inputValue: "hello" });

      const service = new StatePersistenceService(mockVsCode);

      // Call update() before restore() — should not clobber isConnected
      service.update("inputValue", "world");

      const state = service.restore();
      assert.strictEqual(state?.isConnected, true);
      assert.strictEqual(state?.inputValue, "world");
    });

    test("update() merges into restored state", () => {
      const mockVsCode = createMockVsCodeApi();
      mockVsCode.setState({
        isConnected: true,
        inputValue: "hello",
        diffChanges: [
          {
            path: "/a.ts",
            relativePath: "a.ts",
            oldText: null,
            newText: "x",
            status: "pending",
          },
        ],
      });

      const service = new StatePersistenceService(mockVsCode);
      service.restore(); // populate cache

      service.update("inputValue", "updated");

      const state = service.restore();
      assert.strictEqual(state?.isConnected, true);
      assert.strictEqual(state?.inputValue, "updated");
      assert.strictEqual(state?.diffChanges?.length, 1);
    });

    test("restore() is memoized", () => {
      const mockVsCode = createMockVsCodeApi();
      mockVsCode.setState({ isConnected: false, inputValue: "cached" });

      const service = new StatePersistenceService(mockVsCode);
      const first = service.restore();
      // Mutate the underlying store — second call should still return cached
      mockVsCode.setState({ isConnected: true, inputValue: "changed" });
      const second = service.restore();

      assert.strictEqual(first, second);
      assert.strictEqual(second?.inputValue, "cached");
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

    test("handles small change in large file correctly", () => {
      const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
      const oldText = lines.join("\n");
      const newLines = [...lines];
      newLines[100] = "MODIFIED";
      const newText = newLines.join("\n");

      const result = computeLineDiff(oldText, newText);
      const removes = result.filter((r) => r.type === "remove");
      const adds = result.filter((r) => r.type === "add");
      const context = result.filter((r) => r.type === "context");

      assert.strictEqual(result.length, 201, "should have 201 total lines");
      assert.strictEqual(removes.length, 1, "should have exactly 1 removal");
      assert.strictEqual(removes[0].line, "line 100");
      assert.strictEqual(adds.length, 1, "should have exactly 1 addition");
      assert.strictEqual(adds[0].line, "MODIFIED");
      assert.strictEqual(context.length, 199, "should have 199 context lines");
    });

    test("handles duplicate lines in input", () => {
      const result = computeLineDiff("a\na\na", "a\na");
      const removes = result.filter((r) => r.type === "remove");
      const adds = result.filter((r) => r.type === "add");
      const context = result.filter((r) => r.type === "context");

      assert.strictEqual(removes.length, 1, "should remove only 1 duplicate");
      assert.strictEqual(adds.length, 0, "no additions");
      assert.strictEqual(context.length, 2, "should keep 2 as context");
    });

    test("handles duplicate lines with mid-file change", () => {
      const oldText = "a\nb\na\nb\na";
      const newText = "a\nb\nMODIFIED\nb\na";
      const result = computeLineDiff(oldText, newText);
      const removes = result.filter((r) => r.type === "remove");
      const adds = result.filter((r) => r.type === "add");
      const context = result.filter((r) => r.type === "context");

      assert.strictEqual(removes.length, 1);
      assert.strictEqual(removes[0].line, "a");
      assert.strictEqual(adds.length, 1);
      assert.strictEqual(adds[0].line, "MODIFIED");
      assert.strictEqual(
        context.length,
        4,
        "should keep surrounding lines as context"
      );
    });

    test("handles insertion at beginning of large file", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
      const oldText = lines.join("\n");
      const newText = "INSERTED\n" + lines.join("\n");

      const result = computeLineDiff(oldText, newText);
      const adds = result.filter((r) => r.type === "add");
      const removes = result.filter((r) => r.type === "remove");

      assert.strictEqual(adds.length, 1, "should have 1 addition");
      assert.strictEqual(adds[0].line, "INSERTED");
      assert.strictEqual(removes.length, 0, "should have 0 removals");
    });

    test("handles multiple scattered changes in large file", () => {
      const lines = Array.from({ length: 150 }, (_, i) => `line ${i}`);
      const oldText = lines.join("\n");
      const newLines = [...lines];
      newLines[10] = "CHANGED_10";
      newLines[50] = "CHANGED_50";
      newLines[120] = "CHANGED_120";
      const newText = newLines.join("\n");

      const result = computeLineDiff(oldText, newText);
      const removes = result.filter((r) => r.type === "remove");
      const adds = result.filter((r) => r.type === "add");

      assert.strictEqual(removes.length, 3, "should have 3 removals");
      assert.strictEqual(adds.length, 3, "should have 3 additions");
    });

    test("handles append at end of large file", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
      const oldText = lines.join("\n");
      const newText = lines.join("\n") + "\nAPPENDED";

      const result = computeLineDiff(oldText, newText);
      const adds = result.filter((r) => r.type === "add");
      const removes = result.filter((r) => r.type === "remove");

      assert.strictEqual(adds.length, 1, "should have 1 addition");
      assert.strictEqual(adds[0].line, "APPENDED");
      assert.strictEqual(removes.length, 0, "should have 0 removals");
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
      assert.ok(result.includes('data-file-path="/path/to/file.ts"'));
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

    test("renders change lines with prefixes", () => {
      const result = renderDiff(undefined, "old line", "new line");
      assert.ok(result.includes('class="diff-line-prefix">-</span>'));
      assert.ok(result.includes('class="diff-line-prefix">+</span>'));
      assert.ok(!result.includes("diff-hunk-header"));
    });

    test("renders multiple hunks with separator only when gaps exist", () => {
      const oldText = ["match1", ...Array(20).fill("context"), "match2"].join(
        "\n"
      );
      const newText = ["mod1", ...Array(20).fill("context"), "mod2"].join("\n");
      const result = renderDiff(undefined, oldText, newText);
      const separators = result.match(/class="diff-hunk-separator"/g);
      assert.ok(separators);
      assert.ok(separators.length >= 1);
      assert.ok(!result.includes("diff-hunk-header"));
    });

    test("no separator between adjacent hunks", () => {
      const oldText = "line1\nline2\nline3";
      const newText = "mod1\nmod2\nmod3";
      const result = renderDiff(undefined, oldText, newText);
      assert.ok(!result.includes("diff-hunk-separator"));
    });

    test("renders change block without clickability or data attributes", () => {
      const result = renderDiff("/test/file.ts", "old line", "new line");
      assert.ok(!result.includes("diff-clickable"));
      assert.ok(!result.includes("data-diff-path"));
      assert.ok(!result.includes("data-diff-start"));
      assert.ok(!result.includes("data-diff-end"));
      assert.ok(result.includes("diff-change-block"));
    });
  });
});
