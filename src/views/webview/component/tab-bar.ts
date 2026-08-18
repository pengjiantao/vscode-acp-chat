import type { WebviewContext } from "../context";
import type { ExtensionMessage, SessionTab } from "../types";
import type { MessageHandler } from "../message-router";

export interface TabBarOptions {
  onTabSelect?: (sessionId: string, agentId: string) => void;
  onTabClose?: (sessionId: string, agentId: string) => void;
  onSessionClosedNotification?: (sessionId: string) => void;
  onMoreClick?: () => void;
}

const OVERFLOW_TOLERANCE_PX = 2;

/**
 * VS Code style multi-tab bar component for managing concurrent ACP sessions.
 *
 * Supports:
 *   - Visual active accent top border and hover states matching VS Code theme
 *   - Horizontal mouse wheel scrolling
 *   - Dynamic overflow detection with a "..." button (shown only when overflowing)
 *   - Quick closing and tab switching
 *   - Session title and generating indicators
 */
export class TabBarComponent implements MessageHandler {
  readonly containerEl: HTMLElement;
  readonly scrollArea: HTMLElement;
  readonly actionsContainer: HTMLElement;
  readonly moreContainer: HTMLElement;
  readonly moreBtn: HTMLButtonElement;

  private sessions: SessionTab[] = [];
  private activeSessionId: string | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly ctx: WebviewContext,
    private readonly options: TabBarOptions
  ) {
    const doc = ctx.doc;

    this.containerEl = doc.createElement("div");
    this.containerEl.id = "tab-bar-container";
    this.containerEl.className = "tab-bar-container";
    this.containerEl.setAttribute("role", "tablist");
    this.containerEl.setAttribute("aria-label", "Session tabs");

    this.scrollArea = doc.createElement("div");
    this.scrollArea.className = "tabs-scroll-area";
    this.containerEl.appendChild(this.scrollArea);

    this.actionsContainer = doc.createElement("div");
    this.actionsContainer.className = "tab-actions tab-more-container";
    this.actionsContainer.style.display = "none";
    this.moreContainer = this.actionsContainer;

    this.moreBtn = doc.createElement("button");
    this.moreBtn.id = "tab-more-btn";
    this.moreBtn.className = "tab-action-btn tab-more-btn icon-button";
    this.moreBtn.setAttribute("acp-title", "More Sessions");
    this.moreBtn.setAttribute("aria-label", "More Sessions");
    this.moreBtn.innerHTML = '<span class="codicon codicon-ellipsis"></span>';
    this.actionsContainer.appendChild(this.moreBtn);

    this.containerEl.appendChild(this.actionsContainer);

    this.ctx.messageRouter.registerMany(
      [
        "allSessions",
        "sessionCreated",
        "sessionUpdated",
        "sessionClosed",
        "activeSessionChanged",
        "sessionIdChanged",
        "sessionLoaded",
        "sessionLoadFailed",
      ],
      this
    );

    this.setupListeners();
  }

  handleMessage(msg: ExtensionMessage): boolean | void {
    switch (msg.type) {
      case "allSessions": {
        const sessions = msg.sessions || [];
        sessions.forEach((s) => this.ctx.sessionStore.getOrCreate(s));
        const tabs: SessionTab[] = this.ctx.sessionStore.getAll().map((s) => ({
          sessionId: s.sessionId,
          agentId: s.agentId,
          agentName: s.agentName,
          title: s.title,
          isGenerating: s.isGenerating,
          isLoading: s.isLoading,
        }));
        const targetActive = msg.activeSessionId || tabs[0]?.sessionId || null;
        this.setSessions(tabs, targetActive);
        if (targetActive) {
          const targetTab = tabs.find((t) => t.sessionId === targetActive);
          this.options.onTabSelect?.(targetActive, targetTab?.agentId || "");
        }
        return;
      }

      case "sessionCreated": {
        if (msg.session) {
          this.ctx.sessionStore.getOrCreate(msg.session);
          const tabs: SessionTab[] = this.ctx.sessionStore
            .getAll()
            .map((s) => ({
              sessionId: s.sessionId,
              agentId: s.agentId,
              agentName: s.agentName,
              title: s.title,
              isGenerating: s.isGenerating,
              isLoading: s.isLoading,
            }));
          this.setSessions(tabs, msg.session.sessionId);
          this.options.onTabSelect?.(
            msg.session.sessionId,
            msg.session.agentId
          );
        }
        return;
      }

      case "sessionIdChanged": {
        if (msg.oldSessionId && msg.newSessionId) {
          const tab = this.sessions.find(
            (s) => s.sessionId === msg.oldSessionId
          );
          if (tab) {
            tab.sessionId = msg.newSessionId;
            if (msg.session) {
              if (msg.session.agentId) tab.agentId = msg.session.agentId;
              if (msg.session.agentName) tab.agentName = msg.session.agentName;
              if (msg.session.title) tab.title = msg.session.title;
              tab.isLoading = msg.session.isLoading ?? false;
            } else {
              tab.isLoading = false;
            }
          }
          if (this.activeSessionId === msg.oldSessionId) {
            this.activeSessionId = msg.newSessionId;
          }
          const tabEl = this.scrollArea.querySelector<HTMLElement>(
            `.tab-item[data-session-id="${msg.oldSessionId}"]`
          );
          if (tabEl) {
            tabEl.setAttribute("data-session-id", msg.newSessionId);
            if (tab?.agentId) tabEl.setAttribute("data-agent-id", tab.agentId);
            const titleEl = tabEl.querySelector<HTMLElement>(".tab-title");
            if (titleEl && tab?.title) titleEl.textContent = tab.title;
            tabEl.setAttribute(
              "acp-title",
              `${tab?.agentName || tab?.agentId || "Agent"}: ${tab?.title || "New session"}`
            );
            const genEl = tabEl.querySelector<HTMLElement>(
              ".tab-generating-indicator"
            );
            if (genEl) {
              genEl.style.display =
                tab?.isLoading || tab?.isGenerating ? "inline-block" : "none";
            }
          }
        }
        return;
      }

      case "sessionLoaded": {
        if (msg.sessionId) {
          this.updateSession(msg.sessionId, { isLoading: false });
        }
        return;
      }

      case "sessionLoadFailed": {
        if (msg.sessionId) {
          this.updateSession(msg.sessionId, { isLoading: false });
        }
        return;
      }

      case "sessionUpdated": {
        if (msg.sessionId) {
          const session = this.ctx.sessionStore.get(msg.sessionId);
          if (session && msg.title) {
            session.title = msg.title;
          }
          if (session && msg.agentName) {
            session.agentName = msg.agentName;
          }
          this.updateSession(msg.sessionId, {
            title: msg.title,
            agentName: msg.agentName,
            isLoading: msg.isLoading,
          });
        }
        return;
      }

      case "sessionClosed": {
        if (msg.sessionId) {
          this.ctx.sessionStore.remove(msg.sessionId);
          const tabs: SessionTab[] = this.ctx.sessionStore
            .getAll()
            .map((s) => ({
              sessionId: s.sessionId,
              agentId: s.agentId,
              agentName: s.agentName,
              title: s.title,
              isGenerating: s.isGenerating,
              isLoading: s.isLoading,
            }));
          this.setSessions(tabs, this.activeSessionId);
          this.options.onSessionClosedNotification?.(msg.sessionId);
        }
        return;
      }

      case "activeSessionChanged": {
        if (msg.sessionId) {
          const session = this.ctx.sessionStore.get(msg.sessionId);
          this.setActiveSession(msg.sessionId);
          this.options.onTabSelect?.(msg.sessionId, session?.agentId || "");
        }
        return;
      }
    }
  }

  private setupListeners(): void {
    // Mouse wheel horizontal scrolling
    this.scrollArea.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        if (delta !== 0) {
          e.preventDefault?.();
          this.scrollArea.scrollLeft += delta;
        }
      },
      { passive: false }
    );

    // More button click triggers quick select
    this.moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.options.onMoreClick?.();
    });

    // Resize observer for overflow detection
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.checkOverflow();
      });
      this.resizeObserver.observe(this.scrollArea);
      this.resizeObserver.observe(this.containerEl);
    }
  }

  setSessions(sessions: SessionTab[], activeSessionId: string | null): void {
    this.sessions = [...sessions];
    this.activeSessionId = activeSessionId;
    this.render();
  }

  setActiveSession(sessionId: string): void {
    this.activeSessionId = sessionId;
    const tabEls = this.scrollArea.querySelectorAll<HTMLElement>(".tab-item");
    for (const el of Array.from(tabEls)) {
      const match = el.getAttribute("data-session-id") === sessionId;
      el.classList.toggle("active", match);
      el.setAttribute("aria-selected", match ? "true" : "false");
      if (match) {
        el.scrollIntoView?.({
          behavior: "smooth",
          inline: "nearest",
          block: "nearest",
        });
      }
    }
  }

  updateSession(sessionId: string, updates: Partial<SessionTab>): void {
    const session = this.sessions.find((s) => s.sessionId === sessionId);
    if (!session) return;

    Object.assign(session, updates);

    const tabEl = this.scrollArea.querySelector<HTMLElement>(
      `.tab-item[data-session-id="${sessionId}"]`
    );
    if (tabEl) {
      if (updates.title !== undefined) {
        const titleEl = tabEl.querySelector<HTMLElement>(".tab-title");
        if (titleEl) {
          titleEl.textContent = updates.title || "Untitled Session";
          tabEl.setAttribute(
            "acp-title",
            `${session.agentName || session.agentId}: ${updates.title}`
          );
        }
      }
      if (updates.agentName !== undefined) {
        tabEl.setAttribute(
          "acp-title",
          `${session.agentName || session.agentId}: ${session.title || "New session"}`
        );
      }
      if (
        updates.isGenerating !== undefined ||
        updates.isLoading !== undefined
      ) {
        const genEl = tabEl.querySelector<HTMLElement>(
          ".tab-generating-indicator"
        );
        if (genEl) {
          genEl.style.display =
            session.isLoading || session.isGenerating ? "inline-block" : "none";
        }
      }
    }
  }

  private render(): void {
    this.scrollArea.innerHTML = "";

    for (const session of this.sessions) {
      const tabEl = this.createTabElement(session);
      this.scrollArea.appendChild(tabEl);
    }

    this.checkOverflow();
  }

  private createTabElement(session: SessionTab): HTMLElement {
    const doc = this.ctx.doc;
    const tab = doc.createElement("div");
    const isActive = session.sessionId === this.activeSessionId;

    tab.className = `tab-item${isActive ? " active" : ""}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("data-session-id", session.sessionId);
    tab.setAttribute("data-agent-id", session.agentId);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tab.setAttribute(
      "acp-title",
      `${session.agentName || session.agentId}: ${session.title || "New session"}`
    );

    // Generating / Loading spinner (placed to the left of the session name)
    const gen = doc.createElement("span");
    gen.className =
      "tab-generating-indicator codicon codicon-loading codicon-modifier-spin";
    gen.style.display =
      session.isLoading || session.isGenerating ? "inline-block" : "none";
    tab.appendChild(gen);

    // Title
    const title = doc.createElement("span");
    title.className = "tab-title";
    title.textContent = session.title || "New session";
    tab.appendChild(title);

    // Close button
    const closeBtn = doc.createElement("button");
    closeBtn.className = "tab-close codicon codicon-close";
    closeBtn.setAttribute("acp-title", "Close Session");
    closeBtn.setAttribute("aria-label", "Close Session");
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.options.onTabClose?.(session.sessionId, session.agentId);
    });
    tab.appendChild(closeBtn);

    // Click to select
    tab.addEventListener("click", () => {
      if (session.sessionId !== this.activeSessionId) {
        this.options.onTabSelect?.(session.sessionId, session.agentId);
      }
    });

    // Middle click to close
    tab.addEventListener("auxclick", (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        this.options.onTabClose?.(session.sessionId, session.agentId);
      }
    });

    return tab;
  }

  private checkOverflow(): void {
    const isOverflowing =
      this.scrollArea.scrollWidth >
      this.scrollArea.clientWidth + OVERFLOW_TOLERANCE_PX;
    this.actionsContainer.style.display = isOverflowing ? "flex" : "none";
  }

  dispose(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.containerEl.remove();
  }
}
