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

  constructor(doc: Document, win: Window) {
    this.doc = doc;
    this.win = win;
  }

  /**
   * Create the tooltip DOM element and wire up the global hover listeners.
   * Call this once during webview initialisation.
   */
  setup(): void {
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

    // Auto-hide when the target element is removed from the DOM.
    if (typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(() => {
        if (currentTarget && !currentTarget.isConnected) {
          hide();
        }
      });
      observer.observe(this.doc.body, { childList: true, subtree: true });
    }

    this.doc.addEventListener("mouseover", (e) => {
      const target = (e.target as HTMLElement).closest(
        "[acp-title]"
      ) as HTMLElement;

      if (target === currentTarget) {
        return;
      }

      hide();

      if (target) {
        const title = target.getAttribute("acp-title");
        if (title) {
          currentTarget = target;
          tooltipTimeout = setTimeout(() => {
            if (!target.isConnected || target !== currentTarget) {
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
    });

    this.doc.addEventListener("mouseout", (e) => {
      if (currentTarget) {
        const relatedTarget = e.relatedTarget as HTMLElement;
        if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
          hide();
        }
      }
    });

    this.win.addEventListener("blur", hide);
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
