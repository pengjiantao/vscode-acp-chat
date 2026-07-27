/**
 * Reusable dropdown widget for the webview.
 *
 * Renders a trigger + popover pair inside a container element. Supports
 * grouped options (headers / dividers), keyboard-less selection, an
 * optional star-toggle action used by the model picker, and floating
 * item-level description popovers.
 */

import { escapeHtml } from "../html-utils";
import type { DropdownOption } from "../types";
import { TooltipManager } from "./tooltip";

/** Layout and positioning constants for the item-level description popover. */
const OFFSCREEN_MEASURE_POS_PX = -9999;
const MIN_SIDE_AVAIL_PX = 140;
const MAX_DESC_WIDTH_PX = 280;
const MIN_DESC_WIDTH_PX = 100;
const VIEWPORT_PADDING_PX = 8;
const SIDE_GAP_PX = 6;
const NON_OVERLAP_BUFFER_PX = 4;
const DEFAULT_VIEWPORT_W = 800;
const DEFAULT_VIEWPORT_H = 600;

export class Dropdown {
  private element: HTMLElement;
  private trigger: HTMLElement;
  private popover: HTMLElement;
  private labelEl: HTMLElement;
  private options: DropdownOption[] = [];
  private selectedId: string | null = null;
  private onChange?: (id: string) => void;
  private onStarToggle?: (id: string, isStarred: boolean) => void;
  private isOpen = false;
  private customTitle: string | null = null;
  private cachedDescPopoverEl?: HTMLElement;

  constructor(
    element: HTMLElement,
    onChange?: (id: string) => void,
    onStarToggle?: (id: string, isStarred: boolean) => void
  ) {
    this.element = element;
    this.onChange = onChange;
    this.onStarToggle = onStarToggle;
    this.trigger = element.querySelector(".dropdown-trigger")!;
    this.popover = element.querySelector(".dropdown-popover")!;
    this.labelEl = element.querySelector(".selected-label")!;
    this.trigger.addEventListener("click", () => {
      this.toggle();
    });

    // Close the popover when clicking outside the dropdown.
    this.element.ownerDocument.addEventListener("click", (e) => {
      if (this.isOpen && !this.element.contains(e.target as Node)) {
        this.close();
      }
    });

    // Prevent clicks inside the popover from bubbling to the document handler.
    this.popover.addEventListener("click", (e) => e.stopPropagation());
  }

  /**
   * Override the tooltip text (`acp-title`) shown on the root dropdown wrapper
   * element (`this.element`).
   * Pass `null` to revert to the default (selected option name).
   *
   * Note: `acp-title` is applied directly to `this.element` (the container),
   * and is automatically stripped while `this.isOpen` is true so it never
   * competes with open popovers or item-level hover descriptions.
   */
  setCustomTitle(title: string | null): void {
    this.customTitle = title;
    this.updateTitleAttribute();
  }

  private updateTitleAttribute(): void {
    if (this.isOpen) {
      this.element.removeAttribute("acp-title");
    } else {
      const option = this.options.find(
        (o) =>
          o.id === this.selectedId &&
          o.type !== "header" &&
          o.type !== "divider"
      );
      const fallbackTitle = option ? option.name : null;
      const titleToSet = this.customTitle || fallbackTitle;
      if (titleToSet) {
        this.element.setAttribute("acp-title", titleToSet);
      } else {
        this.element.removeAttribute("acp-title");
      }
    }
  }

  /**
   * Replace all options and optionally pre-select one.
   */
  setOptions(options: DropdownOption[], selectedId?: string): void {
    this.options = options;
    this.renderOptions();
    if (selectedId !== undefined) {
      this.select(selectedId, false);
    }
  }

