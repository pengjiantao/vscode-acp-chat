import type { InputPanelElements, Mention, ExtensionMessage } from "../types";
import type { WebviewContext } from "../context";
import type { MessageHandler } from "../message-router";
import { ChipRendererComponent } from "./chip-renderer";
import { AutocompleteComponent } from "./autocomplete";
import { getRequiredElement } from "../widget/dom";

type PasteEventLike = {
  clipboardData?: {
    items: Array<{ type: string; getAsFile?: () => File | null }>;
    getData: (type: string) => string;
  };
  preventDefault: () => void;
};

/**
 * Owns the rich input surface, nearby controls, and autocomplete.
 *
 * Implements {@link MessageHandler} to self-register for `addMention`
 * messages. Owns an {@link AutocompleteComponent} which independently
 * registers for `fileSearchResults`.
 */
export class InputPanelComponent implements MessageHandler {
  readonly elements: InputPanelElements;
  readonly chipRenderer: ChipRendererComponent;
  readonly autocomplete: AutocompleteComponent;

  private isGenerating = false;

  constructor(
    private ctx: WebviewContext,
    options?: {
      elements?: InputPanelElements;
      chipRenderer?: ChipRendererComponent;
    }
  ) {
    this.chipRenderer = options?.chipRenderer ?? new ChipRendererComponent(ctx);

    this.elements = options?.elements ?? {
      inputEl: getRequiredElement(ctx.doc, "input"),
      commandAutocomplete: getRequiredElement(ctx.doc, "command-autocomplete"),
      attachImageBtn: getRequiredElement<HTMLButtonElement>(
        ctx.doc,
        "attach-image"
      ),
      imagePreviewPopover: getRequiredElement(ctx.doc, "image-preview-popover"),
      sendBtn: getRequiredElement<HTMLButtonElement>(ctx.doc, "send"),
      stopBtn: getRequiredElement<HTMLButtonElement>(ctx.doc, "stop"),
      toolbar: {
        modeDropdown: getRequiredElement(ctx.doc, "mode-dropdown"),
        modelDropdown: getRequiredElement(ctx.doc, "model-dropdown"),
        configOptionsContainer: getRequiredElement(
          ctx.doc,
          "config-options-container"
        ),
        contextUsageRing: getRequiredElement<HTMLDivElement>(
          ctx.doc,
          "context-usage-ring"
        ),
      },
    };

    this.autocomplete = new AutocompleteComponent(
      ctx,
      {
        inputEl: this.elements.inputEl,
        commandAutocomplete: this.elements.commandAutocomplete,
      },
      (result) => this.handleAutocompleteSelection(result)
    );

    // Register for addMention messages.
    ctx.messageRouter.register("addMention", this);

    this.setupEventListeners();
    this.restoreState();
  }

  // -------------------------------------------------------------------
  // MessageHandler
  // -------------------------------------------------------------------

