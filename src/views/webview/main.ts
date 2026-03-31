export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): T;
}

declare function acquireVsCodeApi(): VsCodeApi;

export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export interface Tool {
  name: string;
  input: string | null;
  output: string | null;
  status: "running" | "completed" | "failed";
  kind?: ToolKind;
}

export interface WebviewState {
  isConnected: boolean;
  inputValue: string;
}

export interface AvailableCommand {
  name: string;
  description?: string;
  input?: { hint?: string };
}

export interface PlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

export type ToolCallContentItem =
  | { type: "content"; content?: { type: "text"; text?: string } }
  | { type: "diff"; path?: string; oldText?: string; newText?: string }
  | { type: "terminal"; terminalId?: string };

export interface ExtensionMessage {
  type: string;
  text?: string;
  html?: string;
  state?: string;
  agents?: Array<{ id: string; name: string; available: boolean }>;
  selected?: string;
  agentId?: string;
  modeId?: string;
  modelId?: string;
  modes?: {
    availableModes: Array<{ id: string; name: string }>;
    currentModeId: string;
  } | null;
  models?: {
    availableModels: Array<{ modelId: string; name: string }>;
    currentModelId: string;
  } | null;
  commands?: AvailableCommand[] | null;
  toolCallId?: string;
  name?: string;
  title?: string;
  kind?: ToolKind;
  content?: ToolCallContentItem[];
  rawInput?: { command?: string; description?: string };
  rawOutput?: { output?: string };
  status?: string;
  terminalOutput?: string;
  results?: Array<{ name: string; path: string }>;
  plan?: { entries: PlanEntry[] };
}

export interface Mention {
  name: string;
  path: string;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TOOL_KIND_ICONS: Record<ToolKind, string> = {
  read: "📖",
  edit: "✏️",
  delete: "🗑️",
  move: "📦",
  search: "🔍",
  execute: "▶️",
  think: "🧠",
  fetch: "🌐",
  switch_mode: "🔄",
  other: "⚙️",
};

export function getToolKindIcon(kind?: ToolKind): string {
  return kind ? TOOL_KIND_ICONS[kind] || TOOL_KIND_ICONS.other : "";
}

const ANSI_FOREGROUND: Record<number, string> = {
  30: "ansi-black",
  31: "ansi-red",
  32: "ansi-green",
  33: "ansi-yellow",
  34: "ansi-blue",
  35: "ansi-magenta",
  36: "ansi-cyan",
  37: "ansi-white",
  90: "ansi-bright-black",
  91: "ansi-bright-red",
  92: "ansi-bright-green",
  93: "ansi-bright-yellow",
  94: "ansi-bright-blue",
  95: "ansi-bright-magenta",
  96: "ansi-bright-cyan",
  97: "ansi-bright-white",
};

const ANSI_BACKGROUND: Record<number, string> = {
  40: "ansi-bg-black",
  41: "ansi-bg-red",
  42: "ansi-bg-green",
  43: "ansi-bg-yellow",
  44: "ansi-bg-blue",
  45: "ansi-bg-magenta",
  46: "ansi-bg-cyan",
  47: "ansi-bg-white",
  100: "ansi-bg-bright-black",
  101: "ansi-bg-bright-red",
  102: "ansi-bg-bright-green",
  103: "ansi-bg-bright-yellow",
  104: "ansi-bg-bright-blue",
  105: "ansi-bg-bright-magenta",
  106: "ansi-bg-bright-cyan",
  107: "ansi-bg-bright-white",
};

const ANSI_STYLES: Record<number, string> = {
  1: "ansi-bold",
  2: "ansi-dim",
  3: "ansi-italic",
  4: "ansi-underline",
};

const ANSI_ESCAPE_REGEX = /\x1b\[([0-9;]*)m/g;

function isForegroundClass(cls: string): boolean {
  return (
    cls.startsWith("ansi-") &&
    !cls.startsWith("ansi-bg-") &&
    !cls.startsWith("ansi-bold") &&
    !cls.startsWith("ansi-dim") &&
    !cls.startsWith("ansi-italic") &&
    !cls.startsWith("ansi-underline")
  );
}

function isBackgroundClass(cls: string): boolean {
  return cls.startsWith("ansi-bg-");
}

export function ansiToHtml(text: string): string {
  let result = "";
  let lastIndex = 0;
  let currentClasses: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = ANSI_ESCAPE_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textContent = escapeHtml(text.slice(lastIndex, match.index));
      if (currentClasses.length > 0) {
        result += `<span class="${currentClasses.join(" ")}">${textContent}</span>`;
      } else {
        result += textContent;
      }
    }

    const codes = match[1].split(";").map((c) => parseInt(c, 10) || 0);

    for (const code of codes) {
      if (code === 0) {
        currentClasses = [];
      } else if (ANSI_STYLES[code]) {
        const styleClass = ANSI_STYLES[code];
        if (!currentClasses.includes(styleClass)) {
          currentClasses.push(styleClass);
        }
      } else if (ANSI_FOREGROUND[code]) {
        currentClasses = currentClasses.filter((c) => !isForegroundClass(c));
        currentClasses.push(ANSI_FOREGROUND[code]);
      } else if (ANSI_BACKGROUND[code]) {
        currentClasses = currentClasses.filter((c) => !isBackgroundClass(c));
        currentClasses.push(ANSI_BACKGROUND[code]);
      }
    }

    lastIndex = match.index + match[0].length;
  }

