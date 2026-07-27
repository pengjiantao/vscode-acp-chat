/**
 * Lightweight tooltip widget for the webview.
 *
 * Shows a floating tooltip for any element that carries an `acp-title`
 * attribute – mirroring the native VS Code hover behaviour.  The tooltip
 * appears after a 400 ms delay (same as VS Code) and automatically hides
 * when the target element is removed from the DOM.
 */

/**
 * Manages a single shared tooltip element attached to `document.body`.
 *
 * Usage:
 * ```ts
 * const tooltip = new TooltipManager(document, window);
 * tooltip.setup();
 * ```
 */
export class TooltipManager {
  private doc: Document;
  private win: Window;
  private isSetup = false;
  private destroyFn?: () => void;

  constructor(doc: Document, win: Window) {
    this.doc = doc;
    this.win = win;
  }

  /**
   * Static helper to immediately hide any active floating acp-title tooltip in the document.
   * Serves as a single source of truth for external widgets (like Dropdown) without
   * tight CSS class coupling.
   */
  static hideActive(doc: Document): void {
    const activeTooltip = doc.querySelector(".acp-tooltip.visible");
    if (activeTooltip) {
      activeTooltip.classList.remove("visible");
    }
  }

  /** Instance helper to hide active tooltip. */
  hideActive(): void {
    TooltipManager.hideActive(this.doc);
  }

  /**
   * Create the tooltip DOM element and wire up the global hover/click listeners.
   * Idempotent: safe to call multiple times (cleans up previous listeners).
   */
  setup(): void {
    if (this.isSetup) {
      this.destroy();
    }

    const tooltipElement = this.doc.createElement("div");
    tooltipElement.className = "acp-tooltip";
    this.doc.body.appendChild(tooltipElement);

    let tooltipTimeout: ReturnType<typeof setTimeout>;
    let currentTarget: HTMLElement | null = null;

    const hide = () => {
      clearTimeout(tooltipTimeout);
      tooltipElement.classList.remove("visible");
      currentTarget = null;
    };

    let observer: MutationObserver | undefined;
    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(() => {
        if (currentTarget && !currentTarget.isConnected) {
          hide();
        }
      });
      observer.observe(this.doc.body, { childList: true, subtree: true });
    }

    const onMouseOver = (e: Event) => {
      const target = (e.target as HTMLElement).closest(
        "[acp-title]"
      ) as HTMLElement;

      if (target === currentTarget) {
        return;
      }

      hide();

      if (target) {
        // Stage 1 (Immediate Interception): Suppress acp-title tooltips immediately if
        // the target element or its ancestor is open (e.g. an open dropdown wrapper),
        // or inside a dropdown menu popover or item description popover.
        if (
          target.classList.contains("open") ||
          target.closest(".open") ||
          target.closest(".dropdown-popover") ||
          target.closest(".acp-dropdown-item-desc-popover")
        ) {
          return;
        }

        const title = target.getAttribute("acp-title");
        if (title) {
          currentTarget = target;
          tooltipTimeout = setTimeout(() => {
            // Stage 2 (Delayed Verification): Re-check conditions after 400ms delay to guard against race conditions:
            // 1. Target element detached from DOM.
            // 2. Hover target changed.
            // 3. Target or parent element became open (e.g. user clicked to open dropdown during 400ms delay).
            // 4. acp-title attribute was removed (e.g. stripped on dropdown open).
            if (
              !target.isConnected ||
              target !== currentTarget ||
              target.classList.contains("open") ||
              !target.hasAttribute("acp-title") ||
              target.closest(".open")
            ) {
              return;
            }
            tooltipElement.textContent = title;
            // Reset the previous placement before measuring. With auto width,
            // an old left offset can change wrapping and produce a stale height.
            tooltipElement.style.left = "0px";
            tooltipElement.style.top = "0px";
            this.updatePosition(target, tooltipElement);
            tooltipElement.classList.add("visible");
          }, 400); // VSCode native hover delay
        }
      }
    };

    const onMouseOut = (e: Event) => {
      if (currentTarget) {
        const relatedTarget = (e as MouseEvent).relatedTarget as HTMLElement;
        if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
          hide();
        }
      }
    };

    const onMouseDown = () => hide();
    const onBlur = () => hide();

    this.doc.addEventListener("mouseover", onMouseOver);
    this.doc.addEventListener("mouseout", onMouseOut);
    this.doc.addEventListener("mousedown", onMouseDown);
    this.win.addEventListener("blur", onBlur);

    this.isSetup = true;
    this.destroyFn = () => {
      hide();
      observer?.disconnect();
      this.doc.removeEventListener("mouseover", onMouseOver);
      this.doc.removeEventListener("mouseout", onMouseOut);
      this.doc.removeEventListener("mousedown", onMouseDown);
      this.win.removeEventListener("blur", onBlur);
      tooltipElement.remove();
      this.isSetup = false;
    };
  }

  /** Clean up event listeners and DOM elements created by setup(). */
  destroy(): void {
    if (this.destroyFn) {
      this.destroyFn();
      this.destroyFn = undefined;
    }
  }

  /**
   * Position the tooltip relative to `target`, keeping it within the
   * viewport boundaries.
   */
  private updatePosition(target: HTMLElement, tooltip: HTMLElement): void {
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    // Default position: below the element
    let top = rect.bottom + 4;
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;

    // Boundary check: if too close to the bottom, show above
    if (top + tooltipRect.height > this.win.innerHeight - 10) {
      top = rect.top - tooltipRect.height - 4;
    }

    // Boundary check: horizontal overflow
    if (left < 4) {
      left = 4;
    } else if (left + tooltipRect.width > this.win.innerWidth - 4) {
      left = this.win.innerWidth - tooltipRect.width - 4;
    }

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }
}
