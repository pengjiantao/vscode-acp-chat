import type { WebviewContext } from "../context";
import { BlockManager } from "../block/block-manager";

/**
 * Permission dialog widget.
 *
 * Displays a permission request UI either embedded inside a tool block or
 * as a modal overlay. The user can allow/reject the action once or always.
 *
 * Refactored to accept a {@link WebviewContext} instead of individual
 * dependencies.
 */
export class PermissionDialog {
  constructor(
    private ctx: WebviewContext,
    private getBlockManager: (toolCallId: string) => BlockManager | undefined,
    private getIsGenerating: () => boolean,
    private setGenerating: (value: boolean) => void,
    private scrollToBottom: () => void
  ) {}

  /**
   * Show a permission dialog for the given request.
   *
   * If `toolCallId` matches an existing tool block, the permission UI is
   * embedded inside that block. Otherwise a modal overlay is shown.
   */
  show(
    requestId: string,
    toolCall: { kind?: string; title?: string; description?: string },
    options: Array<{ optionId: string; kind: string; name: string }>,
    toolCallId?: string
  ): void {
    const wasGenerating = this.getIsGenerating();
    this.setGenerating(true);

    if (options.length === 0) {
      options.push({
        optionId: "cancel",
        kind: "reject_once",
        name: "Cancel (No options provided)",
      });
    }

    let targetContainer: HTMLElement | null = null;
    if (toolCallId) {
      const block = this.getBlockManager(toolCallId)?.getToolBlock(toolCallId);
      if (block) {
        targetContainer = block.contentEl;
      }
    }

    if (targetContainer) {
      this.renderEmbedded(
        targetContainer,
        requestId,
        toolCall,
        options,
        wasGenerating
      );
    } else {
      this.renderOverlay(requestId, toolCall, options, wasGenerating);
    }
  }

  private handleOptionClick(
    requestId: string,
    option: { optionId: string; kind: string },
    cleanup: () => void,
    wasGenerating: boolean
  ): void {
    const isReject = option.kind.startsWith("reject");
    const outcome = isReject
      ? { outcome: "cancelled" as const }
      : { outcome: "selected" as const, optionId: option.optionId };

    this.ctx.vscode.postMessage({
      type: "permissionResponse",
      requestId,
      outcome,
    });

    cleanup();
    this.setGenerating(wasGenerating);
  }

  private renderEmbedded(
    container: HTMLElement,
    requestId: string,
    toolCall: { kind?: string; title?: string; description?: string },
    options: Array<{ optionId: string; kind: string; name: string }>,
    wasGenerating: boolean
  ): void {
    const { doc } = this.ctx;
    const wrapper = doc.createElement("div");
    wrapper.className = "embedded-permission";

    const header = doc.createElement("div");
    header.className = "embedded-permission-header";
    header.innerHTML = `<span class="permission-icon codicon codicon-lock"></span> <span>Permission Required</span>`;

    const body = doc.createElement("div");
    body.className = "embedded-permission-body";

    if (toolCall.description) {
      const desc = doc.createElement("div");
      desc.className = "permission-tool-desc";
      desc.style.marginBottom = "8px";
      desc.textContent = toolCall.description;
      body.appendChild(desc);
    }

    const optionsContainer = doc.createElement("div");
    optionsContainer.className = "embedded-permission-options";

    options.forEach((opt) => {
      const btn = doc.createElement("button");
      const isAllow = !opt.kind.startsWith("reject");
      const isAlways = opt.kind.endsWith("always");

      btn.className = `embedded-permission-option ${
        isAllow
          ? "embedded-permission-option-allow"
          : "embedded-permission-option-reject"
      } ${isAlways ? "embedded-permission-option-always" : ""}`;

      const icon = doc.createElement("span");
      icon.className = "embedded-permission-option-icon";
      icon.innerHTML = isAllow
        ? '<div class="codicon codicon-check"></div>'
        : '<div class="codicon codicon-close"></div>';

      const text = doc.createElement("span");
      const label = this.getOptionLabel(opt.kind);
      text.textContent = `${label}: ${opt.name}`;

      btn.appendChild(icon);
      btn.appendChild(text);

      btn.addEventListener("click", () => {
        this.handleOptionClick(
          requestId,
          opt,
          () => wrapper.remove(),
          wasGenerating
        );
      });

      optionsContainer.appendChild(btn);
    });

    body.appendChild(optionsContainer);
    wrapper.appendChild(header);
    wrapper.appendChild(body);

    container.appendChild(wrapper);
    this.scrollToBottom();
  }

  private renderOverlay(
    requestId: string,
    toolCall: { kind?: string; title?: string; description?: string },
    options: Array<{ optionId: string; kind: string; name: string }>,
    wasGenerating: boolean
  ): void {
    const { doc } = this.ctx;
    const overlay = doc.createElement("div");
    overlay.className = "permission-dialog-overlay";

    const dialog = doc.createElement("div");
    dialog.className = "permission-dialog";

    const header = doc.createElement("div");
    header.className = "permission-dialog-header";
    header.innerHTML = `
      <span class="permission-icon codicon codicon-lock"></span>
      <span>Permission Required</span>
    `;

    const body = doc.createElement("div");
    body.className = "permission-dialog-body";

    const info = doc.createElement("div");
    info.className = "permission-tool-info";

    const kind = doc.createElement("div");
    kind.className = "permission-tool-kind";
    kind.textContent = toolCall.kind || "Unknown";

    const title = doc.createElement("div");
    title.className = "permission-tool-title";
    title.textContent = toolCall.title || "Tool Call";

    info.appendChild(kind);
    info.appendChild(title);

    if (toolCall.description) {
      const desc = doc.createElement("div");
      desc.className = "permission-tool-desc";
      desc.textContent = toolCall.description;
      info.appendChild(desc);
    }

    const optionsContainer = doc.createElement("div");
    optionsContainer.className = "permission-options";

    options.forEach((opt) => {
      const btn = doc.createElement("button");
      btn.className = `permission-option-btn permission-option-${opt.kind}`;

      const label = this.getOptionLabel(opt.kind);
      btn.textContent = `${label}: ${opt.name}`;

      btn.addEventListener("click", () => {
        this.handleOptionClick(
          requestId,
          opt,
          () => overlay.remove(),
          wasGenerating
        );
      });

      optionsContainer.appendChild(btn);
    });

    body.appendChild(info);
    body.appendChild(optionsContainer);

    dialog.appendChild(header);
    dialog.appendChild(body);
    overlay.appendChild(dialog);

    doc.body.appendChild(overlay);
  }

  private getOptionLabel(kind: string): string {
    const labels: Record<string, string> = {
      allow_once: "Allow Once",
      allow_always: "Always Allow",
      reject_once: "Reject Once",
      reject_always: "Always Reject",
    };
    return labels[kind] || kind;
  }
}
