import type {
  AvailableCommand,
  ExtensionMessage,
  Mention,
  MessageListElements,
  Tool,
} from "../types";
import type { WebviewContext } from "../context";
import type { MessageHandler } from "../message-router";
import { ChipRendererComponent } from "./chip-renderer";
import { BlockManager } from "../block/block-manager";
import { TextBlock } from "../block/text-block";
import { ToolBlock } from "../block/tool-block";
import { BlockActionsComponent } from "./block-actions";
import { ScrollFadeController } from "../widget/scroll-fade";
import { getRequiredElement } from "../widget/dom";

const NESTED_SCROLL_SELECTOR =
  ".diff-content, .tool-output, .diff-summary-list, .detail-input, .thought-content";

type MessageType = "user" | "assistant" | "error" | "system";

/**
 * One streaming assistant message. Each distinct ACP `messageId` owns a
 * message element and an independent {@link BlockManager}, so interleaved
 * streams (e.g. concurrent subagents) never share blocks.
 */
type MessageStream = {
  messageId: string;
  messageEl: HTMLElement;
  blockManager: BlockManager;
};

/**
 * Owns the chat transcript surface: message DOM, streaming block lifecycle,
 * list-level event delegation, keyboard navigation, and auto-scroll state.
 *
 * Implements {@link MessageHandler} to self-register for all streaming and
 * message-related extension messages. Each active assistant message is a
 * {@link MessageStream} keyed by its ACP `messageId`; {@link BlockManager}s
 * are owned per stream.
 */
export class MessageListComponent implements MessageHandler {
  readonly elements: MessageListElements;
  private blockActions: BlockActionsComponent;
  private chipRenderer: ChipRendererComponent;
  private streams = new Map<string, MessageStream>();
  private currentStreamId: string | null = null;
  private focusedBlockEl: HTMLElement | null = null;

  private scrollFade: ScrollFadeController;

  private availableCommands: AvailableCommand[] = [];
  private isGenerating = false;

  /** Callback invoked when generation state changes. */
  onGeneratingChange?: (isGenerating: boolean) => void;

  /** Callback for "copy to input" action button. */
  onCopyToInput?: (text: string) => void;

  constructor(
    private ctx: WebviewContext,
    options?: {
      elements?: MessageListElements;
      chipRenderer: ChipRendererComponent;
    }
  ) {
    this.elements = options?.elements ?? {
      containerEl: getRequiredElement(ctx.doc, "messages-container"),
      messagesEl: getRequiredElement(ctx.doc, "messages"),
      typingIndicatorEl: getRequiredElement(ctx.doc, "typing-indicator"),
      welcomeView: getRequiredElement(ctx.doc, "welcome-view"),
    };

    this.chipRenderer = options?.chipRenderer ?? new ChipRendererComponent(ctx);
    this.blockActions = new BlockActionsComponent(ctx);

    this.scrollFade = new ScrollFadeController(
      ctx.doc,
      this.elements.messagesEl,
      {
        fill: true,
        paintBump: true,
        nestedScrollSelector: NESTED_SCROLL_SELECTOR,
      }
    );

    // Register for all streaming and message-related messages.
    ctx.messageRouter.registerMany(
      [
        "userMessage",
        "streamStart",
        "streamChunk",
        "streamEnd",
        "thoughtChunk",
        "toolCallStart",
        "toolCallComplete",
      ],
      this
    );

    // Scroll to bottom when a user message is sent.
    ctx.eventBus.on("messageSent", () => {
      this.scrollToBottom(true);
    });
  }

  // -------------------------------------------------------------------
  // MessageHandler
  // -------------------------------------------------------------------

  handleMessage(msg: ExtensionMessage): boolean | void {
    switch (msg.type) {
      case "userMessage":
        return this.handleUserMessage(msg);
      case "streamStart":
        return this.handleStreamStart();
      case "streamChunk":
        return this.handleStreamChunk(msg);
      case "streamEnd":
        return this.handleStreamEnd();
      case "thoughtChunk":
        return this.handleThoughtChunk(msg);
      case "toolCallStart":
        return this.handleToolCallStart(msg);
      case "toolCallComplete":
        return this.handleToolCallComplete(msg);
    }
  }

