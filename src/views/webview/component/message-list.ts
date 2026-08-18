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
import { ElicitationBlock } from "../block/elicitation-block";
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
export type MessageStream = {
  messageId: string;
  messageEl: HTMLElement;
  blockManager: BlockManager;
};

export interface MessageListSessionState {
  nodes: Node[];
  streams: Map<string, MessageStream>;
  currentStreamId: string | null;
  isGenerating: boolean;
  elicitationBlocks: Map<string, ElicitationBlock>;
  availableCommands: AvailableCommand[];
}

export interface SessionMessageState {
  sessionId: string;
  containerEl: HTMLElement;
  streams: Map<string, MessageStream>;
  currentStreamId: string | null;
  elicitationBlocks: Map<string, ElicitationBlock>;
  isGenerating: boolean;
  isLoading?: boolean;
  loadingPlaceholderEl?: HTMLElement | null;
  availableCommands: AvailableCommand[];
}

/**
 * Owns the chat transcript surface: message DOM, streaming block lifecycle,
 * list-level event delegation, keyboard navigation, and auto-scroll state.
 *
 * Implements {@link MessageHandler} to self-register for all streaming and
 * message-related extension messages across all sessions. Each session maintains
 * its own DOM container and {@link MessageStream} map so background session
 * streaming is never lost.
 */
export class MessageListComponent implements MessageHandler {
  readonly elements: MessageListElements;
  private blockActions: BlockActionsComponent;
  private chipRenderer: ChipRendererComponent;
  private sessionStates = new Map<string, SessionMessageState>();
  private activeSessionId: string | null = null;
  private focusedBlockEl: HTMLElement | null = null;

  private scrollFade: ScrollFadeController;

  private availableCommands: AvailableCommand[] = [];

  /** Callback invoked when generation state changes for active session. */
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

    // Register for all streaming, message, and session lifecycle messages.
    ctx.messageRouter.registerMany(
      [
        "userMessage",
        "streamStart",
        "streamChunk",
        "streamEnd",
        "thoughtChunk",
        "toolCallStart",
        "toolCallComplete",
        "elicitationRequest",
        "elicitationComplete",
        "elicitationCleared",
        "sessionCreated",
        "sessionIdChanged",
        "sessionLoaded",
        "sessionLoadFailed",
      ],
      this
    );

