import type { WebviewContext } from "../context";

/**
 * Renders the floating action buttons (copy, copy-to-input, scroll-to-top,
 * scroll-to-user) for a focused text block. The container is a child of the
 * focused block and is positioned outside its top-right corner via CSS.
 */
export class BlockActionsComponent {
  constructor(private ctx: WebviewContext) {}

  /**
   * Render action buttons into a focused text block. Returns the actions
   * container, reusing it if already present.
   */
  render(
    blockEl: HTMLElement,
    callbacks: {
      onCopyToInput: (text: string) => void;
      scrollToTop: () => void;
      scrollToPreviousUserMessage: (el: HTMLElement) => void;
    }
  ): HTMLElement {
    const existing = blockEl.querySelector(
      ".block-actions"
    ) as HTMLElement | null;
    if (existing) return existing;

    const { doc } = this.ctx;
    const actionsContainer = doc.createElement("div");
    actionsContainer.className = "block-actions";

    const getBlockText = (): string => {
      return (
        blockEl.getAttribute("data-raw-content") || blockEl.innerText || ""
      );
    };

    // Copy Button
    const copyBtn = this.createButton("copy", "Copy response", async () => {
      const text = getBlockText();
      if (text) {
        try {
          await navigator.clipboard.writeText(text);
          this.flashCheck(copyBtn);
        } catch (err) {
          console.error("Failed to copy:", err);
        }
      }
    });

    // Paste to Input Button
    const pasteBtn = this.createButton("edit", "Copy to input", () => {
      const text = getBlockText();
      if (text) {
        callbacks.onCopyToInput(text);
      }
    });

    // Scroll to Top Button
    const topBtn = this.createButton("arrow-up", "Scroll to top", () => {
      callbacks.scrollToTop();
    });

    // Scroll to Recent User Input Button
    const userBtn = this.createButton(
      "reply",
      "Scroll to user question",
      () => {
        const messageEl = blockEl.closest(".message") as HTMLElement | null;
        if (messageEl) {
          callbacks.scrollToPreviousUserMessage(messageEl);
        }
      }
    );

    actionsContainer.appendChild(copyBtn);
    actionsContainer.appendChild(pasteBtn);
    actionsContainer.appendChild(topBtn);
    actionsContainer.appendChild(userBtn);

    blockEl.appendChild(actionsContainer);
    return actionsContainer;
  }

  private createButton(
    icon: string,
    title: string,
    onClick: () => void
  ): HTMLButtonElement {
    const { doc } = this.ctx;
    const btn = doc.createElement("button");
    btn.className = "action-btn";
    btn.setAttribute("acp-title", title);
    const iconEl = doc.createElement("span");
    iconEl.className = `codicon codicon-${icon}`;
    btn.appendChild(iconEl);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  private flashCheck(btn: HTMLButtonElement): void {
    const iconEl = btn.querySelector(".codicon") as HTMLElement;
    if (!iconEl) return;
    const originalClass = iconEl.className;
    iconEl.className = "codicon codicon-check";
    setTimeout(() => {
      iconEl.className = originalClass;
    }, 1500);
  }
}