  // -------------------------------------------------------------------
  // Message handlers (moved from controller)
  // -------------------------------------------------------------------

  private handleUserMessage(msg: ExtensionMessage): void {
    // Always reset assistant state before a new turn
    this.resetStreams();

    if (msg.text || (msg.images && msg.images.length > 0)) {
      this.addMessage(msg.text || "", "user", msg.mentions);
    }
  }

  private handleStreamStart(): void {
    this.resetStreams();
    this.setGenerating(true);
  }

  private handleStreamChunk(msg: ExtensionMessage): void {
    if (!msg.text) return;
    const stream = this.ensureStream(msg.messageId ?? null);
    const block = stream.blockManager.ensureBlock(
      "text",
      stream.messageEl,
      this.elements.typingIndicatorEl
    ) as TextBlock;
    block.appendContent(msg.text);
    this.scrollToBottom();
  }

  private handleStreamEnd(): void {
    // streamEnd is turn-scoped: finalize every active stream. Action buttons
    // are no longer rendered automatically; they appear on demand when a text
    // block is double-clicked (see setupBlockFocusHandler).
    this.finalizeAllStreams();
    this.setGenerating(false);
    // Chunks after streamEnd (without a new streamStart) begin a fresh
    // message rather than appending to the last.
    this.currentStreamId = null;
    this.scrollToBottom();
  }

  private handleThoughtChunk(msg: ExtensionMessage): void {
    if (!msg.text) return;
    const stream = this.ensureStream(msg.messageId ?? null);
    const block = stream.blockManager.ensureBlock(
      "thought",
      stream.messageEl,
      this.elements.typingIndicatorEl
    );
    block.appendContent(msg.text);
    this.scrollToBottom();
  }

  private handleToolCallStart(msg: ExtensionMessage): void {
    if (!msg.toolCallId || !msg.name) return;
    // Tool calls carry no ACP messageId; reuse an existing block across
    // streams (current stream may have switched mid-tool), else attach to
    // the most recent stream.
    const stream =
      this.getToolBlockStream(msg.toolCallId) ??
      this.ensureStream(this.currentStreamId);
    this.applyToolCallStart(
      stream.blockManager.ensureToolBlock(
        msg.toolCallId,
        stream.messageEl,
        this.elements.typingIndicatorEl
      ),
      msg
    );
    this.scrollToBottom();
  }

  /**
   * Apply a tool_call start to a tool block. The guard is the type-narrowing
   * mechanism for the optional `ExtensionMessage` fields (property narrowing
   * does not flow into whole-object assignability at the call site).
   */
  private applyToolCallStart(block: ToolBlock, msg: ExtensionMessage): void {
    if (!msg.toolCallId || !msg.name) return;
    if (msg.kind) block.kind = msg.kind;
    if (msg.name) block.title = msg.name;

    block.updateSummary({
      toolCallId: msg.toolCallId,
      title: msg.name || block.title || "Tool",
      kind: msg.kind,
      status: "in_progress",
      rawInput: msg.rawInput,
    });
  }

  private handleToolCallComplete(msg: ExtensionMessage): void {
    if (!msg.toolCallId) return;
    const stream =
      this.getToolBlockStream(msg.toolCallId) ??
      this.ensureStream(this.currentStreamId);
    const block = stream.blockManager.ensureToolBlock(
      msg.toolCallId,
      stream.messageEl,
      this.elements.typingIndicatorEl
    );
    if (block) {
      if (msg.kind) block.kind = msg.kind;
      if (msg.title) block.title = msg.title;
      if (msg.status) block.status = msg.status;

      const finalTitle = msg.title || block.title || block.toolId || "Tool";

      block.removeSpinner();

      block.updateSummary({
        toolCallId: msg.toolCallId,
        title: finalTitle,
        kind: msg.kind || block.kind,
        status: msg.status || "completed",
        locations: msg.locations,
        rawInput: msg.rawInput,
        duration: msg.duration,
      });

      if (msg.status === "failed") {
        block.markFailed();
      }

      block.updateDetails({
        toolCallId: msg.toolCallId,
        title: finalTitle,
        kind: msg.kind || block.kind,
        status: msg.status || "completed",
        locations: msg.locations,
        rawInput: msg.rawInput,
        rawOutput: msg.rawOutput,
        content: msg.content,
        duration: msg.duration,
        terminalOutput: msg.terminalOutput,
      });

      stream.blockManager.finalizeBlock(block);
      this.scrollToBottom();
    }
  }

