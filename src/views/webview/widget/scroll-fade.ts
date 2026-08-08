import type { UserScrollDirection } from "../types";

/**
 * Scroll-fade widget.
 *
 * Wraps a scrollable content element with fixed top/bottom gradient fades
 * and optional bounded sizing, plus a message-transcript-style auto-scroll
 * engine: new content is automatically pinned to the bottom until the user
 * scrolls away, at which point auto-scroll pauses and only resumes once the
 * user scrolls back near the bottom (or it is explicitly forced).
 *
 * The fades are scroll-aware: the top fade appears once the content is
 * scrolled down, the bottom fade appears while more content is reachable
 * below. The bottom overlay stays fixed at the container edge while the
 * content scrolls beneath it.
 *
 * The given content element is re-parented (not cloned), so existing
 * references and queries on it keep working.
 */

const BOTTOM_THRESHOLD_PX = 100;
const AUTO_SCROLL_SETTLE_FRAMES = 3;

/** Configuration accepted by {@link ScrollFadeController}. */
export interface ScrollFadeOptions {
  /**
   * CSS max-height for the scrollable content (bounded mode). Omit (or set
   * `fill: true`) to let the content fill its flex parent instead.
   */
  maxHeight?: string;
  /** Height of each fade overlay in px. Defaults to `24`. */
  fadeHeight?: number;
  /**
   * Grow the container to fill its flex parent (`flex: 1`) instead of
   * bounding the content with a max-height.
   */
  fill?: boolean;
  /** Distance from the bottom (px) at which auto-scroll re-engages. Defaults to `100`. */
  bottomThreshold?: number;
  /**
   * Comma-separated selector list of nested scrollable elements whose wheel
   * / touch / keyboard events must NOT count as user scroll intent on this
   * container (e.g. embedded tool outputs).
   */
  nestedScrollSelector?: string;
  /** Toggle `data-paint-bump` on the content element to force webview repaints. */
  paintBump?: boolean;
}

/**
 * Owns a fade-wrapped scroll region and its auto-scroll state.
 *
 * Mirrors the chat transcript scrolling behavior: pinned to the bottom while
 * content streams, released when the user scrolls up, re-pinned when they
 * scroll back near the bottom or a forced scroll happens.
 */
export class ScrollFadeController {
  readonly container: HTMLElement;
  readonly contentEl: HTMLElement;
  private readonly topFade: HTMLElement;
  private readonly bottomFade: HTMLElement;
  private readonly win: Window | null;
  private readonly bottomThreshold: number;
  private readonly nestedScrollSelector: string | null;
  private readonly paintBumpEnabled: boolean;

  private isAutoScrollEnabled = true;
  private pendingBottomScrollFrame: number | null = null;
  private pendingBottomScrollForce = false;
  private bottomScrollSettleFrames = 0;
  private pendingPaintFrame: number | null = null;
  private paintBump = false;
  private userScrollIntent = false;
  private pointerScrollActive = false;
  private touchScrollActive = false;
  private userScrollDirection: UserScrollDirection = "none";

  private readonly onPointerUp = (): void => this.clearPointerScroll();
  private readonly onPointerCancel = (): void => this.clearPointerScroll();
  private readonly onTouchEnd = (): void => this.clearTouchScroll();
  private readonly onTouchCancel = (): void => this.clearTouchScroll();

  private disposed = false;