  ANSI_ESCAPE_REGEX.lastIndex = 0;

  if (lastIndex < text.length) {
    const textContent = escapeHtml(text.slice(lastIndex));
    if (currentClasses.length > 0) {
      result += `<span class="${currentClasses.join(" ")}">${textContent}</span>`;
    } else {
      result += textContent;
    }
  }

  return result;
}

export function hasAnsiCodes(text: string): boolean {
  return /\x1b\[[0-9;]*m/.test(text);
}

export interface DiffLine {
  type: "add" | "remove" | "context";
  line: string;
}

/**
 * Compute a simple line-by-line diff between old and new text.
 * Returns an array of diff lines marked as add/remove/context.
 */
export function computeLineDiff(
  oldText: string | null | undefined,
  newText: string | null | undefined
): DiffLine[] {
  // Handle edge cases
  if (!oldText && !newText) {
    return [];
  }
  if (!oldText) {
    // New file - all lines are additions
    return newText!.split("\n").map((line) => ({ type: "add", line }));
  }
  if (!newText) {
    // Deleted file - all lines are deletions
    return oldText!.split("\n").map((line) => ({ type: "remove", line }));
  }

  // Simple line-by-line diff
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: DiffLine[] = [];

  // Simple algorithm: mark old lines as removed, new lines as added
  // Future optimization: detect common lines and mark as context
  for (const line of oldLines) {
    result.push({ type: "remove", line });
  }
  for (const line of newLines) {
    result.push({ type: "add", line });
  }

  return result;
}

export function renderDiff(
  path: string | undefined,
  oldText: string | null | undefined,
  newText: string | null | undefined
): string {
  const diffLines = computeLineDiff(oldText, newText);

  if (diffLines.length === 0) {
    return '<div class="diff-container"><div class="diff-empty">No changes</div></div>';
  }

  const truncated = diffLines.length > 500;
  const linesToShow = truncated ? diffLines.slice(0, 500) : diffLines;

  let html = '<div class="diff-container">';

  if (path) {
    html += '<div class="diff-header">' + escapeHtml(path) + "</div>";
  }

  html += '<pre class="diff-content">';

  for (const diffLine of linesToShow) {
    const prefix =
      diffLine.type === "add" ? "+ " : diffLine.type === "remove" ? "- " : "  ";
    const className = "diff-line diff-" + diffLine.type;
    html +=
      '<div class="' +
      className +
      '">' +
      escapeHtml(prefix + diffLine.line) +
      "</div>";
  }

  html += "</pre>";

  if (truncated) {
    html +=
      '<div class="diff-truncated">... (truncated, showing first 500 of ' +
      diffLines.length +
      " lines)</div>";
  }

  html += "</div>";

  return html;
}

export function getToolsHtml(
  tools: Record<string, Tool>,
  expandedToolId?: string | null
): string {
  const toolIds = Object.keys(tools);
  if (toolIds.length === 0) return "";
  const toolItems = toolIds
    .map((id) => {
      const tool = tools[id];
      const statusIcon =
        tool.status === "completed"
          ? "✓"
          : tool.status === "failed"
            ? "✗"
            : "⋯";
      const statusClass = tool.status === "running" ? "running" : "";
      const isExpanded = id === expandedToolId;
      const kindIcon = getToolKindIcon(tool.kind);
      const kindSpan = kindIcon
        ? '<span class="tool-kind-icon" title="' +
          escapeHtml(tool.kind || "other") +
          '">' +
          kindIcon +
          "</span> "
        : "";
      let detailsContent = "";
      if (tool.input) {
        detailsContent +=
          '<div class="tool-input"><strong>$</strong> ' +
          escapeHtml(tool.input) +
          "</div>";
      }
      if (tool.output) {
        const truncated =
          tool.output.length > 500
            ? tool.output.slice(0, 500) + "..."
            : tool.output;
        const hasAnsi = hasAnsiCodes(truncated);
        const outputHtml = hasAnsi
          ? ansiToHtml(truncated)
          : escapeHtml(truncated);
        const terminalClass = hasAnsi ? " terminal" : "";
        detailsContent +=
          '<pre class="tool-output' +
          terminalClass +
          '">' +
          outputHtml +
          "</pre>";
      }
      const escapedStatus = escapeHtml(tool.status);
      const inputPreview = tool.input
        ? '<span class="tool-input-preview">' +
          escapeHtml(tool.input) +
          "</span>"
        : "";
      if (detailsContent) {
        const openAttr = isExpanded ? " open" : "";
        return (
          '<li><details class="tool-item"' +
          openAttr +
          '><summary><span class="tool-status ' +
          statusClass +
          '" aria-label="' +
          escapedStatus +
          '">' +
          statusIcon +
          "</span> " +
          kindSpan +
          escapeHtml(tool.name) +
          inputPreview +
          "</summary>" +
          detailsContent +
          "</details></li>"
        );
      }
      return (
        '<li><span class="tool-status ' +
        statusClass +
        '" aria-label="' +
        escapedStatus +
        '">' +
        statusIcon +
        "</span> " +
        kindSpan +
        escapeHtml(tool.name) +
        inputPreview +
        "</li>"
      );
    })
    .join("");
  return (
    '<details class="tool-details" open><summary aria-label="' +
    toolIds.length +
    ' tools used">' +
    toolIds.length +
    " tool" +
    (toolIds.length > 1 ? "s" : "") +
    '</summary><ul class="tool-list" role="list">' +
    toolItems +
    "</ul></details>"
  );
}

export function updateSelectLabel(select: HTMLSelectElement): void {
  Array.from(select.options).forEach((opt) => {
    opt.textContent = opt.dataset.label || opt.textContent;
  });
}

export interface DropdownOption {
  id: string;
  name: string;
  available?: boolean;
  icon?: string;
}

export class Dropdown {
  private element: HTMLElement;
  private trigger: HTMLElement;
  private popover: HTMLElement;
  private labelEl: HTMLElement;
  private options: DropdownOption[] = [];
  private selectedId: string | null = null;
  private onChange?: (id: string) => void;
  private isOpen = false;

  constructor(element: HTMLElement, onChange?: (id: string) => void) {
    this.element = element;
    this.onChange = onChange;
    this.trigger = element.querySelector(".dropdown-trigger")!;
    this.popover = element.querySelector(".dropdown-popover")!;
    this.labelEl = element.querySelector(".selected-label")!;

    this.trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
    });

    this.element.ownerDocument.addEventListener("click", () => {
      if (this.isOpen) this.close();
    });

    this.popover.addEventListener("click", (e) => e.stopPropagation());
  }

  setOptions(options: DropdownOption[], selectedId?: string): void {
    this.options = options;
    this.renderOptions();
    if (selectedId !== undefined) {
      this.select(selectedId, false);
    }
  }

  select(id: string, triggerChange = true): void {
    const option = this.options.find((o) => o.id === id);
    if (!option) return;

    this.selectedId = id;
    this.labelEl.textContent = option.name;
    this.labelEl.title = option.name;

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

  getValue(): string | null {
    return this.selectedId;
  }

  setValue(id: string): void {
    this.select(id, false);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    // Close other dropdowns first
    this.element.ownerDocument
      .querySelectorAll(".custom-dropdown.open")
      .forEach((el) => {
        if (el !== this.element) el.classList.remove("open");
      });

    this.isOpen = true;
    this.element.classList.add("open");
  }

  close(): void {
    this.isOpen = false;
    this.element.classList.remove("open");
  }

  private renderOptions(): void {
    this.popover.innerHTML = "";
    this.options.forEach((opt) => {
      const item = this.element.ownerDocument.createElement("div");
      item.className = "dropdown-item";
      if (opt.id === this.selectedId) item.classList.add("selected");
      if (opt.available === false) item.classList.add("disabled");
      item.setAttribute("data-id", opt.id);

      let html = "";
      if (opt.icon) {
        html += `<span class="dropdown-item-icon">${opt.icon}</span>`;
      }
      html += `<span>${escapeHtml(opt.available === false ? opt.name + " (not installed)" : opt.name)}</span>`;
      item.innerHTML = html;

      item.addEventListener("click", () => {
        if (opt.available !== false) {
          this.select(opt.id);
          this.close();
        }
      });

      this.popover.appendChild(item);
    });
  }
}