  // -------------------------------------------------------------------
  // Assistant message management
  // -------------------------------------------------------------------

  /**
   * Ensure the current assistant message element exists. Creates a new
   * empty assistant message if needed.
   * Public so the controller can create assistant messages for block
   * operations like showThinking.
   */
  ensureAssistantMessage(): HTMLElement {
    const stream = this.ensureStream(this.currentStreamId);
    if (this.elements.typingIndicatorEl.classList.contains("visible")) {
      stream.messageEl.appendChild(this.elements.typingIndicatorEl);
    }
    return stream.messageEl;
  }

  // -------------------------------------------------------------------
  // Public API (used by controller and other components)
  // -------------------------------------------------------------------

  /** Set the available commands for mention/command rendering. */
  setAvailableCommands(commands: AvailableCommand[]): void {
    this.availableCommands = commands;
  }

  /**
   * Return the block manager for the current stream. If no stream is active
   * yet, one is created (which appends an empty assistant message element).
   */
  getBlockManager(): BlockManager {
    return this.ensureStream(this.currentStreamId).blockManager;
  }

  /** Locate the stream owning a tool call id (active stream first). */
  private getToolBlockStream(toolCallId: string): MessageStream | undefined {
    if (this.currentStreamId !== null) {
      const current = this.streams.get(this.currentStreamId);
      if (current?.blockManager.getToolBlock(toolCallId)) {
        return current;
      }
    }
    for (const stream of this.streams.values()) {
      if (stream.blockManager.getToolBlock(toolCallId)) {
        return stream;
      }
    }
    return undefined;
  }

  /**
   * Resolve the block manager owning a tool call id, scanning the active
   * stream first, then all streams. Used by the permission dialog so
   * embedded permissions find tool blocks across concurrent streams.
   */
  getToolBlockManager(toolCallId: string): BlockManager | undefined {
    return this.getToolBlockStream(toolCallId)?.blockManager;
  }

  /** Aggregate tool snapshots across all active streams. */
  getToolsSnapshot(): Record<string, Tool> {
    const tools: Record<string, Tool> = {};
    for (const stream of this.streams.values()) {
      Object.assign(tools, stream.blockManager.getToolsSnapshot());
    }
    return tools;
  }

  // -------------------------------------------------------------------
  // Stream lifecycle
  // -------------------------------------------------------------------

  /**
   * Get or create the stream for an ACP `messageId`. A new messageId starts
   * a new assistant message and finalizes the previous stream, so interleaved
   * streams never share blocks. An empty or absent messageId continues the
   * current stream (backward-compatible fallback).
   */
  private ensureStream(messageId: string | null): MessageStream {
    if (messageId !== null && messageId !== "") {
      const existing = this.streams.get(messageId);
      if (existing) {
        this.currentStreamId = messageId;
        return existing;
      }
      if (this.currentStreamId !== null) {
        this.finalizeStream(this.currentStreamId);
      }
      return this.createStream(messageId);
    }

    if (this.currentStreamId !== null) {
      const current = this.streams.get(this.currentStreamId);
      if (current) return current;
    }
    return this.createStream("");
  }

  private createStream(messageId: string): MessageStream {
    const messageEl = this.addMessage("", "assistant");
    if (this.elements.typingIndicatorEl.classList.contains("visible")) {
      messageEl.appendChild(this.elements.typingIndicatorEl);
    }
    const stream: MessageStream = {
      messageId,
      messageEl,
      blockManager: new BlockManager(this.ctx),
    };
    this.streams.set(messageId, stream);
    this.currentStreamId = messageId;
    return stream;
  }

  /**
   * Finalize a stream: collapse its blocks. The stream stays tracked (and
   * DOM) until the next turn resets, so resumed chunks and getTools()
   * lookups keep working.
   */
  private finalizeStream(streamId: string): void {
    const stream = this.streams.get(streamId);
    if (!stream) return;
    stream.blockManager.finalizeAll();
  }