    // Scroll to bottom when a user message is sent.
    ctx.eventBus.on("messageSent", () => {
      this.scrollToBottom(true);
    });
  }

  // -------------------------------------------------------------------
  // Multi-session container management
  // -------------------------------------------------------------------

  private getOrCreateSessionState(sessionId?: string): SessionMessageState {
    const targetId = sessionId || this.activeSessionId || "default";
    let state = this.sessionStates.get(targetId);
    if (!state) {
      const containerEl = this.ctx.doc.createElement("div");
      containerEl.className = "session-messages-content";
      containerEl.setAttribute("data-session-id", targetId);
      const isVisible = targetId === (this.activeSessionId || "default");
      containerEl.style.display = isVisible ? "flex" : "none";
      containerEl.style.flexDirection = "column";
      containerEl.style.gap = "12px";
      containerEl.style.width = "100%";
      this.elements.messagesEl.appendChild(containerEl);

      state = {
        sessionId: targetId,
        containerEl,
        streams: new Map(),
        currentStreamId: null,
        elicitationBlocks: new Map(),
        isGenerating: false,
        availableCommands: [...this.availableCommands],
      };
      this.sessionStates.set(targetId, state);
    }
    return state;
  }

  setActiveSession(sessionId: string): void {
    this.activeSessionId = sessionId;
    const activeState = this.getOrCreateSessionState(sessionId);

    for (const state of this.sessionStates.values()) {
      state.containerEl.style.display =
        state.sessionId === sessionId ? "flex" : "none";
    }

    if (activeState.isGenerating) {
      this.showTypingIndicator(activeState);
    } else {
      this.hideTypingIndicator();
    }

    this.updateViewState();
    this.scrollToBottom();
  }

  removeSession(sessionId: string): void {
    const state = this.sessionStates.get(sessionId);
    if (state) {
      state.containerEl.remove();
      this.sessionStates.delete(sessionId);
    }
    this.updateViewState();
  }

  showLoading(sessionId: string, title = "Starting agent..."): void {
    const session = this.getOrCreateSessionState(sessionId);
    session.isLoading = true;
    if (!session.loadingPlaceholderEl) {
      const doc = this.ctx.doc;
      const placeholder = doc.createElement("div");
      placeholder.className = "session-loading-placeholder";
      placeholder.setAttribute("role", "status");
      placeholder.setAttribute("aria-live", "polite");

      const spinner = doc.createElement("div");
      spinner.className = "session-loading-spinner";
      placeholder.appendChild(spinner);

      const text = doc.createElement("div");
      text.className = "session-loading-text";
      text.textContent = title;
      placeholder.appendChild(text);

      session.loadingPlaceholderEl = placeholder;
      session.containerEl.appendChild(placeholder);
    } else {
      const text = session.loadingPlaceholderEl.querySelector<HTMLElement>(
        ".session-loading-text"
      );
      if (text) text.textContent = title;
    }
    if (session.sessionId === (this.activeSessionId || "default")) {
      this.updateViewState();
    }
  }

  hideLoading(sessionId: string): void {
    const session = this.sessionStates.get(sessionId);
    if (!session) return;
    session.isLoading = false;
    if (session.loadingPlaceholderEl) {
      session.loadingPlaceholderEl.remove();
      session.loadingPlaceholderEl = null;
    }
    if (session.sessionId === (this.activeSessionId || "default")) {
      this.updateViewState();
    }
  }

  // -------------------------------------------------------------------
  // MessageHandler
  // -------------------------------------------------------------------

  handleMessage(msg: ExtensionMessage): boolean | void {
    if (msg.type === "sessionIdChanged") {
      if (msg.oldSessionId && msg.newSessionId) {
        const state = this.sessionStates.get(msg.oldSessionId);
        if (state) {
          state.sessionId = msg.newSessionId;
          state.containerEl.setAttribute("data-session-id", msg.newSessionId);
          this.sessionStates.delete(msg.oldSessionId);
          const existing = this.sessionStates.get(msg.newSessionId);
          if (existing && existing !== state) {
            existing.containerEl.remove();
          }
          this.sessionStates.set(msg.newSessionId, state);
        }
        if (this.activeSessionId === msg.oldSessionId) {
          this.activeSessionId = msg.newSessionId;
        }
        this.hideLoading(msg.newSessionId);
      }
      return;
    }

    if (msg.type === "sessionCreated") {
      if (msg.session?.isLoading) {
        this.showLoading(
          msg.session.sessionId,
          msg.session.loadingTitle || "Starting agent..."
        );
      }
      return;
    }

    const sessionId = msg.sessionId || this.activeSessionId || "default";
    const session = this.getOrCreateSessionState(sessionId);

    switch (msg.type) {
      case "sessionLoaded":
        this.hideLoading(msg.sessionId || this.activeSessionId || "default");
        return;
      case "sessionLoadFailed": {
        const failId = msg.sessionId || this.activeSessionId || "default";
        this.hideLoading(failId);
        if (msg.error) {
          const failSession = this.getOrCreateSessionState(failId);
          this.addMessageToSession(failSession, msg.error, "error");
        }
        return;
      }
      case "userMessage":
        return this.handleUserMessage(session, msg);
      case "streamStart":
        return this.handleStreamStart(session);
      case "streamChunk":
        return this.handleStreamChunk(session, msg);
      case "streamEnd":
        return this.handleStreamEnd(session);
      case "thoughtChunk":
        return this.handleThoughtChunk(session, msg);
      case "toolCallStart":
        return this.handleToolCallStart(session, msg);
      case "toolCallComplete":
        return this.handleToolCallComplete(session, msg);
      case "elicitationRequest":
        return this.handleElicitationRequest(session, msg);
      case "elicitationComplete":
        return this.handleElicitationComplete(session, msg);
      case "elicitationCleared":
        return this.handleElicitationCleared(session);
    }
  }

  // -------------------------------------------------------------------
  // Message handlers
  // -------------------------------------------------------------------

  private handleUserMessage(
    session: SessionMessageState,
    msg: ExtensionMessage
  ): void {
    // Always reset assistant state before a new turn
    this.resetStreams(session);
    if (session.isLoading) {
      this.hideLoading(session.sessionId);
    }

    if (msg.text || (msg.images && msg.images.length > 0)) {
      this.addMessageToSession(session, msg.text || "", "user", msg.mentions);
    }
  }

  private handleStreamStart(session: SessionMessageState): void {
    this.resetStreams(session);
    if (session.isLoading) {
      this.hideLoading(session.sessionId);
    }
    this.setGenerating(session, true);
  }

  private handleStreamChunk(
    session: SessionMessageState,
    msg: ExtensionMessage
  ): void {
    if (!msg.text) return;
    if (session.isLoading) {
      this.hideLoading(session.sessionId);
    }
    const stream = this.ensureStream(session, msg.messageId ?? null);
    const block = stream.blockManager.ensureBlock(
      "text",
      stream.messageEl,
      this.elements.typingIndicatorEl
    ) as TextBlock;
    block.appendContent(msg.text);
    if (session.sessionId === (this.activeSessionId || "default")) {
      this.scrollToBottom();
    }
  }

  private handleStreamEnd(session: SessionMessageState): void {
    this.finalizeAllStreams(session);
    this.setGenerating(session, false);
    session.currentStreamId = null;
    if (session.sessionId === (this.activeSessionId || "default")) {
      this.scrollToBottom();
    }
  }

  private handleThoughtChunk(
    session: SessionMessageState,
    msg: ExtensionMessage
  ): void {
    if (!msg.text) return;
    if (session.isLoading) {
      this.hideLoading(session.sessionId);
    }
    const stream = this.ensureStream(session, msg.messageId ?? null);
    const block = stream.blockManager.ensureBlock(
      "thought",
      stream.messageEl,
      this.elements.typingIndicatorEl
    );
    block.appendContent(msg.text);
    if (session.sessionId === (this.activeSessionId || "default")) {
      this.scrollToBottom();
    }
  }

  private handleToolCallStart(
    session: SessionMessageState,
    msg: ExtensionMessage
  ): void {
    if (!msg.toolCallId || !msg.name) return;
    if (session.isLoading) {
      this.hideLoading(session.sessionId);
    }
    const stream =
      this.getToolBlockStream(session, msg.toolCallId) ??
      this.ensureStream(session, session.currentStreamId);
    this.applyToolCallStart(
      stream.blockManager.ensureToolBlock(
        msg.toolCallId,
        stream.messageEl,
        this.elements.typingIndicatorEl
      ),
      msg
    );
    if (session.sessionId === (this.activeSessionId || "default")) {
      this.scrollToBottom();
    }
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

  private handleToolCallComplete(
    session: SessionMessageState,
    msg: ExtensionMessage
  ): void {
    if (!msg.toolCallId) return;
    const stream =
      this.getToolBlockStream(session, msg.toolCallId) ??
      this.ensureStream(session, session.currentStreamId);
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
      if (session.sessionId === (this.activeSessionId || "default")) {
        this.scrollToBottom();
      }
    }
  }

  // -------------------------------------------------------------------
  // Elicitation blocks
  // -------------------------------------------------------------------

  /**
   * Render an inline elicitation block for an agent request. Each request
   * gets its own block keyed by request id, so concurrent requests never
   * replace each other.
   */
  private handleElicitationRequest(
    session: SessionMessageState,
    msg: ExtensionMessage
  ): void {
    if (!msg.requestId) return;
    const block = new ElicitationBlock(this.ctx, {
      requestId: msg.requestId,
      message: msg.message,
      mode: msg.mode,
      schema: msg.schema,
      url: msg.url,
      elicitationId: msg.elicitationId,
    });
    session.elicitationBlocks.set(msg.requestId, block);
    session.containerEl.appendChild(block.element);
    if (session.sessionId === (this.activeSessionId || "default")) {
      this.updateViewState();
      this.scrollToBottom(true);
    }
  }

  /**
   * Close the elicitation block whose elicitation id matches. Unknown ids
   * (already resolved) are ignored, so a stale notification can never close
   * a different request's block.
   */
  private handleElicitationComplete(
    session: SessionMessageState,
    msg: ExtensionMessage
  ): void {
    if (!msg.elicitationId) return;
    for (const [requestId, block] of session.elicitationBlocks) {
      if (block.elicitationId === msg.elicitationId) {
        block.remove();
        session.elicitationBlocks.delete(requestId);
        if (session.sessionId === (this.activeSessionId || "default")) {
          this.updateViewState();
        }
        return;
      }
    }
  }

  /** Remove every open elicitation block (stop / clear / session switch). */
  private handleElicitationCleared(session: SessionMessageState): void {
    for (const block of session.elicitationBlocks.values()) {
      block.remove();
    }
    session.elicitationBlocks.clear();
    if (session.sessionId === (this.activeSessionId || "default")) {
      this.updateViewState();
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
  ensureAssistantMessage(sessionId?: string): HTMLElement {
    const session = this.getOrCreateSessionState(sessionId);
    const stream = this.ensureStream(session, session.currentStreamId);
    if (
      session.sessionId === (this.activeSessionId || "default") &&
      this.elements.typingIndicatorEl.classList.contains("visible")
    ) {
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
    for (const session of this.sessionStates.values()) {
      session.availableCommands = [...commands];
    }
  }

  /**
   * Return the block manager for the current stream. If no stream is active
   * yet, one is created (which appends an empty assistant message element).
   */
  getBlockManager(sessionId?: string): BlockManager {
    const session = this.getOrCreateSessionState(sessionId);
    return this.ensureStream(session, session.currentStreamId).blockManager;
  }

  /** Locate the stream owning a tool call id (active stream first). */
  private getToolBlockStream(
    session: SessionMessageState,
    toolCallId: string
  ): MessageStream | undefined {
    if (session.currentStreamId !== null) {
      const current = session.streams.get(session.currentStreamId);
      if (current?.blockManager.getToolBlock(toolCallId)) {
        return current;
      }
    }
    for (const stream of session.streams.values()) {
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
  getToolBlockManager(
    toolCallId: string,
    sessionId?: string
  ): BlockManager | undefined {
    if (sessionId) {
      const session = this.sessionStates.get(sessionId);
      if (session) {
        return this.getToolBlockStream(session, toolCallId)?.blockManager;
      }
    }
    const active = this.getOrCreateSessionState();
    const activeStream = this.getToolBlockStream(active, toolCallId);
    if (activeStream) return activeStream.blockManager;

    for (const session of this.sessionStates.values()) {
      const stream = this.getToolBlockStream(session, toolCallId);
      if (stream) return stream.blockManager;
    }
    return undefined;
  }

  /** Aggregate tool snapshots across all active streams. */
  getToolsSnapshot(sessionId?: string): Record<string, Tool> {
    const tools: Record<string, Tool> = {};
    if (sessionId) {
      const session = this.sessionStates.get(sessionId);
      if (session) {
        for (const stream of session.streams.values()) {
          Object.assign(tools, stream.blockManager.getToolsSnapshot());
        }
      }
      return tools;
    }
    const active = this.getOrCreateSessionState();
    for (const stream of active.streams.values()) {
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
  private ensureStream(
    session: SessionMessageState,
    messageId: string | null
  ): MessageStream {
    if (messageId !== null && messageId !== "") {
      const existing = session.streams.get(messageId);
      if (existing) {
        session.currentStreamId = messageId;
        return existing;
      }
      if (session.currentStreamId !== null) {
        this.finalizeStream(session, session.currentStreamId);
      }
      return this.createStream(session, messageId);
    }

    if (session.currentStreamId !== null) {
      const current = session.streams.get(session.currentStreamId);
      if (current) return current;
    }
    return this.createStream(session, "");
  }

  private createStream(
    session: SessionMessageState,
    messageId: string
  ): MessageStream {
    const messageEl = this.addMessageToSession(session, "", "assistant");
    if (
      session.sessionId === (this.activeSessionId || "default") &&
      this.elements.typingIndicatorEl.classList.contains("visible")
    ) {
      messageEl.appendChild(this.elements.typingIndicatorEl);
    }
    const stream: MessageStream = {
      messageId,
      messageEl,
      blockManager: new BlockManager(this.ctx),
    };
    session.streams.set(messageId, stream);
    session.currentStreamId = messageId;
    return stream;
  }

  /**
   * Finalize a stream: collapse its blocks. The stream stays tracked (and
   * DOM) until the next turn resets, so resumed chunks and getTools()
   * lookups keep working.
   */
  private finalizeStream(session: SessionMessageState, streamId: string): void {
    const stream = session.streams.get(streamId);
    if (!stream) return;
    stream.blockManager.finalizeAll();
  }

  /**
   * Turn-end finalize: clear stale tool spinners first (only here, so a
   * running tool in one stream is not marked completed merely because
   * another stream started), then finalize every stream.
   */
  private finalizeAllStreams(session: SessionMessageState): void {
    for (const id of Array.from(session.streams.keys())) {
      const stream = session.streams.get(id);
      if (!stream) continue;
      stream.blockManager.clearStaleRunningToolIndicators();
      this.finalizeStream(session, id);
    }
  }

  private resetStreams(session: SessionMessageState): void {
    this.dismissBlockFocus();
    session.streams.clear();
    session.currentStreamId = null;
  }

  /** Return the generation state for a session. */
  getIsGenerating(sessionId?: string): boolean {
    const session = this.getOrCreateSessionState(sessionId);
    return session.isGenerating;
  }

  private setGenerating(
    session: SessionMessageState,
    isGenerating: boolean
  ): void {
    session.isGenerating = isGenerating;
    if (session.sessionId === (this.activeSessionId || "default")) {
      if (isGenerating) {
        this.showTypingIndicator(session);
        this.scrollToBottom(true);
      } else {
        this.hideTypingIndicator();
      }
      this.onGeneratingChange?.(isGenerating);
    }
  }

  /**
   * Appends a message to the specified session's container.
   */
  addMessageToSession(
    session: SessionMessageState,
    text = "",
    type: MessageType = "user",
    mentions?: Mention[]
  ): HTMLElement {
    if (session.isLoading) {
      this.hideLoading(session.sessionId);
    }
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

    session.containerEl.appendChild(messageEl);
    if (session.sessionId === (this.activeSessionId || "default")) {
      this.scrollToBottom(type === "user");
      if (text) {
        this.announceToScreenReader(label + ": " + text.substring(0, 100));
      }
      this.updateViewState();
    }
    return messageEl;
  }

  /**
   * Appends a message to the active session's container.
   */
  addMessage(
    text = "",
    type: MessageType = "user",
    mentions?: Mention[]
  ): HTMLElement {
    return this.addMessageToSession(
      this.getOrCreateSessionState(),
      text,
      type,
      mentions
    );
  }

  updateViewState(): void {
    const active = this.sessionStates.get(this.activeSessionId || "default");
    const hasLoading = Boolean(active?.isLoading);
    const hasMessages = Boolean(
      active &&
      Array.from(active.containerEl.children).some(
        (el) =>
          !(el as HTMLElement).classList.contains("session-loading-placeholder")
      )
    );
    const showContainer = hasLoading || hasMessages;
    this.elements.welcomeView.style.display = !showContainer ? "flex" : "none";
    this.elements.containerEl.style.display = showContainer ? "flex" : "none";
  }

  clear(sessionId?: string): void {
    if (!sessionId) {
      this.elements.messagesEl.innerHTML = "";
      for (const state of this.sessionStates.values()) {
        this.resetStreams(state);
        state.elicitationBlocks.clear();
        state.isGenerating = false;
        state.isLoading = false;
        if (state.loadingPlaceholderEl) {
          state.loadingPlaceholderEl.remove();
          state.loadingPlaceholderEl = null;
        }
      }
      this.sessionStates.clear();
      this.hideTypingIndicator();
      this.updateViewState();
      return;
    }
    const state = this.sessionStates.get(sessionId);
    if (state) {
      state.containerEl.innerHTML = "";
      this.resetStreams(state);
      state.elicitationBlocks.clear();
      state.isGenerating = false;
      state.isLoading = false;
      if (state.loadingPlaceholderEl) {
        state.loadingPlaceholderEl.remove();
        state.loadingPlaceholderEl = null;
      }
    }
    if (sessionId === (this.activeSessionId || "default")) {
      this.hideTypingIndicator();
      this.updateViewState();
    }
  }

  showTypingIndicator(session?: SessionMessageState): void {
    const targetSession = session || this.getOrCreateSessionState();
    if (
      targetSession.sessionId !== (this.activeSessionId || "default") &&
      this.activeSessionId !== null
    ) {
      return;
    }
    this.elements.typingIndicatorEl.classList.add("visible");
    const stream =
      targetSession.currentStreamId !== null
        ? targetSession.streams.get(targetSession.currentStreamId)
        : undefined;
    if (stream) {
      stream.messageEl.appendChild(this.elements.typingIndicatorEl);
    } else {
      targetSession.containerEl.appendChild(this.elements.typingIndicatorEl);
    }
  }

  hideTypingIndicator(): void {
    this.elements.typingIndicatorEl.classList.remove("visible");
    this.elements.typingIndicatorEl.remove();
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
    const active = this.getOrCreateSessionState();
    const allMessages = Array.from(
      active.containerEl.querySelectorAll(".message")
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
  // Multi-session State Serialization
  // -------------------------------------------------------------------

  saveSessionState(sessionId?: string): MessageListSessionState {
    const session = this.getOrCreateSessionState(sessionId);
    return {
      nodes: Array.from(session.containerEl.childNodes),
      streams: new Map(session.streams),
      currentStreamId: session.currentStreamId,
      isGenerating: session.isGenerating,
      elicitationBlocks: new Map(session.elicitationBlocks),
      availableCommands: [...session.availableCommands],
    };
  }

  restoreSessionState(
    state?: MessageListSessionState,
    sessionId?: string
  ): void {
    const session = this.getOrCreateSessionState(sessionId);
    session.containerEl.innerHTML = "";
    this.resetStreams(session);
    session.elicitationBlocks.clear();
    if (state) {
      for (const node of state.nodes) {
        session.containerEl.appendChild(node);
      }
      session.streams = new Map(state.streams);
      session.currentStreamId = state.currentStreamId;
      session.elicitationBlocks = new Map(state.elicitationBlocks);
      session.availableCommands = [...state.availableCommands];
      session.isGenerating = state.isGenerating;
      if (session.sessionId === (this.activeSessionId || "default")) {
        if (state.isGenerating) {
          this.showTypingIndicator(session);
        } else {
          this.hideTypingIndicator();
        }
      }
    } else {
      session.isGenerating = false;
      if (session.sessionId === (this.activeSessionId || "default")) {
        this.hideTypingIndicator();
      }
    }
    if (session.sessionId === (this.activeSessionId || "default")) {
      this.updateViewState();
      this.scrollToBottom();
    }
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
