import { TooltipManager } from "./widget/tooltip";
import { showConfirmDialog } from "./widget/confirm-dialog";
import { PermissionDialog } from "./widget/permission-dialog";
import { AuxiliaryPanelsComponent } from "./component/auxiliary-panels";
import { InputPanelComponent } from "./component/input-panel";
import { MessageListComponent } from "./component/message-list";
import { SessionToolbarComponent } from "./component/session-toolbar";
import { ChipRendererComponent } from "./component/chip-renderer";
import { WebviewRootComponent } from "./component/webview-root";
import { TabBarComponent } from "./component/tab-bar";
import { SessionStore } from "./session-store";
import { MessageRouter, type MessageHandler } from "./message-router";
import { StatePersistenceService } from "./state-persistence";
import { EventBus } from "./event-bus";
import { AsyncSerialQueue } from "../../utils/async-queue";
import type { WebviewContext } from "./context";
import type {
  VsCodeApi,
  ExtensionMessage,
  WebviewEventMap,
  SessionTab,
} from "./types";

declare function acquireVsCodeApi(): VsCodeApi;

/**
 * Orchestration layer for the webview that wires components, multi-tab bar,
 * and per-session state caching together.
 */
export class WebviewController implements MessageHandler {
  private ctx: WebviewContext;
  private messageRouter: MessageRouter;
  private stateService: StatePersistenceService;
  private incomingNotifier = new AsyncSerialQueue();

  readonly messageList: MessageListComponent;
  readonly inputPanel: InputPanelComponent;
  readonly sessionToolbar: SessionToolbarComponent;
  readonly auxiliaryPanels: AuxiliaryPanelsComponent;
  readonly chipRenderer: ChipRendererComponent;
  readonly tabBar: TabBarComponent;
  readonly sessionStore: SessionStore;

  private permissionDialog: PermissionDialog;
  private isConnected = false;
  private activeSessionId: string | null = null;
  private activeAgentId = "default";

  constructor(vscode: VsCodeApi, doc: Document, win: Window) {
    this.messageRouter = new MessageRouter();
    this.stateService = new StatePersistenceService(vscode);
    this.sessionStore = new SessionStore();

    const eventBus = new EventBus<WebviewEventMap>();

    this.ctx = {
      vscode,
      doc,
      win,
      stateService: this.stateService,
      messageRouter: this.messageRouter,
      eventBus,
      sessionStore: this.sessionStore,
    };

    const root = new WebviewRootComponent(this.ctx);
    this.chipRenderer = root.chipRenderer;
    this.messageList = root.messageList;
    this.inputPanel = root.inputPanel;
    this.sessionToolbar = root.sessionToolbar;
    this.auxiliaryPanels = root.auxiliaryPanels;

    // Attach session context provider to input and toolbar
    const sessionContextProvider = () => ({
      sessionId: this.activeSessionId ?? undefined,
      agentId: this.activeAgentId,
    });
    this.inputPanel.getSessionContext = sessionContextProvider;
    this.sessionToolbar.getSessionContext = sessionContextProvider;

    // Multi-tab bar
    this.tabBar = new TabBarComponent(this.ctx, {
      onTabSelect: (sessionId, agentId) => {
        this.switchActiveSession(sessionId);
        this.ctx.vscode.postMessage({
          type: "switchSession",
          sessionId,
          agentId,
        });
      },
      onTabClose: (sessionId, agentId) => {
        this.closeSession(sessionId, agentId);
      },
      onSessionClosedNotification: (sessionId) => {
        this.messageList.removeSession(sessionId);
      },
      onMoreClick: () => {
        this.ctx.vscode.postMessage({
          type: "showOpenSessions",
        });
      },
    });

    // Insert tab bar at the top of the body
    doc.body.insertBefore(this.tabBar.containerEl, doc.body.firstChild);

    this.permissionDialog = new PermissionDialog(
      this.ctx,
      (toolCallId) => this.messageList.getToolBlockManager(toolCallId),
      () => this.messageList.scrollToBottom()
    );

    // Wire cross-component dependencies
    this.messageList.onGeneratingChange = (isGenerating) => {
      this.inputPanel.setGenerating(isGenerating);
      if (this.activeSessionId) {
        const session = this.sessionStore.get(this.activeSessionId);
        if (session) session.isGenerating = isGenerating;
        this.tabBar.updateSession(this.activeSessionId, { isGenerating });
      }
      if (!isGenerating) {
        this.inputPanel.focus();
      }
    };

    this.messageList.onCopyToInput = (text) => {
      this.inputPanel.setTextAndFocus(text);
      this.stateService.flush();
      this.inputPanel.updateInputState();
    };

    this.restoreState();
    this.setupEventListeners();
    this.messageList.updateViewState();
    this.inputPanel.adjustHeight();
    this.inputPanel.updateInputState();
    vscode.postMessage({ type: "ready" });
    new TooltipManager(doc, win).setup();

    // Delegated message-list handlers
    this.messageList.setupCodeCopyHandler();
    this.messageList.setupFileLinkHandler();
    this.messageList.setupDiffHeaderClickHandler();
    this.messageList.setupBlockFocusHandler();
    this.messageList.setupMessageFocusNavigation();
  }