  /**
   * Select an option by id.
   * @param triggerChange  Whether to fire the `onChange` callback.
   */
  select(id: string, triggerChange = true): void {
    const option = this.options.find(
      (o) => o.id === id && o.type !== "header" && o.type !== "divider"
    );
    if (!option) return;

    this.selectedId = id;
    this.labelEl.textContent = option.name;
    this.updateTitleAttribute();

    const items = this.popover.querySelectorAll(".dropdown-item");
    items.forEach((item) => {
      if (item.getAttribute("data-id") === id) {
        item.classList.add("selected");
      } else {
        item.classList.remove("selected");
      }
    });

    if (triggerChange && this.onChange) {
      this.onChange(id);
    }
  }

  /** Return the currently selected option id (or `null`). */
  getValue(): string | null {
    return this.selectedId;
  }

  /** Set the selected value without triggering `onChange`. */
  setValue(id: string): void {
    this.select(id, false);
  }

  /** Toggle the open / closed state. */
  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Open the popover and adjust its position. */
  open(): void {
    this.isOpen = true;
    this.element.classList.add("open");
    // Strip acp-title on the root wrapper so TooltipManager won't trigger while open
    this.updateTitleAttribute();
    // Force hide any active property tooltip immediately via TooltipManager single source of truth
    TooltipManager.hideActive(this.element.ownerDocument);
    this.adjustPosition();
  }

  /** Close the popover. */
  close(): void {
    this.isOpen = false;
    this.element.classList.remove("open");
    this.popover.style.left = "";
    // Restore acp-title on the root wrapper
    this.updateTitleAttribute();
    this.hideItemDescPopover();
  }

  /**
   * Get or create the cached floating DOM element for item-level descriptions.
   */
  private getItemDescPopover(): HTMLElement {
    if (this.cachedDescPopoverEl?.isConnected) {
      return this.cachedDescPopoverEl;
    }
    const doc = this.element.ownerDocument;
    let popover = doc.querySelector<HTMLElement>(
      ".acp-dropdown-item-desc-popover"
    );
    if (!popover) {
      popover = doc.createElement("div");
      popover.className = "acp-dropdown-item-desc-popover";
      doc.body.appendChild(popover);
    }
    this.cachedDescPopoverEl = popover;
    return popover;
  }

  /** Hide the floating item description popover if visible. */
  private hideItemDescPopover(): void {
    const popover = this.getItemDescPopover();
    popover.classList.remove("visible");
    popover.style.display = "none";
  }

  /**
   * Determine a single unified direction (left, right, above, below) for all
   * item description popovers within this open dropdown menu based on available space.
   */
  private getPreferredDescDirection(
    popoverRect: DOMRect,
    win: Window
  ): "left" | "right" | "above" | "below" | "none" {
    const windowWidth = win.innerWidth || DEFAULT_VIEWPORT_W;
    const windowHeight = win.innerHeight || DEFAULT_VIEWPORT_H;

    const leftSpace = popoverRect.left - VIEWPORT_PADDING_PX;
    const rightSpace = windowWidth - popoverRect.right - VIEWPORT_PADDING_PX;
    const topSpace = popoverRect.top - VIEWPORT_PADDING_PX;
    const bottomSpace = windowHeight - popoverRect.bottom - VIEWPORT_PADDING_PX;

    // Prefer side placement if either side has sufficient space
    if (Math.max(leftSpace, rightSpace) >= MIN_SIDE_AVAIL_PX) {
      return rightSpace >= leftSpace ? "right" : "left";
    }

    // Fallback to top or bottom if sides are restricted
    if (topSpace >= bottomSpace && topSpace >= 40) {
      return "above";
    }
    if (bottomSpace >= 40) {
      return "below";
    }

    return "none";
  }

  /** Compute maximum allowable width for description text wrapping. */
  private computeDescMaxWidth(
    dir: "left" | "right" | "above" | "below",
    dropdownPopoverRect: DOMRect,
    windowWidth: number
  ): number {
    if (dir === "right") {
      const maxAllowedWidth = Math.max(
        MIN_DESC_WIDTH_PX,
        windowWidth - dropdownPopoverRect.right - VIEWPORT_PADDING_PX - 12
      );
      return Math.min(MAX_DESC_WIDTH_PX, maxAllowedWidth);
    }
    if (dir === "left") {
      const maxAllowedWidth = Math.max(
        MIN_DESC_WIDTH_PX,
        dropdownPopoverRect.left - VIEWPORT_PADDING_PX - 12
      );
      return Math.min(MAX_DESC_WIDTH_PX, maxAllowedWidth);
    }
    return Math.min(MAX_DESC_WIDTH_PX, windowWidth - VIEWPORT_PADDING_PX * 2);
  }