export interface WebviewElements {
  messagesEl: HTMLElement;
  inputEl: HTMLElement;
  imageAttachmentsEl: HTMLElement;
  attachImageBtn: HTMLButtonElement;
  imagePreviewPopover: HTMLElement;
  sendBtn: HTMLButtonElement;
  statusDot: HTMLElement;
  agentDropdown: HTMLElement;
  modeDropdown: HTMLElement;
  modelDropdown: HTMLElement;
  welcomeView: HTMLElement;
  commandAutocomplete: HTMLElement;
  planContainer: HTMLElement;
}

export function getElements(doc: Document): WebviewElements {
  return {
    messagesEl: doc.getElementById("messages")!,
    inputEl: doc.getElementById("input")!,
    imageAttachmentsEl: doc.getElementById("image-attachments")!,
    attachImageBtn: doc.getElementById("attach-image") as HTMLButtonElement,
    imagePreviewPopover: doc.getElementById("image-preview-popover")!,
    sendBtn: doc.getElementById("send") as HTMLButtonElement,
    statusDot: doc.getElementById("status-dot")!,
    agentDropdown: doc.getElementById("agent-dropdown")!,
    modeDropdown: doc.getElementById("mode-dropdown")!,
    modelDropdown: doc.getElementById("model-dropdown")!,
    welcomeView: doc.getElementById("welcome-view")!,
    commandAutocomplete: doc.getElementById("command-autocomplete")!,
    planContainer: doc.getElementById("agent-plan-container")!,
  };
}

export class WebviewController {
  private vscode: VsCodeApi;
  private elements: WebviewElements;
  private doc: Document;
  private win: Window;

  private currentAssistantMessage: HTMLElement | null = null;
  private currentAssistantText = "";
  private thinkingEl: HTMLElement | null = null;
  private planEl: HTMLElement | null = null;
  private thoughtEl: HTMLElement | null = null;
  private thoughtText = "";
  private tools: Record<string, Tool> = {};
  private isConnected = false;
  private messageTexts = new Map<HTMLElement, string>();
  private availableCommands: AvailableCommand[] = [];
  private fileResults: Array<{ name: string; path: string }> = [];
  private selectedIndex = -1;
  private autocompleteMode: "none" | "command" | "file" = "none";
  private autocompleteTriggerPos = -1;