  constructor(
    doc: Document,
    contentEl: HTMLElement,
    options: ScrollFadeOptions = {}
  ) {
    const {
      maxHeight = "240px",
      fadeHeight = 24,
      fill = false,
      bottomThreshold = BOTTOM_THRESHOLD_PX,
      nestedScrollSelector,
      paintBump = false,
    } = options;

    this.contentEl = contentEl;
    this.win = doc.defaultView;
    this.bottomThreshold = bottomThreshold;
    this.nestedScrollSelector = nestedScrollSelector ?? null;
    this.paintBumpEnabled = paintBump;

    const container = doc.createElement("div");
    container.className = fill ? "scroll-fade scroll-fade-fill" : "scroll-fade";
    this.container = container;

    const topFade = doc.createElement("div");
    topFade.className = "scroll-fade-top";
    topFade.style.height = `${fadeHeight}px`;
    this.topFade = topFade;

    const bottomFade = doc.createElement("div");
    bottomFade.className = "scroll-fade-bottom";
    bottomFade.style.height = `${fadeHeight}px`;
    this.bottomFade = bottomFade;

    contentEl.classList.add("scroll-fade-content");
    contentEl.style.overflowY = "auto";
    if (!fill) {
      contentEl.style.maxHeight = maxHeight;
    }

    contentEl.parentNode?.insertBefore(container, contentEl);
    container.appendChild(topFade);
    container.appendChild(contentEl);
    container.appendChild(bottomFade);

    this.setupListeners();
    this.updateFades();
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  /**
   * Scroll to the bottom. With `force`, re-enables auto-scroll first so the
   * pin survives until the user scrolls away.
   */
  scrollToBottom(force = false): void {
    if (this.disposed) return;
    if (force) {
      this.isAutoScrollEnabled = true;
    }

    if (!force && !this.isAutoScrollEnabled) {
      this.schedulePaintInvalidation();
      return;
    }

    this.pendingBottomScrollForce = this.pendingBottomScrollForce || force;
    this.bottomScrollSettleFrames = Math.max(
      this.bottomScrollSettleFrames,
      AUTO_SCROLL_SETTLE_FRAMES
    );
    this.scheduleBottomScrollFrame();
  }

  /** Pause auto-scrolling (e.g. after the user scrolls up or uses scrollToTop). */
  disableAutoScroll(): void {
    this.isAutoScrollEnabled = false;
    this.cancelPendingBottomScroll();
  }

  /** Smoothly scroll to the top and disable auto-scroll. */
  scrollToTop(): void {
    this.disableAutoScroll();
    this.contentEl.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** True when the content is within the bottom threshold of its scroll end. */
  isNearBottom(): boolean {
    const { scrollHeight, scrollTop, clientHeight } = this.contentEl;
    return scrollHeight - scrollTop - clientHeight <= this.bottomThreshold;
  }

  /**
   * Detach window listeners and cancel pending frames. Safe to call multiple
   * times; no-op after the first call.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPendingBottomScroll();
    if (this.pendingPaintFrame !== null) {
      this.cancelFrame(this.pendingPaintFrame);
      this.pendingPaintFrame = null;
    }
    this.removeWindowListeners();
  }

  // -------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------

  private setupListeners(): void {
    const { contentEl, win } = this;

    contentEl.addEventListener("scroll", () => this.handleScroll(), {
      passive: true,
    });

    contentEl.addEventListener(
      "wheel",
      (event) => {
        if (this.isEventFromNested(event.target)) return;
        const direction =
          event.deltaY < 0 ? "up" : event.deltaY > 0 ? "down" : "unknown";
        this.markUserScrollIntent(direction);
      },
      { passive: true }
    );

    contentEl.addEventListener(
      "pointerdown",
      (event) => {
        if (event.target !== contentEl) return;
        this.pointerScrollActive = true;
        this.markUserScrollIntent("unknown");
      },
      { passive: true }
    );

    contentEl.addEventListener(
      "touchstart",
      (event) => {
        if (this.isEventFromNested(event.target)) return;
        this.touchScrollActive = true;
      },
      { passive: true }
    );

    contentEl.addEventListener(
      "touchmove",
      (event) => {
        if (this.isEventFromNested(event.target)) return;
        this.touchScrollActive = true;
        this.markUserScrollIntent("unknown");
      },
      { passive: true }
    );

    contentEl.addEventListener("keydown", (event) => {
      if (this.isEventFromNested(event.target)) return;
      if (
        event.key === "ArrowUp" ||
        event.key === "PageUp" ||
        event.key === "Home"
      ) {
        this.markUserScrollIntent("up");
      } else if (
        event.key === "ArrowDown" ||
        event.key === "PageDown" ||
        event.key === "End" ||
        event.key === " "
      ) {
        this.markUserScrollIntent("down");
      }
    });

    if (win) {
      win.addEventListener("pointerup", this.onPointerUp);
      win.addEventListener("pointercancel", this.onPointerCancel);
      win.addEventListener("touchend", this.onTouchEnd);
      win.addEventListener("touchcancel", this.onTouchCancel);
    }
  }

  private removeWindowListeners(): void {
    const { win } = this;
    if (!win) return;
    win.removeEventListener("pointerup", this.onPointerUp);
    win.removeEventListener("pointercancel", this.onPointerCancel);
    win.removeEventListener("touchend", this.onTouchEnd);
    win.removeEventListener("touchcancel", this.onTouchCancel);
  }

  // -------------------------------------------------------------------
  // Intent + scroll handling
  // -------------------------------------------------------------------

  private handleScroll(): void {
    const hasUserIntent =
      this.userScrollIntent ||
      this.pointerScrollActive ||
      this.touchScrollActive;

    if (hasUserIntent) {
      const isNearBottom = this.isNearBottom();
      const direction = this.userScrollDirection;

      if (isNearBottom) {
        this.isAutoScrollEnabled = true;
      } else if (this.pointerScrollActive || this.touchScrollActive) {
        this.disableAutoScroll();
      } else if (direction === "up" || direction === "unknown") {
        this.disableAutoScroll();
      }

      this.clearDiscreteScrollIntent();
    }

    this.updateFades();
    this.schedulePaintInvalidation();
  }

  private updateFades(): void {
    const { scrollTop, clientHeight, scrollHeight } = this.contentEl;
    this.topFade.classList.toggle("visible", scrollTop > 0);
    this.bottomFade.classList.toggle(
      "visible",
      scrollTop + clientHeight < scrollHeight - 1
    );
  }

  private isEventFromNested(target: EventTarget | null): boolean {
    if (!this.nestedScrollSelector) return false;
    if (!target || typeof (target as Element).closest !== "function") {
      return false;
    }
    return (target as Element).closest(this.nestedScrollSelector) !== null;
  }

  private markUserScrollIntent(direction: UserScrollDirection): void {
    this.userScrollIntent = true;
    this.userScrollDirection = direction;
  }

  private clearDiscreteScrollIntent(): void {
    if (this.pointerScrollActive || this.touchScrollActive) return;
    this.userScrollIntent = false;
    this.userScrollDirection = "none";
  }

  private clearPointerScroll(): void {
    this.pointerScrollActive = false;
    this.clearDiscreteScrollIntent();
  }

  private clearTouchScroll(): void {
    this.touchScrollActive = false;
    this.clearDiscreteScrollIntent();
  }

  // -------------------------------------------------------------------
  // Frame scheduling
  // -------------------------------------------------------------------

  private scheduleBottomScrollFrame(): void {
    if (this.pendingBottomScrollFrame !== null) return;

    this.pendingBottomScrollFrame = this.requestFrame(() => {
      this.pendingBottomScrollFrame = null;
      const shouldScroll =
        this.pendingBottomScrollForce || this.isAutoScrollEnabled;
      this.pendingBottomScrollForce = false;

      if (!shouldScroll) {
        this.bottomScrollSettleFrames = 0;
        this.schedulePaintInvalidation();
        return;
      }

      this.performScrollToBottom();
      this.bottomScrollSettleFrames = Math.max(
        0,
        this.bottomScrollSettleFrames - 1
      );
      if (this.bottomScrollSettleFrames > 0 && this.isAutoScrollEnabled) {
        this.scheduleBottomScrollFrame();
      }
    });
  }

  private performScrollToBottom(): void {
    const { contentEl } = this;
    const previousScrollBehavior = contentEl.style.scrollBehavior;
    contentEl.style.scrollBehavior = "auto";
    contentEl.scrollTop = contentEl.scrollHeight;
    void contentEl.offsetHeight;
    contentEl.style.scrollBehavior = previousScrollBehavior;
    this.isAutoScrollEnabled = true;
    this.schedulePaintInvalidation();
  }

  private cancelPendingBottomScroll(): void {
    if (this.pendingBottomScrollFrame !== null) {
      this.cancelFrame(this.pendingBottomScrollFrame);
      this.pendingBottomScrollFrame = null;
    }
    this.pendingBottomScrollForce = false;
    this.bottomScrollSettleFrames = 0;
  }

  private schedulePaintInvalidation(): void {
    if (!this.paintBumpEnabled || this.pendingPaintFrame !== null) return;

    this.pendingPaintFrame = this.requestFrame(() => {
      this.pendingPaintFrame = null;
      this.paintBump = !this.paintBump;
      this.contentEl.dataset.paintBump = this.paintBump ? "1" : "0";
      void this.contentEl.offsetHeight;
    });
  }

  private requestFrame(callback: FrameRequestCallback): number {
    if (typeof this.win?.requestAnimationFrame === "function") {
      return this.win.requestAnimationFrame(callback);
    }
    return this.win?.setTimeout(() => callback(Date.now()), 0) ?? 0;
  }

  private cancelFrame(frame: number): void {
    if (typeof this.win?.cancelAnimationFrame === "function") {
      this.win.cancelAnimationFrame(frame);
      return;
    }
    this.win?.clearTimeout(frame);
  }
}
