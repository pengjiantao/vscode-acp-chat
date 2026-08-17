import * as assert from "assert";
import { JSDOM } from "jsdom";
import { TabBarComponent } from "../views/webview/component/tab-bar";
import { EventBus } from "../views/webview/event-bus";
import { MessageRouter } from "../views/webview/message-router";
import { StatePersistenceService } from "../views/webview/state-persistence";
import { SessionStore } from "../views/webview/session-store";
import type { WebviewContext } from "../views/webview/context";
import type {
  WebviewEventMap,
  SessionTab,
  VsCodeApi,
  ExtensionMessage,
} from "../views/webview/types";

suite("TabBarComponent Test Suite", () => {
  let dom: JSDOM;
  let doc: Document;
  let win: Window;
  let ctx: WebviewContext;

  setup(() => {
    dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
    doc = dom.window.document;
    win = dom.window as unknown as Window;

    const vscode: VsCodeApi = {
      postMessage: () => {},
      getState: () => undefined,
      setState: (s) => s,
    };

    ctx = {
      vscode,
      doc,
      win,
      stateService: new StatePersistenceService(vscode),
      messageRouter: new MessageRouter(),
      eventBus: new EventBus<WebviewEventMap>(),
      sessionStore: new SessionStore(),
    };
  });

  test("renders tabs and marks active tab without agent badge in title", () => {
    const tabs: SessionTab[] = [
      {
        sessionId: "s1",
        agentId: "gemini",
        agentName: "Gemini",
        title: "Tab 1",
      },
      {
        sessionId: "s2",
        agentId: "claude",
        agentName: "Claude",
        title: "Tab 2",
      },
    ];

    const tabBar = new TabBarComponent(ctx, {});
    tabBar.setSessions(tabs, "s1");

    const tabElements = tabBar.containerEl.querySelectorAll(".tab-item");
    assert.strictEqual(tabElements.length, 2);
    assert.ok(tabElements[0].classList.contains("active"));
    assert.ok(!tabElements[1].classList.contains("active"));
    assert.ok(tabElements[0].textContent?.includes("Tab 1"));
    assert.strictEqual(tabElements[0].querySelector(".tab-agent-badge"), null);
    assert.strictEqual(
      tabElements[0].getAttribute("acp-title"),
      "Gemini: Tab 1"
    );
    assert.strictEqual(
      tabElements[1].getAttribute("acp-title"),
      "Claude: Tab 2"
    );
  });

  test("clicking tab calls onTabSelect", () => {
    let selected = "";
    const tabs: SessionTab[] = [
      {
        sessionId: "s1",
        agentId: "gemini",
        agentName: "Gemini",
        title: "Tab 1",
      },
      {
        sessionId: "s2",
        agentId: "claude",
        agentName: "Claude",
        title: "Tab 2",
      },
    ];

    const tabBar = new TabBarComponent(ctx, {
      onTabSelect: (sessionId) => {
        selected = sessionId;
      },
    });
    tabBar.setSessions(tabs, "s1");

    const tabElements =
      tabBar.containerEl.querySelectorAll<HTMLElement>(".tab-item");
    tabElements[1].click();

    assert.strictEqual(selected, "s2");
  });

  test("clicking close button calls onTabClose", () => {
    let closed = "";
    const tabs: SessionTab[] = [
      {
        sessionId: "s1",
        agentId: "gemini",
        agentName: "Gemini",
        title: "Tab 1",
      },
    ];

    const tabBar = new TabBarComponent(ctx, {
      onTabClose: (sessionId) => {
        closed = sessionId;
      },
    });
    tabBar.setSessions(tabs, "s1");

    const closeBtn =
      tabBar.containerEl.querySelector<HTMLElement>(".tab-close");
    assert.ok(closeBtn);
    closeBtn.click();

    assert.strictEqual(closed, "s1");
  });

  test("hides more button by default when not overflowing", () => {
    const tabs: SessionTab[] = [
      {
        sessionId: "s1",
        agentId: "gemini",
        agentName: "Gemini",
        title: "Tab 1",
      },
    ];

    const tabBar = new TabBarComponent(ctx, {});
    tabBar.setSessions(tabs, "s1");

    assert.strictEqual(tabBar.actionsContainer.style.display, "none");
    assert.strictEqual(tabBar.moreContainer.style.display, "none");
  });

  test("mouse wheel converts vertical scroll to horizontal", () => {
    const tabs: SessionTab[] = [
      {
        sessionId: "s1",
        agentId: "gemini",
        agentName: "Gemini",
        title: "Tab 1",
      },
    ];

    const tabBar = new TabBarComponent(ctx, {});
    tabBar.setSessions(tabs, "s1");

    const scrollArea =
      tabBar.containerEl.querySelector<HTMLElement>(".tabs-scroll-area");
    assert.ok(scrollArea);

    let scrollLeft = 0;
    Object.defineProperty(scrollArea, "scrollLeft", {
      get: () => scrollLeft,
      set: (v) => {
        scrollLeft = v;
      },
    });

    const wheelEvent = new dom.window.WheelEvent("wheel", { deltaY: 50 });
    scrollArea.dispatchEvent(wheelEvent);
    assert.strictEqual(scrollLeft, 50);
  });

  test("more button click triggers onMoreClick callback", () => {
    let moreClicked = false;
    const tabs: SessionTab[] = [
      {
        sessionId: "s1",
        agentId: "gemini",
        agentName: "Gemini",
        title: "Tab 1",
      },
      {
        sessionId: "s2",
        agentId: "claude",
        agentName: "Claude",
        title: "Tab 2",
      },
    ];

    const tabBar = new TabBarComponent(ctx, {
      onMoreClick: () => {
        moreClicked = true;
      },
    });
    tabBar.setSessions(tabs, "s1");

    const moreBtn =
      tabBar.containerEl.querySelector<HTMLElement>(".tab-more-btn");
    assert.ok(moreBtn);
    assert.ok(moreBtn.innerHTML.includes("codicon-ellipsis"));
    moreBtn.click();

    assert.strictEqual(moreClicked, true);
  });

  test("updates generating indicator on updateSession", () => {
    const tabs: SessionTab[] = [
      {
        sessionId: "s1",
        agentId: "gemini",
        agentName: "Gemini",
        title: "Tab 1",
        isGenerating: false,
      },
      {
        sessionId: "s2",
        agentId: "claude",
        agentName: "Claude",
        title: "Tab 2",
        isGenerating: false,
      },
    ];

    const tabBar = new TabBarComponent(ctx, {});
    tabBar.setSessions(tabs, "s1");

    tabBar.updateSession("s1", { isGenerating: true });
    const tabElements =
      tabBar.containerEl.querySelectorAll<HTMLElement>(".tab-item");
    const s1Gen = tabElements[0].querySelector<HTMLElement>(
      ".tab-generating-indicator"
    );
    const s2Gen = tabElements[1].querySelector<HTMLElement>(
      ".tab-generating-indicator"
    );

    assert.ok(s1Gen);
    assert.strictEqual(s1Gen.style.display, "inline-block");
    assert.ok(s2Gen);
    assert.strictEqual(s2Gen.style.display, "none");

    tabBar.updateSession("s1", { isGenerating: false });
    assert.strictEqual(s1Gen.style.display, "none");
  });

  test("handles allSessions message from messageRouter", () => {
    let selectedSession = "";
    const tabBar = new TabBarComponent(ctx, {
      onTabSelect: (sessionId) => {
        selectedSession = sessionId;
      },
    });

    const msg: ExtensionMessage = {
      type: "allSessions",
      sessions: [
        {
          sessionId: "s1",
          agentId: "gemini",
          agentName: "Gemini",
          title: "Session 1",
        },
        {
          sessionId: "s2",
          agentId: "claude",
          agentName: "Claude",
          title: "Session 2",
        },
      ],
      activeSessionId: "s2",
    };
    ctx.messageRouter
      .getHandlers("allSessions")
      .forEach((h) => h.handleMessage(msg));

    const tabElements =
      tabBar.containerEl.querySelectorAll<HTMLElement>(".tab-item");
    assert.strictEqual(tabElements.length, 2);
    assert.strictEqual(selectedSession, "s2");
    assert.ok(tabElements[1].classList.contains("active"));
  });

  test("handles sessionCreated and sessionClosed messages", () => {
    let selectedSession = "";
    let closedNotification = "";
    const tabBar = new TabBarComponent(ctx, {
      onTabSelect: (sessionId) => {
        selectedSession = sessionId;
      },
      onSessionClosedNotification: (sessionId) => {
        closedNotification = sessionId;
      },
    });

    const createdMsg: ExtensionMessage = {
      type: "sessionCreated",
      session: {
        sessionId: "s1",
        agentId: "gemini",
        agentName: "Gemini",
        title: "Session 1",
      },
    };
    ctx.messageRouter
      .getHandlers("sessionCreated")
      .forEach((h) => h.handleMessage(createdMsg));

    assert.strictEqual(selectedSession, "s1");
    assert.strictEqual(
      tabBar.containerEl.querySelectorAll(".tab-item").length,
      1
    );

    const closedMsg: ExtensionMessage = {
      type: "sessionClosed",
      sessionId: "s1",
    };
    ctx.messageRouter
      .getHandlers("sessionClosed")
      .forEach((h) => h.handleMessage(closedMsg));

    assert.strictEqual(closedNotification, "s1");
    assert.strictEqual(
      tabBar.containerEl.querySelectorAll(".tab-item").length,
      0
    );
  });
});