  // -------------------------------------------------------------------
  // Multi-session Management
  // -------------------------------------------------------------------

  switchActiveSession(sessionId: string): void {
    if (sessionId === this.activeSessionId) return;

    // 1. Save current session input state
    if (this.activeSessionId) {
      const current = this.sessionStore.get(this.activeSessionId);
      if (current) {
        current.inputState = this.inputPanel.saveInputState();
      }
    }

    // 2. Activate new session
    this.activeSessionId = sessionId;
    this.sessionStore.setActiveSessionId(sessionId);
    const next = this.sessionStore.get(sessionId);

    // Switch message list container to the new session
    this.messageList.setActiveSession(sessionId);

    if (next) {
      this.activeAgentId = next.agentId;
      this.tabBar.setActiveSession(sessionId);
      this.inputPanel.setPlaceholder(next.agentName || next.agentId);

      // Restore input text & draft
      this.inputPanel.restoreInputState(next.inputState);

      // Restore toolbar metadata
      if (next.metadataMsg) {
        this.sessionToolbar.updateMetadata(next.metadataMsg);
      } else {
        this.sessionToolbar.updateMetadata({
          type: "sessionMetadata",
          modes: null,
          models: null,
          genericConfigOptions: [],
        });
      }

      // Restore context usage
      if (next.contextUsageMsg) {
        this.sessionToolbar.updateContextUsage(next.contextUsageMsg);
      } else {
        this.sessionToolbar.updateContextUsage({
          type: "contextUsage",
          used: null,
          size: null,
        });
      }

      // Restore plan & diff summary
      if (next.plan && next.plan.entries) {
        this.auxiliaryPanels.showPlan(next.plan.entries);
      } else {
        this.auxiliaryPanels.hidePlan();
      }

      if (next.diffChanges && next.diffChanges.length > 0) {
        this.auxiliaryPanels.setDiffChanges(next.diffChanges);
      } else {
        this.auxiliaryPanels.clearDiff();
      }

      const isGen = this.messageList.getIsGenerating(sessionId);
      this.inputPanel.setGenerating(isGen);
      this.inputPanel.setLoading(next.isLoading ?? false);
    } else {
      this.inputPanel.restoreInputState();
      this.inputPanel.setGenerating(false);
      this.inputPanel.setLoading(false);
      this.auxiliaryPanels.hidePlan();
      this.auxiliaryPanels.clearDiff();
    }

    this.inputPanel.adjustHeight();
  }