  handleMessage(msg: ExtensionMessage): boolean | void {
    if (msg.type === "addMention" && msg.mention) {
      this.insertMentionChip(msg.mention);
      return;
    }
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  /** Set the available commands (forwarded to autocomplete). */
  setAvailableCommands(commands: import("../types").AvailableCommand[]): void {
    this.autocomplete.setAvailableCommands(commands);
  }

  updateInputState(): void {
    const text = this.elements.inputEl.textContent?.trim() || "";
    const hasMentions =
      this.elements.inputEl.querySelectorAll(".mention-chip").length > 0;

    let hoveredImageChip = this.chipRenderer.getHoveredImageChip();
    if (hoveredImageChip && !this.elements.inputEl.contains(hoveredImageChip)) {
      hoveredImageChip = null;
      this.chipRenderer.clearHoveredImageChip();
      this.chipRenderer.hideImagePreview();
    }

    // Preserve the CSS :empty placeholder behavior
    if (!text && !hasMentions && this.elements.inputEl.innerHTML !== "") {
      this.elements.inputEl.innerHTML = "";
    }

    this.elements.sendBtn.disabled =
      (!text && !hasMentions) || this.isGenerating;
  }

  setPlaceholder(agentName: string): void {
    const placeholder = `Ask ${agentName.toLowerCase()}... (type / for commands, @ for files)`;
    this.elements.inputEl.setAttribute("data-placeholder", placeholder);
  }

  adjustHeight(): void {
    const { inputEl } = this.elements;
    const scrollTop = inputEl.scrollTop;
    inputEl.style.height = "auto";
    const maxHeight = (this.ctx.win?.innerHeight ?? window.innerHeight) / 3;
    const scrollHeight = inputEl.scrollHeight;
    const newHeight = Math.max(52, Math.min(scrollHeight, maxHeight));
    inputEl.style.height = newHeight + "px";
    inputEl.style.overflowY =
      scrollHeight > maxHeight - 1 ? "overlay" : "hidden";
    inputEl.scrollTop = scrollTop;
  }

  saveInputState(): { html: string } {
    return { html: this.elements.inputEl.innerHTML };
  }

  restoreInputState(state?: { html: string }): void {
    this.elements.inputEl.innerHTML = state?.html || "";
    this.adjustHeight();
    this.updateInputState();
  }

  handlePaste(event: PasteEventLike, onImage: (file: File) => void): boolean {
    const items = event.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          event.preventDefault();
          const blob = item.getAsFile?.();
          if (blob) onImage(blob);
          return false;
        }
      }
    }

    event.preventDefault();
    const plainText = event.clipboardData?.getData("text/plain") ?? "";
    const selection = this.ctx.win?.getSelection();
    if (!selection || selection.rangeCount === 0) return false;

    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = this.ctx.doc.createTextNode(plainText);
    range.insertNode(textNode);
    range.setStart(textNode, textNode.length);
    range.setEnd(textNode, textNode.length);
    selection.removeAllRanges();
    selection.addRange(range);
    this.adjustHeight();
    return true;
  }

  handleImageAttachment(
    file: File,
    onMentionReady: (mention: Mention) => void
  ): void {
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      onMentionReady({
        name: file.name,
        type: "image",
        dataUrl: base64,
      });
    };
    reader.readAsDataURL(file);
  }

  getSessionContext?: () => { sessionId?: string; agentId?: string };

  setGenerating(isGenerating: boolean): void {
    this.isGenerating = isGenerating;
    this.elements.sendBtn.style.display = isGenerating ? "none" : "flex";
    this.elements.stopBtn.style.display = isGenerating ? "flex" : "none";
  }

  getIsGenerating(): boolean {
    return this.isGenerating;
  }

  send(): void {
    if (this.isGenerating) return;

    const msg = this.collectMessage();
    if (!msg) return;

    const sessionCtx = this.getSessionContext?.() || {};

    this.ctx.vscode.postMessage({
      type: "sendMessage",
      text: msg.text,
      images: msg.images,
      mentions: msg.mentions,
      sessionId: sessionCtx.sessionId,
      agentId: sessionCtx.agentId,
    });

    this.clearInput();
    this.updateInputState();

    this.ctx.eventBus.emit("messageSent", {
      text: msg.text,
      images: msg.images,
      mentions: msg.mentions,
    });
  }

  clearInput(): void {
    this.elements.inputEl.innerHTML = "";
    this.adjustHeight();
    this.focus();
    this.autocomplete.hide();
    // Hide image preview
    const popover = this.ctx.doc.getElementById("image-preview-popover");
    if (popover) popover.style.display = "none";
    this.saveState();
  }

  setTextAndFocus(text: string): void {
    this.elements.inputEl.textContent = text;
    this.adjustHeight();
    this.focus();

    const range = this.ctx.doc.createRange();
    const selection = this.ctx.win?.getSelection();
    range.selectNodeContents(this.elements.inputEl);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  focus(): void {
    this.elements.inputEl.focus();
  }

  /**
   * Insert a mention chip at the current cursor position (or autocomplete
   * trigger position if autocomplete is active).
   */
  insertMentionChip(mention: Mention): void {
    const chip = this.chipRenderer.renderMentionChip(mention, false);
    if (!this.insertChipElement(chip)) return;

    this.adjustHeight();
    this.updateInputState();
  }

  /**
   * Insert a command chip at the current cursor position.
   */
  insertCommandChip(command: string, description?: string): void {
    const chip = this.chipRenderer.renderCommandChip(
      command,
      description,
      false
    );
    if (!this.insertChipElement(chip)) return;

    this.updateInputState();
  }

  /**
   * Parse the input element DOM and return structured message data.
   * Extracts mentions, images, commands, and text from the contenteditable
   * input surface.
   */
  collectMessage(): {
    text: string;
    images: string[];
    mentions: Mention[];
  } | null {
    const inputEl = this.elements.inputEl;
    const mentions: Mention[] = [];
    const images: string[] = [];
    let text = "";

    inputEl.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.classList.contains("mention-chip")) {
          const mention = this.parseMentionFromChip(el);
          const type = mention.type;
          const dataUrl = mention.dataUrl;

          if (type === "image" && dataUrl) {
            images.push(dataUrl);
          }

          const idx = mentions.length;
          mentions.push(mention);
          text += `__MENTION_${idx}__`;
        } else if (el.classList.contains("command-chip")) {
          text += el.dataset.command || "";
        } else if (el.tagName === "BR") {
          text += "\n";
        } else {
          text += el.textContent;
        }
      }
    });

    text = text.trim();
    if (!text && images.length === 0) return null;

    return { text, images, mentions };
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  private parseMentionFromChip(el: HTMLElement): Mention {
    return {
      name: el.dataset.name || "",
      path: el.dataset.path,
      type: el.dataset.type as Mention["type"],
      content: el.dataset.content,
      dataUrl: el.dataset.dataUrl,
      range: el.dataset.range
        ? {
            startLine: parseInt(el.dataset.range.split("-")[0], 10),
            endLine: parseInt(el.dataset.range.split("-")[1], 10),
          }
        : undefined,
    };
  }

  private restoreState(): void {
    const previousState = this.ctx.stateService.restore();
    if (!previousState?.inputValue) return;

    this.elements.inputEl.innerHTML = previousState.inputValue;
    const chips = Array.from(
      this.elements.inputEl.querySelectorAll(".mention-chip")
    );
    chips.forEach((chip) => {
      const c = chip as HTMLElement;
      const mention = this.parseMentionFromChip(c);
      const newChip = this.chipRenderer.renderMentionChip(mention, false);
      c.replaceWith(newChip);
    });
  }

  private saveState(): void {
    this.ctx.stateService.update(
      "inputValue",
      this.elements.inputEl.innerHTML || ""
    );
  }

  private handleAutocompleteSelection(result: string | Mention): void {
    if (typeof result === "string") {
      this.insertCommandChip(result);
    } else {
      this.insertMentionChip(result);
    }
    this.saveState();
    this.updateInputState();
  }

  private setupEventListeners(): void {
    const { sendBtn, stopBtn, inputEl } = this.elements;

    sendBtn.addEventListener("click", () => this.send());
    stopBtn.addEventListener("click", () => {
      const sessionCtx = this.getSessionContext?.() || {};
      this.ctx.vscode.postMessage({
        type: "stop",
        sessionId: sessionCtx.sessionId,
        agentId: sessionCtx.agentId,
      });
    });

    inputEl.addEventListener("keydown", (e) => {
      // Let autocomplete handle keys first
      if (this.autocomplete.handleKeyDown(e)) {
        // If Enter/Tab was pressed with a selection, insert the chip
        if (
          (e.key === "Tab" || e.key === "Enter") &&
          this.autocomplete.isActive()
        ) {
          const result = this.autocomplete.selectCurrent();
          if (result) {
            this.handleAutocompleteSelection(result);
          }
        }
        return;
      }

      if (e.key === "Enter" && !e.shiftKey && !this.getIsGenerating()) {
        e.preventDefault();
        this.send();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.clearInput();
        this.autocomplete.hide();
        this.updateInputState();
      }
    });

    inputEl.addEventListener("input", () => {
      this.adjustHeight();
      this.autocomplete.update();
      this.saveState();
      this.updateInputState();
    });

    inputEl.addEventListener("paste", (e) => {
      const insertedText = this.handlePaste(
        e as unknown as Parameters<typeof this.handlePaste>[0],
        (file) =>
          this.handleImageAttachment(file, (mention) =>
            this.insertMentionChip(mention)
          )
      );
      if (!insertedText) return;
      this.autocomplete.update();
      this.saveState();
      this.updateInputState();
    });

    this.setupAttachImageButton();
  }

  private setupAttachImageButton(): void {
    this.elements.attachImageBtn.addEventListener("click", () => {
      const input = this.ctx.doc.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.onchange = () => {
        if (input.files) {
          Array.from(input.files).forEach((file) => {
            this.handleImageAttachment(file, (mention) =>
              this.insertMentionChip(mention)
            );
          });
        }
      };
      input.click();
    });
  }

  private getNodeAtOffset(
    parent: Node,
    offset: number
  ): { node: Node; offset: number } {
    const walker = this.ctx.doc.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
    let currentOffset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const length = node.textContent?.length || 0;
      if (currentOffset + length >= offset) {
        return { node, offset: offset - currentOffset };
      }
      currentOffset += length;
    }
    return { node: parent, offset: 0 };
  }

  private insertChipElement(chip: HTMLElement): boolean {
    const { win, doc } = this.ctx;
    const replacementTriggerPos =
      this.autocomplete.consumeReplacementTriggerPos();
    const selection = win.getSelection();
    if (!selection) return false;

    const range = this.getChipInsertionRange(selection, replacementTriggerPos);
    range.insertNode(chip);

    const space = doc.createTextNode(" ");
    range.setStartAfter(chip);
    range.insertNode(space);

    const selectionAfter = win.getSelection();
    if (selectionAfter) {
      const newRange = doc.createRange();
      newRange.setStart(space, space.length);
      newRange.collapse(true);
      if (typeof selectionAfter.removeAllRanges === "function") {
        selectionAfter.removeAllRanges();
        selectionAfter.addRange(newRange);
      } else if (typeof selectionAfter.collapseToEnd === "function") {
        selectionAfter.collapseToEnd();
      }
    }

    this.elements.inputEl.focus();
    return true;
  }

  private getChipInsertionRange(
    selection: Selection,
    replacementTriggerPos: number
  ): Range {
    const { win, doc } = this.ctx;
    const autocompleteTriggerPos =
      replacementTriggerPos >= 0
        ? replacementTriggerPos
        : this.autocomplete.isActive()
          ? this.autocomplete.getTriggerPos()
          : -1;

    if (autocompleteTriggerPos >= 0 && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      this.deleteAutocompleteQuery(range, autocompleteTriggerPos);
      return range;
    }

    this.elements.inputEl.focus();
    const currentSelection = win.getSelection();
    if (!currentSelection || currentSelection.rangeCount === 0) {
      const range = doc.createRange();
      range.selectNodeContents(this.elements.inputEl);
      range.collapse(false);
      return range;
    }

    return currentSelection.getRangeAt(0);
  }

  private deleteAutocompleteQuery(range: Range, triggerPos: number): void {
    const { win } = this.ctx;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const startNode = range.startContainer instanceof (win as any).Node;
    if (startNode) {
      const { node, offset } = this.getNodeAtOffset(
        this.elements.inputEl,
        triggerPos
      );
      range.setStart(node, offset);
    } else {
      range.setStart(range.startContainer, triggerPos);
    }
    range.deleteContents();
  }
}