  private hasActiveTool = false;
  private expandedToolId: string | null = null;

  private agentDropdown: Dropdown;
  private modeDropdown: Dropdown;
  private modelDropdown: Dropdown;

  constructor(
    vscode: VsCodeApi,
    elements: WebviewElements,
    doc: Document,
    win: Window
  ) {
    this.vscode = vscode;
    this.elements = elements;
    this.doc = doc;
    this.win = win;

    this.agentDropdown = new Dropdown(this.elements.agentDropdown, (id) => {
      this.vscode.postMessage({ type: "selectAgent", agentId: id });
    });

    this.modeDropdown = new Dropdown(this.elements.modeDropdown, (id) => {
      this.vscode.postMessage({ type: "selectMode", modeId: id });
    });

    this.modelDropdown = new Dropdown(this.elements.modelDropdown, (id) => {
      this.vscode.postMessage({ type: "selectModel", modelId: id });
    });

    this.restoreState();
    this.setupEventListeners();
    this.updateViewState();
    this.adjustHeight();
    this.vscode.postMessage({ type: "ready" });
  }

  private adjustHeight(): void {
    const { inputEl } = this.elements;
    inputEl.style.height = "auto";
    const maxHeight = this.win.innerHeight / 3;
    const scrollHeight = inputEl.scrollHeight;
    const newHeight = Math.max(36, Math.min(scrollHeight, maxHeight));
    inputEl.style.height = newHeight + "px";
    inputEl.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
  }

  private restoreState(): void {
    const previousState = this.vscode.getState<WebviewState>();
    if (previousState) {
      this.isConnected = previousState.isConnected;
      this.elements.inputEl.textContent = previousState.inputValue || "";
    }
  }

  private saveState(): void {
    this.vscode.setState<WebviewState>({
      isConnected: this.isConnected,
      inputValue: this.elements.inputEl.textContent || "",
    });
  }