  /**
   * Turn-end finalize: clear stale tool spinners first (only here, so a
   * running tool in one stream is not marked completed merely because
   * another stream started), then finalize every stream.
   */
  private finalizeAllStreams(): void {
    for (const id of Array.from(this.streams.keys())) {
      const stream = this.streams.get(id);
      if (!stream) continue;
      stream.blockManager.clearStaleRunningToolIndicators();
      this.finalizeStream(id);
    }
  }

  private resetStreams(): void {
    this.dismissBlockFocus();
    this.streams.clear();
    this.currentStreamId = null;
  }

  /** Return the generation state. */
  getIsGenerating(): boolean {
    return this.isGenerating;
  }

  addMessage(
    text: string,
    type: MessageType,
    mentions?: Mention[]
  ): HTMLElement {
    const { doc } = this.ctx;
    const messageEl = doc.createElement("div");
    messageEl.className = "message " + type;
    messageEl.setAttribute("role", "article");
    messageEl.setAttribute("tabindex", "0");

    const label =
      type === "user"
        ? "Your message"
        : type === "assistant"
          ? "Agent response"
          : type === "error"
            ? "Error message"
            : "System message";
    messageEl.setAttribute("aria-label", label);

    if (text) {
      messageEl.appendChild(this.renderMessageText(text, type, mentions));
    }

    this.elements.messagesEl.appendChild(messageEl);
    this.scrollToBottom(type === "user");

    if (text) {
      this.announceToScreenReader(label + ": " + text.substring(0, 100));
    }

    this.updateViewState();
    return messageEl;
  }

  updateViewState(): void {
    const hasMessages = this.elements.messagesEl.children.length > 0;
    this.elements.welcomeView.style.display = !hasMessages ? "flex" : "none";
    this.elements.containerEl.style.display = hasMessages ? "flex" : "none";
  }

  clear(): void {
    this.elements.messagesEl.innerHTML = "";
    this.resetStreams();
    this.updateViewState();
  }

  showTypingIndicator(): void {
    this.elements.typingIndicatorEl.classList.add("visible");
    const stream =
      this.currentStreamId !== null
        ? this.streams.get(this.currentStreamId)
        : undefined;
    if (stream) {
      stream.messageEl.appendChild(this.elements.typingIndicatorEl);
    } else {
      this.elements.messagesEl.appendChild(this.elements.typingIndicatorEl);
    }
  }

  hideTypingIndicator(): void {
    this.elements.typingIndicatorEl.classList.remove("visible");
  }

  scrollToBottom(force = false): void {
    this.scrollFade.scrollToBottom(force);
  }

  disableAutoScroll(): void {
    this.scrollFade.disableAutoScroll();
  }

  scrollToTop(): void {
    this.scrollFade.scrollToTop();
  }

  scrollToPreviousUserMessage(messageEl: HTMLElement): void {
    this.disableAutoScroll();
    const allMessages = Array.from(
      this.elements.messagesEl.querySelectorAll(".message")
    );
    const currentIdx = allMessages.indexOf(messageEl);
    if (currentIdx <= 0) return;

    for (let index = currentIdx - 1; index >= 0; index--) {
      if (allMessages[index].classList.contains("user")) {
        allMessages[index].scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        break;
      }
    }
  }

  // -------------------------------------------------------------------
  // Event delegation (called from controller / setupEventListeners)
  // -------------------------------------------------------------------