  closeSession(sessionId: string, agentId: string): void {
    this.ctx.vscode.postMessage({
      type: "closeSession",
      sessionId,
      agentId,
    });

    this.sessionStore.remove(sessionId);
    this.messageList.removeSession(sessionId);

    const remaining = this.sessionStore.getAll();
    const tabs: SessionTab[] = remaining.map((s) => ({
      sessionId: s.sessionId,
      agentId: s.agentId,
      agentName: s.agentName,
      title: s.title,
      isGenerating: s.isGenerating,
    }));

    if (this.activeSessionId === sessionId) {
      if (remaining.length > 0) {
        const next = remaining[remaining.length - 1];
        this.tabBar.setSessions(tabs, next.sessionId);
        this.switchActiveSession(next.sessionId);
      } else {
        this.activeSessionId = null;
        this.sessionStore.setActiveSessionId(null);
        this.tabBar.setSessions([], null);
        this.resetChatState();
      }
    } else {
      this.tabBar.setSessions(tabs, this.activeSessionId);
    }
  }

  // -------------------------------------------------------------------
  // MessageHandler — unified synchronous dispatch
  // -------------------------------------------------------------------

  handleMessage(
    msg: ExtensionMessage
  ): boolean | void | Promise<boolean | void> {
    // 1. Handle top-level messages in this controller
    const topResult = this.handleTopLevelMessage(msg);

    // 2. Unconditionally update session data in SessionStore
    const { targetSessionId, changedKeys } =
      this.sessionStore.processMessage(msg);

    if (targetSessionId && changedKeys.includes("isGenerating")) {
      const isGenerating =
        this.sessionStore.get(targetSessionId)?.isGenerating ?? false;
      this.tabBar.updateSession(targetSessionId, { isGenerating });
      if (targetSessionId === this.activeSessionId) {
        this.inputPanel.setGenerating(isGenerating);
      }
    }
    if (targetSessionId && changedKeys.includes("isLoading")) {
      const isLoading =
        this.sessionStore.get(targetSessionId)?.isLoading ?? false;
      this.tabBar.updateSession(targetSessionId, { isLoading });
      if (targetSessionId === this.activeSessionId) {
        this.inputPanel.setLoading(isLoading);
      }
    }
    if (targetSessionId && changedKeys.includes("title")) {
      const title = this.sessionStore.get(targetSessionId)?.title;
      if (title) this.tabBar.updateSession(targetSessionId, { title });
    }

    // 3. Dispatch to component handlers
    const handlers = this.messageRouter.getHandlers(msg.type);
    if (handlers.length === 0) return topResult;

    const isBackground = Boolean(
      targetSessionId &&
      this.activeSessionId &&
      targetSessionId !== this.activeSessionId
    );

    const results: (boolean | void | Promise<boolean | void>)[] = [topResult];
    for (const handler of handlers) {
      try {
        // MessageListComponent and TabBarComponent MUST receive messages across all sessions
        if (
          isBackground &&
          handler !== this.messageList &&
          handler !== this.tabBar
        ) {
          continue;
        }
        results.push(handler.handleMessage(msg));
      } catch (error) {
        console.error(
          `[WebviewController] Error in handler for "${msg.type}":`,
          error
        );
      }
    }

    // If active session received plan or diff updates, ensure auxiliary panels reflect the store
    if (!isBackground && targetSessionId === this.activeSessionId) {
      if (changedKeys.includes("plan")) {
        const active = this.sessionStore.getActiveSession();
        if (active?.plan?.entries) {
          this.auxiliaryPanels.showPlan(active.plan.entries);
        } else {
          this.auxiliaryPanels.hidePlan();
        }
      }
      if (changedKeys.includes("diffChanges")) {
        const active = this.sessionStore.getActiveSession();
        if (active?.diffChanges && active.diffChanges.length > 0) {
          this.auxiliaryPanels.setDiffChanges(active.diffChanges);
        } else {
          this.auxiliaryPanels.clearDiff();
        }
      }
    }

    const hasAsync = results.some(
      (r) =>
        r !== null &&
        r !== undefined &&
        typeof (r as Promise<unknown>).then === "function"
    );
    if (!hasAsync) return;

    return Promise.all(results.map((r) => Promise.resolve(r))).then(() => {});
  }