  /** Compute un-clamped target coordinates for the description popover. */
  private computeDescTargetPos(
    dir: "left" | "right" | "above" | "below",
    descWidth: number,
    descHeight: number,
    itemRect: DOMRect,
    dropdownPopoverRect: DOMRect
  ): { targetLeft: number; targetTop: number } {
    switch (dir) {
      case "right":
        return {
          targetLeft: dropdownPopoverRect.right + SIDE_GAP_PX,
          targetTop: itemRect.top + (itemRect.height - descHeight) / 2,
        };
      case "left":
        return {
          targetLeft: dropdownPopoverRect.left - descWidth - SIDE_GAP_PX,
          targetTop: itemRect.top + (itemRect.height - descHeight) / 2,
        };
      case "above":
        return {
          targetLeft:
            dropdownPopoverRect.left +
            (dropdownPopoverRect.width - descWidth) / 2,
          targetTop: dropdownPopoverRect.top - descHeight - SIDE_GAP_PX,
        };
      case "below":
        return {
          targetLeft:
            dropdownPopoverRect.left +
            (dropdownPopoverRect.width - descWidth) / 2,
          targetTop: dropdownPopoverRect.bottom + SIDE_GAP_PX,
        };
    }
  }

  /**
   * Display a floating description popover next to the hovered option item.
   * Uses zero delay (0ms) on hover and guarantees no overlap with the dropdown.
   */
  private showItemDescPopover(itemEl: HTMLElement, description: string): void {
    const trimmed = description ? description.trim() : "";
    if (!trimmed || !this.isOpen) {
      this.hideItemDescPopover();
      return;
    }

    const popoverEl = this.getItemDescPopover();
    popoverEl.textContent = trimmed;

    const win = this.element.ownerDocument.defaultView || window;
    const windowWidth = win.innerWidth || DEFAULT_VIEWPORT_W;
    const windowHeight = win.innerHeight || DEFAULT_VIEWPORT_H;

    const dropdownPopoverRect = this.popover.getBoundingClientRect();
    const dir = this.getPreferredDescDirection(dropdownPopoverRect, win);

    if (dir === "none") {
      this.hideItemDescPopover();
      return;
    }

    // Set max-width dynamically so text wraps aggressively without overlapping the dropdown menu
    const maxWidthPx = this.computeDescMaxWidth(
      dir,
      dropdownPopoverRect,
      windowWidth
    );
    popoverEl.style.maxWidth = `${maxWidthPx}px`;

    // Position off-screen to measure actual rendered height and width after text wrapping
    popoverEl.style.display = "block";
    popoverEl.style.left = `${OFFSCREEN_MEASURE_POS_PX}px`;
    popoverEl.style.top = `${OFFSCREEN_MEASURE_POS_PX}px`;

    const descRect = popoverEl.getBoundingClientRect();
    const itemRect = itemEl.getBoundingClientRect();

    const descWidth = descRect.width;
    const descHeight = descRect.height;

    const { targetLeft: rawLeft, targetTop: rawTop } =
      this.computeDescTargetPos(
        dir,
        descWidth,
        descHeight,
        itemRect,
        dropdownPopoverRect
      );

    // Keep popover within window bounds
    let targetLeft = Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(rawLeft, windowWidth - descWidth - VIEWPORT_PADDING_PX)
    );
    let targetTop = Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(rawTop, windowHeight - descHeight - VIEWPORT_PADDING_PX)
    );

    // Strict non-overlapping boundary safety check
    if (
      dir === "right" &&
      targetLeft < dropdownPopoverRect.right + NON_OVERLAP_BUFFER_PX
    ) {
      targetLeft = dropdownPopoverRect.right + NON_OVERLAP_BUFFER_PX;
    } else if (
      dir === "left" &&
      targetLeft + descWidth > dropdownPopoverRect.left - NON_OVERLAP_BUFFER_PX
    ) {
      targetLeft = dropdownPopoverRect.left - descWidth - NON_OVERLAP_BUFFER_PX;
    }

    popoverEl.style.left = `${targetLeft}px`;
    popoverEl.style.top = `${targetTop}px`;
    popoverEl.classList.add("visible");
  }

  /**
   * Nudge the popover horizontally so it stays within the viewport.
   * Uses `requestAnimationFrame` to measure after the `open` class is applied.
   */
  private adjustPosition(): void {
    const popover = this.popover;
    const rect = this.element.getBoundingClientRect();
    const windowWidth =
      this.element.ownerDocument.defaultView?.innerWidth || window.innerWidth;
    const padding = 12;

    // Reset styles first
    popover.style.left = "0";

    const requestFrame =
      typeof this.element.ownerDocument.defaultView?.requestAnimationFrame ===
      "function"
        ? this.element.ownerDocument.defaultView.requestAnimationFrame.bind(
            this.element.ownerDocument.defaultView
          )
        : (callback: FrameRequestCallback) =>
            this.element.ownerDocument.defaultView?.setTimeout(
              () => callback(Date.now()),
              0
            ) ?? setTimeout(() => callback(Date.now()), 0);

    // Wait for next frame to get accurate width after 'open' class is added.
    requestFrame(() => {
      const popoverRect = popover.getBoundingClientRect();
      const rightEdge = rect.left + popoverRect.width;

      if (rightEdge > windowWidth - padding) {
        const offset = rightEdge - (windowWidth - padding);
        popover.style.left = `-${offset}px`;
      }

      // Check if it overflows the left edge after adjustment
      const newRect = popover.getBoundingClientRect();
      if (newRect.left < padding) {
        popover.style.left = `-${rect.left - padding}px`;
      }
    });
  }

  /**
   * Rebuild the popover DOM from `this.options`.
   * Renders headers, dividers, and selectable items (with optional star).
   */
  private renderOptions(): void {
    this.popover.innerHTML = "";
    this.options.forEach((opt) => {
      if (opt.type === "divider") {
        const divider = this.element.ownerDocument.createElement("div");
        divider.className = "dropdown-divider";
        this.popover.appendChild(divider);
        return;
      }

      if (opt.type === "header") {
        const header = this.element.ownerDocument.createElement("div");
        header.className = "dropdown-header";
        header.textContent = opt.name;
        this.popover.appendChild(header);
        return;
      }

      const item = this.element.ownerDocument.createElement("div");
      item.className = "dropdown-item";
      if (opt.id === this.selectedId) item.classList.add("selected");
      item.setAttribute("data-id", opt.id);

      let starHtml = "";
      if (opt.canStar) {
        const starIcon = opt.isStarred ? "star-full" : "star-empty";
        starHtml = `<span class="dropdown-item-star codicon codicon-${starIcon}" acp-title="${
          opt.isStarred ? "Unstar" : "Star"
        }"></span>`;
      }

      item.innerHTML = `
        <span class="dropdown-item-check codicon codicon-check"></span>
        <span class="dropdown-item-label">${escapeHtml(opt.name)}</span>
        ${starHtml}
      `;

      item.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains("dropdown-item-star")) {
          e.stopPropagation();
          if (this.onStarToggle) {
            this.onStarToggle(opt.id, !opt.isStarred);
          }
          return;
        }
        this.select(opt.id);
        this.close();
      });

      if (opt.description) {
        item.addEventListener("mouseenter", () => {
          this.showItemDescPopover(item, opt.description!);
        });
        item.addEventListener("mouseleave", () => {
          this.hideItemDescPopover();
        });
      } else {
        item.addEventListener("mouseenter", () => {
          this.hideItemDescPopover();
        });
      }

      this.popover.appendChild(item);
    });
  }
}