  private setupEventListeners(): void {
    const { sendBtn, inputEl, messagesEl, attachImageBtn } = this.elements;

    const { commandAutocomplete } = this.elements;

    sendBtn.addEventListener("click", () => this.send());

    inputEl.addEventListener("keydown", (e) => {
      const isAutocompleteVisible =
        commandAutocomplete.classList.contains("visible");

      if (isAutocompleteVisible) {
        const count =
          this.autocompleteMode === "command"
            ? this.getFilteredCommands(
                inputEl.textContent?.split(/\s/)[0] || ""
              ).length
            : this.fileResults.length;

        if (e.key === "ArrowDown") {
          e.preventDefault();
          this.selectedIndex = Math.min(this.selectedIndex + 1, count - 1);
          this.renderAutocomplete();
          return;
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
          this.renderAutocomplete();
          return;
        } else if (
          e.key === "Tab" ||
          (e.key === "Enter" && this.selectedIndex >= 0)
        ) {
          e.preventDefault();
          this.selectAutocomplete(this.selectedIndex);
          return;
        } else if (e.key === "Escape") {
          e.preventDefault();
          this.hideAutocomplete();
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.clearInput();
      }
    });

    inputEl.addEventListener("input", () => {
      this.adjustHeight();
      this.updateAutocomplete();
      this.saveState();
    });

    inputEl.addEventListener("paste", (e) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            e.preventDefault();
            const blob = item.getAsFile();
            if (blob) this.handleImageAttachment(blob);
          }
        }
      }
    });

    attachImageBtn.addEventListener("click", () => {
      const input = this.doc.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.onchange = () => {
        if (input.files) {
          Array.from(input.files).forEach((file) =>
            this.handleImageAttachment(file)
          );
        }
      };
      input.click();
    });

    commandAutocomplete.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest(".command-item");
      if (item) {
        const index = parseInt(item.getAttribute("data-index") || "0", 10);
        this.selectAutocomplete(index);
      }
    });

    commandAutocomplete.addEventListener("mouseover", (e) => {
      const item = (e.target as HTMLElement).closest(".command-item");
      if (item) {
        this.selectedIndex = parseInt(
          item.getAttribute("data-index") || "0",
          10
        );
        this.renderAutocomplete();
      }
    });

    messagesEl.addEventListener("keydown", (e) => {
      const messages = Array.from(messagesEl.querySelectorAll(".message"));
      const currentIndex = messages.indexOf(this.doc.activeElement as Element);

      if (e.key === "ArrowDown" && currentIndex < messages.length - 1) {
        e.preventDefault();
        (messages[currentIndex + 1] as HTMLElement).focus();
      } else if (e.key === "ArrowUp" && currentIndex > 0) {
        e.preventDefault();
        (messages[currentIndex - 1] as HTMLElement).focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        (messages[0] as HTMLElement)?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        (messages[messages.length - 1] as HTMLElement)?.focus();
      }
    });

    this.win.addEventListener("message", (e: MessageEvent<ExtensionMessage>) =>
      this.handleMessage(e.data)
    );
  }

  private handleImageAttachment(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      this.addImageThumbnail(base64, file.name);
    };
    reader.readAsDataURL(file);
  }

  private addImageThumbnail(base64: string, name: string): void {
    const { imageAttachmentsEl } = this.elements;
    const item = this.doc.createElement("div");
    item.className = "image-item";
    item.innerHTML = `
      <img src="${base64}" alt="${escapeHtml(name)}">
      <div class="image-delete" title="Remove image">×</div>
    `;

    item.querySelector(".image-delete")?.addEventListener("click", () => {
      item.remove();
    });

    item.addEventListener("mouseenter", (e) =>
      this.showImagePreview(base64, e)
    );
    item.addEventListener("mouseleave", () => this.hideImagePreview());

    imageAttachmentsEl.appendChild(item);
  }

  private showImagePreview(base64: string, event: MouseEvent): void {
    const { imagePreviewPopover } = this.elements;
    const img = imagePreviewPopover.querySelector("img")!;
    img.src = base64;
    imagePreviewPopover.style.display = "block";

    const x = Math.min(
      event.clientX + 10,
      this.win.innerWidth - imagePreviewPopover.offsetWidth - 20
    );
    const y = Math.max(
      20,
      event.clientY - imagePreviewPopover.offsetHeight - 10
    );
    imagePreviewPopover.style.left = x + "px";
    imagePreviewPopover.style.top = y + "px";
  }

  private hideImagePreview(): void {
    this.elements.imagePreviewPopover.style.display = "none";
  }

  addMessage(
    text: string,
    type: "user" | "assistant" | "error" | "system"
  ): HTMLElement {
    const div = this.doc.createElement("div");
    div.className = "message " + type;
    div.setAttribute("role", "article");
    div.setAttribute("tabindex", "0");

    const label =
      type === "user"
        ? "Your message"
        : type === "assistant"
          ? "Agent response"
          : type === "error"
            ? "Error message"
            : "System message";
    div.setAttribute("aria-label", label);

    if (type === "assistant" || type === "user") {
      div.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const msgText = this.messageTexts.get(div) || div.textContent || "";
        this.vscode.postMessage({ type: "copyMessage", text: msgText });
      });
    }

    div.textContent = text;
    this.messageTexts.set(div, text);
    this.elements.messagesEl.appendChild(div);
    this.elements.messagesEl.scrollTop = this.elements.messagesEl.scrollHeight;

    this.announceToScreenReader(label + ": " + text.substring(0, 100));
    return div;
  }

  private announceToScreenReader(message: string): void {
    const announcement = this.doc.createElement("div");
    announcement.setAttribute("role", "status");
    announcement.setAttribute("aria-live", "polite");
    announcement.className = "sr-only";
    announcement.textContent = message;
    this.doc.body.appendChild(announcement);
    setTimeout(() => announcement.remove(), 1000);
  }

  showThinking(): void {
    if (!this.thinkingEl) {
      this.thinkingEl = this.doc.createElement("div");
      this.thinkingEl.className = "message assistant";
      this.thinkingEl.setAttribute("role", "status");
      this.thinkingEl.setAttribute("aria-label", "Agent is thinking");
      this.elements.messagesEl.appendChild(this.thinkingEl);
    }
    let html = '<span class="thinking" aria-label="Processing">Thinking</span>';
    html += getToolsHtml(this.tools, this.expandedToolId);
    this.thinkingEl.innerHTML = html;
    this.elements.messagesEl.scrollTop = this.elements.messagesEl.scrollHeight;
  }

  hideThinking(): void {
    if (this.thinkingEl) {
      this.thinkingEl.remove();
      this.thinkingEl = null;
    }
  }

  updateStatus(state: string): void {
    this.elements.statusDot.className = "status-dot " + state;
    this.isConnected = state === "connected";
    this.updateViewState();
    this.saveState();
  }

  updateViewState(): void {
    const hasMessages = this.elements.messagesEl.children.length > 0;
    this.elements.welcomeView.style.display =
      !this.isConnected && !hasMessages ? "flex" : "none";
    this.elements.messagesEl.style.display =
      this.isConnected || hasMessages ? "flex" : "none";
  }

  showPlan(entries: PlanEntry[]): void {
    if (entries.length === 0) {
      this.hidePlan();
      return;
    }

    if (!this.planEl) {
      this.planEl = this.doc.createElement("div");
      this.planEl.className = "agent-plan-sticky";
      this.planEl.setAttribute("role", "status");
      this.planEl.setAttribute("aria-live", "polite");
      this.planEl.setAttribute("aria-label", "Agent execution plan");
      this.elements.planContainer.appendChild(this.planEl);
    }

    const completedCount = entries.filter(
      (e) => e.status === "completed"
    ).length;
    const totalCount = entries.length;

    this.planEl.innerHTML = `
      <div class="plan-header">
        <span class="plan-icon">📋</span>
        <span class="plan-title">Agent Plan</span>
        <span class="plan-progress">${completedCount}/${totalCount}</span>
      </div>
      <div class="plan-entries">
        ${entries
          .map(
            (entry) => `
          <div class="plan-entry plan-entry-${entry.status} plan-priority-${entry.priority}">
            <span class="plan-status-icon">${this.getPlanStatusIcon(entry.status)}</span>
            <span class="plan-content">${escapeHtml(entry.content)}</span>
          </div>
        `
          )
          .join("")}
      </div>
    `;
  }

  private getPlanStatusIcon(status: string): string {
    switch (status) {
      case "completed":
        return "✓";
      case "in_progress":
        return "⋯";
      case "pending":
      default:
        return "○";
    }
  }

  hidePlan(): void {
    if (this.planEl) {
      this.planEl.remove();
      this.planEl = null;
    }
  }

  private send(): void {
    const text = this.elements.inputEl.textContent?.trim() || "";
    const images = Array.from(
      this.elements.imageAttachmentsEl.querySelectorAll("img")
    ).map((img) => img.src);
    const mentions: Mention[] = Array.from(
      this.elements.inputEl.querySelectorAll(".mention-chip")
    ).map((chip) => ({
      name: (chip as HTMLElement).dataset.name || "",
      path: (chip as HTMLElement).dataset.path || "",
    }));

    if (!text && images.length === 0) return;

    this.vscode.postMessage({
      type: "sendMessage",
      text,
      images,
      mentions,
    });

    this.clearInput();
    this.elements.sendBtn.disabled = true;
    this.saveState();
  }

  private clearInput(): void {
    this.elements.inputEl.textContent = "";
    this.elements.imageAttachmentsEl.innerHTML = "";
    this.adjustHeight();
    this.elements.inputEl.focus();
    this.hideAutocomplete();
    this.saveState();
  }

  getFilteredCommands(query: string): AvailableCommand[] {
    if (!query.startsWith("/")) return [];
    const search = query.slice(1).toLowerCase();
    return this.availableCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().startsWith(search) ||
        cmd.description?.toLowerCase().includes(search)
    );
  }

  private updateAutocomplete(): void {
    const selection = this.win.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const textBefore =
      range.startContainer.textContent?.slice(0, range.startOffset) || "";

    const lastSlashIdx = textBefore.lastIndexOf("/");
    const lastAtIdx = textBefore.lastIndexOf("@");

    if (
      lastSlashIdx >= 0 &&
      lastSlashIdx >= lastAtIdx &&
      !textBefore.slice(lastSlashIdx).includes(" ")
    ) {
      this.autocompleteMode = "command";
      this.autocompleteTriggerPos = lastSlashIdx;
      const query = textBefore.slice(lastSlashIdx);
      const filtered = this.getFilteredCommands(query);
      this.selectedIndex = filtered.length > 0 ? 0 : -1;
      this.renderAutocomplete();
    } else if (
      lastAtIdx >= 0 &&
      lastAtIdx >= lastSlashIdx &&
      !textBefore.slice(lastAtIdx).includes(" ")
    ) {
      this.autocompleteMode = "file";
      this.autocompleteTriggerPos = lastAtIdx;
      const query = textBefore.slice(lastAtIdx + 1);
      this.selectedIndex = 0;
      this.vscode.postMessage({ type: "searchFiles", text: query });
    } else {
      this.hideAutocomplete();
    }
  }

  private renderAutocomplete(): void {
    const { commandAutocomplete } = this.elements;

    let itemsHtml = "";
    if (this.autocompleteMode === "command") {
      const text = this.elements.inputEl.textContent || "";
      const query = text.slice(this.autocompleteTriggerPos).split(/\s/)[0];
      const commands = this.getFilteredCommands(query);
      if (commands.length === 0) {
        this.hideAutocomplete();
        return;
      }
      itemsHtml = commands
        .map((cmd, i) => this.renderCommandItem(cmd, i))
        .join("");
    } else if (this.autocompleteMode === "file") {
      if (this.fileResults.length === 0) {
        this.hideAutocomplete();
        return;
      }
      itemsHtml = this.fileResults
        .map((file, i) => this.renderFileItem(file, i))
        .join("");
    }

    if (itemsHtml) {
      commandAutocomplete.innerHTML = itemsHtml;
      commandAutocomplete.classList.add("visible");
      this.elements.inputEl.setAttribute("aria-expanded", "true");
    } else {
      this.hideAutocomplete();
    }
  }

  private renderCommandItem(cmd: AvailableCommand, i: number): string {
    const hint = cmd.input?.hint
      ? '<div class="command-hint">' + escapeHtml(cmd.input.hint) + "</div>"
      : "";
    return `
      <div class="command-item ${i === this.selectedIndex ? "selected" : ""}" data-index="${i}" role="option" aria-selected="${i === this.selectedIndex}">
        <div class="command-name">${escapeHtml(cmd.name)}</div>
        <div class="command-description">${escapeHtml(cmd.description || "")}</div>
        ${hint}
      </div>
    `;
  }

  private renderFileItem(
    file: { name: string; path: string },
    i: number
  ): string {
    return `
      <div class="command-item ${i === this.selectedIndex ? "selected" : ""}" data-index="${i}" role="option" aria-selected="${i === this.selectedIndex}">
        <div class="command-name">${escapeHtml(file.name)}</div>
        <div class="command-description">${escapeHtml(file.path)}</div>
      </div>
    `;
  }

  hideAutocomplete(): void {
    const { commandAutocomplete, inputEl } = this.elements;
    commandAutocomplete.classList.remove("visible");
    commandAutocomplete.innerHTML = "";
    this.selectedIndex = -1;
    this.autocompleteMode = "none";
    inputEl.setAttribute("aria-expanded", "false");
  }

  private selectAutocomplete(index: number): void {
    if (this.autocompleteMode === "command") {
      const text = this.elements.inputEl.textContent || "";
      const query = text.slice(this.autocompleteTriggerPos).split(/\s/)[0];
      const commands = this.getFilteredCommands(query);
      if (index >= 0 && index < commands.length) {
        const cmd = commands[index];
        this.replaceTriggerWithText("/" + cmd.name + " ");
      }
    } else if (this.autocompleteMode === "file") {
      if (index >= 0 && index < this.fileResults.length) {
        const file = this.fileResults[index];
        this.insertMentionChip(file);
      }
    }
    this.hideAutocomplete();
  }

  private replaceTriggerWithText(newText: string): void {
    const selection = this.win.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    range.setStart(range.startContainer, this.autocompleteTriggerPos);
    range.deleteContents();
    range.insertNode(this.doc.createTextNode(newText));

    selection.collapseToEnd();
    this.elements.inputEl.focus();
  }

  private insertMentionChip(file: { name: string; path: string }): void {
    const selection = this.win.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    range.setStart(range.startContainer, this.autocompleteTriggerPos);
    range.deleteContents();

    const chip = this.doc.createElement("span");
    chip.className = "mention-chip";
    chip.contentEditable = "false";
    chip.dataset.name = file.name;
    chip.dataset.path = file.path;
    chip.innerHTML = `
      <span class="chip-icon">📄</span>
      <span class="chip-label">${escapeHtml(file.name)}</span>
      <span class="chip-delete">×</span>
    `;

    chip.querySelector(".chip-delete")?.addEventListener("click", (e) => {
      e.stopPropagation();
      chip.remove();
      this.saveState();
    });

    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      this.vscode.postMessage({ type: "openFile", path: file.path });
    });

    range.insertNode(chip);
    const space = this.doc.createTextNode(" ");
    range.collapse(false);
    range.insertNode(space);
    selection.collapse(space, 1);
    this.elements.inputEl.focus();
    this.saveState();
  }

  handleMessage(msg: ExtensionMessage): void {
    switch (msg.type) {
      case "fileSearchResults":
        if (msg.results) {
          this.fileResults = msg.results;
          this.selectedIndex = this.fileResults.length > 0 ? 0 : -1;
          this.renderAutocomplete();
        }
        break;
      case "userMessage":
        if (msg.text) {
          this.addMessage(msg.text, "user");
          this.showThinking();
          this.updateViewState();
        }
        break;
      case "streamStart":
        this.currentAssistantText = "";
        this.hasActiveTool = false;
        this.hideThought();
        break;
      case "streamChunk":
        if (this.hasActiveTool && msg.text) {
          this.hideThinking();
          if (Object.keys(this.tools).length > 0) {
            const toolMessage = this.addMessage("", "assistant");
            toolMessage.innerHTML = getToolsHtml(
              this.tools,
              this.expandedToolId
            );
          }
          this.currentAssistantMessage = null;
          this.currentAssistantText = "";
          this.tools = {};
          this.expandedToolId = null;
          this.hasActiveTool = false;
        }

        if (!this.currentAssistantMessage) {
          this.hideThinking();
          this.currentAssistantMessage = this.addMessage("", "assistant");
        }
        if (msg.text) {
          this.currentAssistantText += msg.text;
          this.currentAssistantMessage.textContent = this.currentAssistantText;
          this.elements.messagesEl.scrollTop =
            this.elements.messagesEl.scrollHeight;
        }
        break;
      case "streamEnd":
        this.hideThinking();

        if (this.currentAssistantMessage) {
          let html = msg.html || "";
          if (this.currentAssistantText.trim()) {
            html = this.currentAssistantText + html;
          }
          html += getToolsHtml(this.tools, this.expandedToolId);
          this.currentAssistantMessage.innerHTML = html;
          this.messageTexts.set(
            this.currentAssistantMessage,
            this.currentAssistantText
          );
        }

        this.currentAssistantMessage = null;
        this.currentAssistantText = "";
        this.tools = {};
        this.hasActiveTool = false;
        this.expandedToolId = null;
        this.hideThought();
        this.elements.sendBtn.disabled = false;
        this.elements.inputEl.focus();
        break;
      case "toolCallStart":
        if (msg.toolCallId && msg.name) {
          // Finalize current text message before showing tools
          if (this.currentAssistantText.trim()) {
            this.finalizeCurrentMessage();
            this.currentAssistantMessage = null;
            this.currentAssistantText = "";
          }

          this.tools[msg.toolCallId] = {
            name: msg.name,
            input: null,
            output: null,
            status: "running",
            kind: msg.kind,
          };
          this.hasActiveTool = true;
          this.showThinking();
        }
        break;
      case "toolCallComplete":
        if (msg.toolCallId && this.tools[msg.toolCallId]) {
          const tool = this.tools[msg.toolCallId];

          let output = "";
          if (msg.content && msg.content.length > 0) {
            const firstContent = msg.content[0];
            if (firstContent.type === "content" && firstContent.content?.text) {
              output = firstContent.content.text;
            } else if (firstContent.type === "terminal") {
              output = msg.terminalOutput || "";
            } else if (firstContent.type === "diff") {
              output = renderDiff(
                firstContent.path,
                firstContent.oldText,
                firstContent.newText
              );
            }
          }

          if (!output) {
            output = msg.rawOutput?.output || "";
          }

          const input =
            msg.rawInput?.command || msg.rawInput?.description || "";
          if (msg.title) tool.name = msg.title;
          if (msg.kind) tool.kind = msg.kind;
          tool.input = input;
          tool.output = output;
          tool.status = (msg.status as Tool["status"]) || "completed";
          this.expandedToolId = msg.toolCallId;
          this.showThinking();
        }
        break;
      case "error":
        this.hideThinking();
        if (msg.text) this.addMessage(msg.text, "error");
        this.elements.sendBtn.disabled = false;
        this.elements.inputEl.focus();
        break;
      case "agentError":
        if (msg.text) this.addMessage(msg.text, "error");
        break;
      case "connectionState":
        if (msg.state) {
          this.updateStatus(msg.state);
        }
        break;
      case "agents":
        if (!msg.agents) break;
        this.agentDropdown.setOptions(
          msg.agents.map((a) => ({
            id: a.id,
            name: a.name,
            available: a.available,
          })),
          msg.selected
        );
        break;
      case "agentChanged":
      case "chatCleared":
        this.elements.messagesEl.innerHTML = "";
        this.currentAssistantMessage = null;
        this.messageTexts.clear();
        this.elements.modeDropdown.style.display = "none";
        this.elements.modelDropdown.style.display = "none";
        this.availableCommands = [];
        this.hideAutocomplete();
        this.hidePlan();
        this.hideThought();
        this.updateViewState();
        break;
      case "triggerNewChat":
        this.vscode.postMessage({ type: "newChat" });
        break;
      case "triggerClearChat":
        this.vscode.postMessage({ type: "clearChat" });
        break;
      case "sessionMetadata": {
        const hasModes =
          msg.modes &&
          msg.modes.availableModes &&
          msg.modes.availableModes.length > 0;
        const hasModels =
          msg.models &&
          msg.models.availableModels &&
          msg.models.availableModels.length > 0;

        if (hasModes && msg.modes) {
          this.elements.modeDropdown.style.display = "flex";
          this.modeDropdown.setOptions(
            msg.modes.availableModes.map((m) => ({
              id: m.id,
              name: m.name || m.id,
            })),
            msg.modes.currentModeId
          );
        } else {
          this.elements.modeDropdown.style.display = "none";
        }

        if (hasModels && msg.models) {
          this.elements.modelDropdown.style.display = "flex";
          this.modelDropdown.setOptions(
            msg.models.availableModels.map((m) => ({
              id: m.modelId,
              name: m.name || m.modelId,
            })),
            msg.models.currentModelId
          );
        } else {
          this.elements.modelDropdown.style.display = "none";
        }

        if (msg.commands && Array.isArray(msg.commands)) {
          this.availableCommands = msg.commands;
        }
        break;
      }
      case "modeUpdate":
        if (msg.modeId) {
          this.modeDropdown.setValue(msg.modeId);
        }
        break;
      case "availableCommands":
        if (msg.commands && Array.isArray(msg.commands)) {
          this.availableCommands = msg.commands;
        }
        break;
      case "plan":
        if (msg.plan && msg.plan.entries) {
          this.showPlan(msg.plan.entries);
        }
        break;
      case "planComplete":
        this.hidePlan();
        break;
      case "thoughtChunk":
        if (msg.text) {
          this.appendThought(msg.text);
        }
        break;
    }
  }

  appendThought(text: string): void {
    this.thoughtText += text;

    if (!this.thoughtEl) {
      this.thoughtEl = this.doc.createElement("details");
      this.thoughtEl.className = "agent-thought";
      this.thoughtEl.setAttribute("open", "");
      this.thoughtEl.setAttribute("role", "status");
      this.thoughtEl.setAttribute("aria-live", "polite");
      this.thoughtEl.setAttribute("aria-label", "Assistant is thinking");
      this.thoughtEl.innerHTML = `
        <summary class="thought-header">
          <span class="thought-icon">💭</span>
          <span class="thought-title">Thinking...</span>
        </summary>
        <div class="thought-content"></div>
      `;
      this.elements.messagesEl.appendChild(this.thoughtEl);
    }

    const contentEl = this.thoughtEl.querySelector(".thought-content");
    if (contentEl) {
      contentEl.textContent = this.thoughtText;
    }
    this.elements.messagesEl.scrollTop = this.elements.messagesEl.scrollHeight;
  }

  hideThought(): void {
    if (this.thoughtEl) {
      this.thoughtEl.remove();
      this.thoughtEl = null;
      this.thoughtText = "";
    }
  }

  private finalizeCurrentMessage(): void {
    if (this.currentAssistantMessage && this.currentAssistantText.trim()) {
      const html =
        this.currentAssistantText +
        getToolsHtml(this.tools, this.expandedToolId);
      this.currentAssistantMessage.innerHTML = html;
      this.messageTexts.set(
        this.currentAssistantMessage,
        this.currentAssistantText
      );
    }
  }

  getTools(): Record<string, Tool> {
    return this.tools;
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }
}

export function initWebview(
  vscode: VsCodeApi,
  doc: Document,
  win: Window
): WebviewController {
  const elements = getElements(doc);
  return new WebviewController(vscode, elements, doc, win);
}

if (typeof acquireVsCodeApi !== "undefined") {
  const vscode = acquireVsCodeApi();
  initWebview(vscode, document, window);
}