  private handleTopLevelMessage(
    msg: ExtensionMessage
  ): boolean | void | Promise<boolean | void> {
    switch (msg.type) {
      case "connectionState":
        if (msg.state) {
          this.isConnected = msg.state === "connected";
          this.messageList.updateViewState();
          this.stateService.update("isConnected", this.isConnected);
        }
        return;

      case "availableAgents":
        return;

      case "sessionIdChanged":
        if (msg.oldSessionId && msg.newSessionId) {
          if (this.activeSessionId === msg.oldSessionId) {
            this.activeSessionId = msg.newSessionId;
            this.sessionStore.setActiveSessionId(msg.newSessionId);
            if (msg.session?.agentName) {
              this.inputPanel.setPlaceholder(msg.session.agentName);
            }
            this.inputPanel.setLoading(msg.session?.isLoading ?? false);
          }
        }
        return;

      case "error":
        if (msg.text) this.messageList.addMessage(msg.text, "error");
        this.inputPanel.setGenerating(false);
        this.inputPanel.setLoading(false);
        this.inputPanel.focus();
        return;

      case "agentError":
        if (msg.text) this.messageList.addMessage(msg.text, "error");
        this.inputPanel.setLoading(false);
        return;

      case "system":
        if (msg.text) this.messageList.addMessage(msg.text, "system");
        return;

      case "agentChanged":
        if (msg.agentName) {
          this.inputPanel.setPlaceholder(msg.agentName);
        }
        this.resetChatState();
        return;

      case "chatCleared":
        this.resetChatState();
        return;

      case "confirmAction": {
        const actionLabel = msg.actionLabel || msg.action || "this action";
        return showConfirmDialog(this.ctx.doc, actionLabel).then(
          (confirmed) => {
            this.ctx.vscode.postMessage({
              type: "confirmActionResponse",
              requestId: msg.requestId,
              confirmed,
            });
          }
        );
      }

      case "permissionRequest":
        if (msg.requestId && msg.toolCall && msg.options) {
          this.permissionDialog.show(
            msg.requestId,
            msg.toolCall,
            msg.options,
            msg.toolCallId
          );
        }
        return;

      case "permissionCleared":
        this.permissionDialog.dismiss();
        return;

      case "sessionMetadata": {
        this.sessionToolbar.updateMetadata(msg);
        if (msg.commands && Array.isArray(msg.commands)) {
          this.messageList.setAvailableCommands(msg.commands);
          this.inputPanel.setAvailableCommands(msg.commands);
        }
        return;
      }

      case "availableCommands":
        if (msg.commands && Array.isArray(msg.commands)) {
          this.messageList.setAvailableCommands(msg.commands);
          this.inputPanel.setAvailableCommands(msg.commands);
        }
        return;
    }
  }

  // -------------------------------------------------------------------
  // State persistence
  // -------------------------------------------------------------------

  private restoreState(): void {
    const previousState = this.stateService.restore();
    if (previousState) {
      this.isConnected = previousState.isConnected;
    }
  }

  // -------------------------------------------------------------------
  // Event listeners
  // -------------------------------------------------------------------

  private setupEventListeners(): void {
    this.ctx.win.addEventListener(
      "message",
      (e: MessageEvent<ExtensionMessage>) =>
        this.incomingNotifier.enqueue(async () => {
          try {
            await this.handleMessage(e.data);
          } catch (error) {
            console.error("[Webview] Error handling extension message:", error);
          }
        })
    );
  }

  private resetChatState(): void {
    this.messageList.clear();
    this.inputPanel.autocomplete.hide();
    this.auxiliaryPanels.hidePlan();
    this.auxiliaryPanels.clearDiff();
    this.messageList.updateViewState();
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }

  getTools() {
    return this.messageList.getToolsSnapshot();
  }
}

/**
 * Entry point for initializing the webview controller.
 */
export function initWebview(
  vscode: VsCodeApi,
  doc: Document,
  win: Window
): WebviewController {
  return new WebviewController(vscode, doc, win);
}

if (typeof acquireVsCodeApi !== "undefined") {
  const vscode = acquireVsCodeApi();
  initWebview(vscode, document, window);
}