  setupCodeCopyHandler(): void {
    this.elements.messagesEl.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement;
      const copyBtn = target.closest(".code-copy-btn") as HTMLButtonElement;
      if (!copyBtn) return;

      event.preventDefault();
      event.stopPropagation();

      const wrapper = copyBtn.closest(".code-block-wrapper");
      if (!wrapper) return;

      const pre = wrapper.querySelector("pre");
      if (!pre) return;

      const textToCopy = pre.textContent || "";

      try {
        await navigator.clipboard.writeText(textToCopy);

        const icon = copyBtn.querySelector(".codicon");
        if (icon) {
          icon.classList.remove("codicon-copy");
          icon.classList.add("codicon-check");
          copyBtn.classList.add("copied");
          copyBtn.setAttribute("acp-title", "Copied!");
        }

        setTimeout(() => {
          if (icon) {
            icon.classList.remove("codicon-check");
            icon.classList.add("codicon-copy");
            copyBtn.classList.remove("copied");
            const wrapper = copyBtn.closest(".code-block-wrapper");
            if (wrapper) {
              const pre = wrapper.querySelector("pre");
              if (pre && pre.classList.contains("detail-input")) {
                copyBtn.setAttribute("acp-title", "Copy input");
              } else if (pre && pre.classList.contains("tool-output")) {
                copyBtn.setAttribute("acp-title", "Copy output");
              } else {
                copyBtn.setAttribute("acp-title", "Copy code");
              }
            }
          }
        }, 1500);
      } catch (error) {
        console.error("Failed to copy:", error);
      }
    });
  }

  setupFileLinkHandler(): void {
    this.elements.messagesEl.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest(
        "a"
      ) as HTMLAnchorElement | null;
      if (!target) return;

      const href = target.getAttribute("href");
      if (!href) return;

      if (href.startsWith("#")) return;
      if (/^[a-zA-Z][a-zA-Z0-9.+-]*:/.test(href) && !href.startsWith("file:"))
        return;

      event.preventDefault();
      event.stopPropagation();
      this.ctx.vscode.postMessage({
        type: "openFile",
        href,
      });
    });
  }

  setupDiffHeaderClickHandler(): void {
    this.elements.messagesEl.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest(
        ".diff-header"
      ) as HTMLElement | null;
      if (!target) return;

      const path = target.getAttribute("data-file-path");
      if (!path) return;

      event.preventDefault();
      event.stopPropagation();
      this.ctx.vscode.postMessage({
        type: "openFile",
        path,
        checkExists: true,
      });
    });
  }

  /**
   * Reveals the floating action buttons for a text block. Mouse users
   * double-click the block; keyboard users Tab to a message and press
   * Enter/Space. Clicking anywhere outside the focused block dismisses it.
   */
  setupBlockFocusHandler(): void {
    const { messagesEl } = this.elements;

    messagesEl.addEventListener("dblclick", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("button, a, .block-actions")) return;
      const block = target.closest(".block-text") as HTMLElement | null;
      if (!block) return;
      event.preventDefault();
      event.stopPropagation();
      this.focusBlock(block);
    });

    // Keyboard path: Enter/Space on a focused message reveals the actions for
    // its first text block (the buttons themselves are tabbable).
    messagesEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const active = this.ctx.doc.activeElement as HTMLElement | null;
      if (!active || !active.classList.contains("message")) return;
      const block = active.querySelector(".block-text") as HTMLElement | null;
      if (!block) return;
      event.preventDefault();
      this.focusBlock(block);
    });

    // Clicking anywhere outside the focused block dismisses it. Listens on the
    // document so clicks on the input panel, container, etc. also close.
    this.ctx.doc.addEventListener("click", (event) => {
      if (!this.focusedBlockEl) return;
      const target = event.target as HTMLElement;
      if (this.focusedBlockEl.contains(target)) return;
      this.dismissBlockFocus();
    });
  }

  private focusBlock(blockEl: HTMLElement): void {
    if (this.focusedBlockEl === blockEl) return;
    this.dismissBlockFocus();
    this.focusedBlockEl = blockEl;
    blockEl.classList.add("focused");
    this.blockActions.render(blockEl, {
      onCopyToInput: (text) => this.onCopyToInput?.(text),
      scrollToTop: () => this.scrollToTop(),
      scrollToPreviousUserMessage: (el) => this.scrollToPreviousUserMessage(el),
    });
  }

  private dismissBlockFocus(): void {
    if (!this.focusedBlockEl) return;
    this.focusedBlockEl.classList.remove("focused");
    this.focusedBlockEl.querySelector(".block-actions")?.remove();
    this.focusedBlockEl = null;
  }

  /**
   * Keyboard navigation between messages. Scroll-intent marking is owned by
   * the {@link ScrollFadeController}, so this only moves focus.
   */
  setupMessageFocusNavigation(): void {
    const { messagesEl } = this.elements;

    messagesEl.addEventListener("keydown", (event) => {
      const messages = Array.from(messagesEl.querySelectorAll(".message"));
      const currentIndex = messages.indexOf(
        this.ctx.doc.activeElement as Element
      );

      if (event.key === "ArrowDown" && currentIndex < messages.length - 1) {
        event.preventDefault();
        (messages[currentIndex + 1] as HTMLElement).focus();
      } else if (event.key === "ArrowUp" && currentIndex > 0) {
        event.preventDefault();
        (messages[currentIndex - 1] as HTMLElement).focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        (messages[0] as HTMLElement)?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        (messages[messages.length - 1] as HTMLElement)?.focus();
      }
    });
  }

  // -------------------------------------------------------------------
  // Generating state
  // -------------------------------------------------------------------

  private setGenerating(isGenerating: boolean): void {
    this.isGenerating = isGenerating;
    if (isGenerating) {
      this.showTypingIndicator();
      this.scrollToBottom(true);
    } else {
      this.hideTypingIndicator();
    }
    this.onGeneratingChange?.(isGenerating);
  }

  // -------------------------------------------------------------------
  // Message text rendering (unchanged logic)
  // -------------------------------------------------------------------

  private renderMessageText(
    text: string,
    type: MessageType,
    mentions?: Mention[]
  ): HTMLElement {
    const { doc } = this.ctx;
    const textEl = doc.createElement("div");
    textEl.className = "message-content-text";

    const placeholderRegex = /__MENTION_(\d+)__/g;
    const commandRegex = /(?<=^|\s)\/[\w-]+(?=\s|$)/g;

    type Token =
      | { type: "mention"; start: number; end: number; index: number }
      | { type: "command"; start: number; end: number; name: string };

    const tokens: Token[] = [];
    let match: RegExpExecArray | null;

    while ((match = placeholderRegex.exec(text)) !== null) {
      tokens.push({
        type: "mention",
        start: match.index,
        end: placeholderRegex.lastIndex,
        index: parseInt(match[1], 10),
      });
    }

    if (type === "user") {
      while ((match = commandRegex.exec(text)) !== null) {
        const commandName = match[0].substring(1);
        const command = this.availableCommands.find(
          (availableCommand) => availableCommand.name === commandName
        );
        if (command) {
          tokens.push({
            type: "command",
            start: match.index,
            end: commandRegex.lastIndex,
            name: commandName,
          });
        }
      }
    }

    tokens.sort((a, b) => a.start - b.start);

    const validTokens: Token[] = [];
    let currentEnd = 0;
    for (const token of tokens) {
      if (token.start >= currentEnd) {
        validTokens.push(token);
        currentEnd = token.end;
      }
    }

    let lastIndex = 0;
    for (const token of validTokens) {
      if (token.start > lastIndex) {
        textEl.appendChild(
          doc.createTextNode(text.substring(lastIndex, token.start))
        );
      }

      if (token.type === "mention") {
        if (mentions && mentions[token.index]) {
          textEl.appendChild(
            this.chipRenderer.renderMentionChip(mentions[token.index], true)
          );
        }
      } else if (token.type === "command") {
        const command = this.availableCommands.find(
          (availableCommand) => availableCommand.name === token.name
        )!;
        textEl.appendChild(
          this.chipRenderer.renderCommandChip(
            "/" + token.name,
            command.description,
            true
          )
        );
      }

      lastIndex = token.end;
    }

    if (lastIndex < text.length) {
      textEl.appendChild(doc.createTextNode(text.substring(lastIndex)));
    }

    return textEl;
  }

  // -------------------------------------------------------------------
  // Screen-reader helpers
  // -------------------------------------------------------------------

  private announceToScreenReader(message: string): void {
    const { doc } = this.ctx;
    const announcement = doc.createElement("div");
    announcement.setAttribute("role", "status");
    announcement.setAttribute("aria-live", "polite");
    announcement.className = "sr-only";
    announcement.textContent = message;
    doc.body.appendChild(announcement);
    setTimeout(() => announcement.remove(), 1000);
  }
}
