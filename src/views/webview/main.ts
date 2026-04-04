import { marked } from "marked";
import { renderToolSummary, renderToolDetails } from "./tool-render";

export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): T;
}

// Configure marked for streaming (GFM and line breaks)
marked.setOptions({
  breaks: true,
  gfm: true,
});

declare function acquireVsCodeApi(): VsCodeApi;

export type ToolKind =
  | "read"
  | "edit"
  | "write"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export interface Tool {
  id: string;
  name: string;
  input: string | null;
  output: string | null;
  status: "running" | "completed" | "failed";
  kind?: ToolKind;
  element?: HTMLElement;
}

export type BlockType = "text" | "thought" | "tool";

export interface Block {
  type: BlockType;
  element: HTMLElement;
  contentEl: HTMLElement;
  content: string;
  toolId?: string;
  kind?: ToolKind;
  title?: string;
  status?: string;
}

export interface WebviewState {
  isConnected: boolean;
  inputValue: string;
  diffChanges?: Array<{
    path: string;
    relativePath: string;
    oldText: string | null;
    newText: string;
    status: string;
  }>;
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

export interface ToolCallLocation {
  path: string;
  line?: number;
}

export interface ToolCallSummary {
  toolCallId: string;
  title: string;
  kind?: ToolKind;
  status: string;
  locations?: ToolCallLocation[];
  rawInput?: {
    command?: string;
    description?: string;
    path?: string;
    cwd?: string;
    args?: string[];
    [key: string]: unknown;
  };
  rawOutput?: { output?: string };
  content?: ToolCallContentItem[];
  duration?: number;
  terminalOutput?: string;
}

export interface ExtensionMessage {
  type: string;
  text?: string;
  html?: string;
  state?: string;
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
  agentId?: string;
  agentName?: string;
  name?: string;
  title?: string;
  kind?: ToolKind;
  content?: ToolCallContentItem[];
  rawInput?: {
    command?: string;
    description?: string;
    path?: string;
    cwd?: string;
    args?: string[];
    [key: string]: unknown;
  };
  rawOutput?: { output?: string };
  status?: string;
  terminalOutput?: string;
  results?: Array<{
    name: string;
    path: string;
    dir: string;
    type: "file" | "folder";
    fsPath: string;
  }>;
  mention?: Mention;
  plan?: { entries: PlanEntry[] };
  requestId?: string;
  toolCall?: {
    kind?: string;
    title?: string;
    description?: string;
  };
  options?: Array<{
    optionId: string;
    kind: string;
    name: string;
  }>;
  locations?: ToolCallLocation[];
  duration?: number;
  images?: string[];
  mentions?: Mention[];
  changes?: Array<{
    path: string;
    relativePath: string;
    oldText: string | null;
    newText: string;
    status: string;
  }>;
}

export interface Mention {
  name: string;
  path?: string;
  type?: "file" | "folder" | "selection" | "terminal" | "image";
  content?: string;
  range?: { startLine: number; endLine: number };
  dataUrl?: string; // For images
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
  read: "codicon codicon-file-text",
  edit: "codicon codicon-edit",
  write: "codicon codicon-edit",
  delete: "codicon codicon-trash",
  move: "codicon codicon-references",
  search: "codicon codicon-search",
  execute: "codicon codicon-terminal",
  think: "codicon codicon-lightbulb",
  fetch: "codicon codicon-globe",
  switch_mode: "codicon codicon-sync",
  other: "codicon codicon-gear",
};

export function getToolKindIcon(kind?: string): string {
  if (!kind) return "";
  const lower = kind.toLowerCase();

  if (lower in TOOL_KIND_ICONS) {
    return TOOL_KIND_ICONS[lower as ToolKind];
  }

  // Handle technical names by prefix/substring
  if (lower.startsWith("read")) return TOOL_KIND_ICONS.read;
  if (lower.startsWith("write")) return TOOL_KIND_ICONS.write;
  if (
    lower.startsWith("edit") ||
    lower.startsWith("patch") ||
    lower.includes("replace")
  )
    return TOOL_KIND_ICONS.edit;
  if (lower.startsWith("search") || lower.startsWith("grep"))
    return TOOL_KIND_ICONS.search;
  if (
    lower.startsWith("execute") ||
    lower.startsWith("run") ||
    lower === "bash" ||
    lower === "sh"
  )
    return TOOL_KIND_ICONS.execute;
  if (lower.startsWith("delete") || lower.startsWith("remove"))
    return TOOL_KIND_ICONS.delete;
  if (lower.startsWith("move") || lower.startsWith("rename"))
    return TOOL_KIND_ICONS.move;

  return TOOL_KIND_ICONS.other;
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
  oldLineNumber?: number;
  newLineNumber?: number;
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
    return newText!.split("\n").map((line, idx) => ({
      type: "add" as const,
      line,
      newLineNumber: idx + 1,
    }));
  }
  if (!newText) {
    // Deleted file - all lines are deletions
    return oldText!.split("\n").map((line, idx) => ({
      type: "remove" as const,
      line,
      oldLineNumber: idx + 1,
    }));
  }

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: DiffLine[] = [];

  let i = 0,
    j = 0;
  let oldLineNum = 1;
  let newLineNum = 1;

  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      result.push({
        type: "context",
        line: oldLines[i],
        oldLineNumber: oldLineNum++,
        newLineNumber: newLineNum++,
      });
      i++;
      j++;
    } else {
      // Look ahead to find a match
      let found = false;
      const lookahead = 10;
      for (let k = 1; k < lookahead; k++) {
        if (i + k < oldLines.length && oldLines[i + k] === newLines[j]) {
          // Found a match by skipping lines in old text (deletions)
          for (let l = 0; l < k; l++) {
            result.push({
              type: "remove",
              line: oldLines[i + l],
              oldLineNumber: oldLineNum++,
            });
          }
          i += k;
          found = true;
          break;
        }
        if (j + k < newLines.length && oldLines[i] === newLines[j + k]) {
          // Found a match by skipping lines in new text (additions)
          for (let l = 0; l < k; l++) {
            result.push({
              type: "add",
              line: newLines[j + l],
              newLineNumber: newLineNum++,
            });
          }
          j += k;
          found = true;
          break;
        }
      }

      if (!found) {
        // No match found in lookahead, treat as a replacement
        result.push({
          type: "remove",
          line: oldLines[i++],
          oldLineNumber: oldLineNum++,
        });
        result.push({
          type: "add",
          line: newLines[j++],
          newLineNumber: newLineNum++,
        });
      }
    }
  }

  // Add remaining lines
  while (i < oldLines.length) {
    result.push({
      type: "remove",
      line: oldLines[i++],
      oldLineNumber: oldLineNum++,
    });
  }
  while (j < newLines.length) {
    result.push({
      type: "add",
      line: newLines[j++],
      newLineNumber: newLineNum++,
    });
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

  const CONTEXT_LINES = 3;
  const showLineIndexes = new Set<number>();

  // Mark lines to show: changes and their context
  for (let i = 0; i < diffLines.length; i++) {
    if (diffLines[i].type !== "context") {
      for (
        let k = Math.max(0, i - CONTEXT_LINES);
        k <= Math.min(diffLines.length - 1, i + CONTEXT_LINES);
        k++
      ) {
        showLineIndexes.add(k);
      }
    }
  }

  if (showLineIndexes.size === 0) {
    return '<div class="diff-container"><div class="diff-empty">No changes found</div></div>';
  }

  let html = '<div class="diff-container">';

  if (path) {
    const filename = path.split("/").pop() || path;
    html += `<div class="diff-header" title="${escapeHtml(path)}">
      <span class="codicon codicon-file-text"></span>
      <span class="diff-path">${escapeHtml(filename)}</span>
    </div>`;
  }

  html += '<pre class="diff-content">';

  let lastIndex = -1;
  const sortedIndexes = Array.from(showLineIndexes).sort((a, b) => a - b);

  for (const idx of sortedIndexes) {
    const diffLine = diffLines[idx];

    // Add separator if there's a gap
    if (lastIndex !== -1 && idx > lastIndex + 1) {
      html += '<div class="diff-hunk-separator">...</div>';
    }

    const prefix =
      diffLine.type === "add" ? "+" : diffLine.type === "remove" ? "-" : " ";
    const className = "diff-line diff-" + diffLine.type;

    const oldNum = diffLine.oldLineNumber?.toString() || "";
    const newNum = diffLine.newLineNumber?.toString() || "";

    html += `<div class="${className}">`;
    html += `<span class="diff-line-number">${oldNum}</span>`;
    html += `<span class="diff-line-number">${newNum}</span>`;
    html += `<span class="diff-line-prefix">${prefix}</span>`;
    html += `<span class="diff-line-code">${escapeHtml(diffLine.line)}</span>`;
    html += `</div>`;

    lastIndex = idx;
  }

  html += "</pre>";
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
      const iconClass = getToolKindIcon(tool.kind);
      const kindSpan = iconClass
        ? `<span class="tool-kind-icon ${iconClass}" title="${escapeHtml(tool.kind || "other")}"></span> `
        : "";
      const statusIcon =
        tool.status === "completed"
          ? '<span class="codicon codicon-check"></span>'
          : tool.status === "failed"
            ? '<span class="codicon codicon-close"></span>'
            : '<span class="codicon codicon-loading animate-spin"></span>';
      const statusClass = tool.status === "running" ? "running" : "";
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
      const isExpanded = id === expandedToolId;
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
      item.setAttribute("data-id", opt.id);

      item.innerHTML = `<span>${escapeHtml(opt.name)}</span>`;

      item.addEventListener("click", () => {
        this.select(opt.id);
        this.close();
      });

      this.popover.appendChild(item);
    });
  }
}

export interface WebviewElements {
  messagesEl: HTMLElement;
  inputEl: HTMLElement;
  attachImageBtn: HTMLButtonElement;
  imagePreviewPopover: HTMLElement;
  sendBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
  modeDropdown: HTMLElement;
  modelDropdown: HTMLElement;
  welcomeView: HTMLElement;
  commandAutocomplete: HTMLElement;
  planContainer: HTMLElement;
  typingIndicatorEl: HTMLElement;
  diffSummaryContainer: HTMLElement;
}

export function getElements(doc: Document): WebviewElements {
  return {
    messagesEl: doc.getElementById("messages")!,
    inputEl: doc.getElementById("input")!,
    attachImageBtn: doc.getElementById("attach-image") as HTMLButtonElement,
    imagePreviewPopover: doc.getElementById("image-preview-popover")!,
    sendBtn: doc.getElementById("send") as HTMLButtonElement,
    stopBtn: doc.getElementById("stop") as HTMLButtonElement,
    modeDropdown: doc.getElementById("mode-dropdown")!,
    modelDropdown: doc.getElementById("model-dropdown")!,
    welcomeView: doc.getElementById("welcome-view")!,
    commandAutocomplete: doc.getElementById("command-autocomplete")!,
    planContainer: doc.getElementById("agent-plan-container")!,
    typingIndicatorEl: doc.getElementById("typing-indicator")!,
    diffSummaryContainer: doc.getElementById("diff-summary-container")!,
  };
}

export class WebviewController {
  private vscode: VsCodeApi;
  private elements: WebviewElements;
  private doc: Document;
  private win: Window;

  private currentAssistantMessage: HTMLElement | null = null;
  private activeBlock: Block | null = null;
  private blocks: Block[] = [];
  private planEl: HTMLElement | null = null;
  private planEntries: PlanEntry[] = [];
  private isPlanExpanded = false;
  private isConnected = false;
  private messageTexts = new Map<HTMLElement, string>();
  private availableCommands: AvailableCommand[] = [];
  private fileResults: Array<{
    name: string;
    path: string;
    dir: string;
    type: "file" | "folder";
    fsPath: string;
  }> = [];
  private selectedIndex = -1;
  private autocompleteMode: "none" | "command" | "file" = "none";
  private autocompleteTriggerPos = -1;

  private modeDropdown: Dropdown;
  private modelDropdown: Dropdown;
  private isGenerating = false;
  private hoveredImageChip: HTMLElement | null = null;
  private diffChanges: Array<{
    path: string;
    relativePath: string;
    oldText: string | null;
    newText: string;
    status: string;
  }> = [];
  private diffSummaryExpanded = false;

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
    this.updateInputState();
    this.vscode.postMessage({ type: "ready" });
  }

  private showPermissionDialog(
    requestId: string,
    toolCall: { kind?: string; title?: string; description?: string },
    options: Array<{ optionId: string; kind: string; name: string }>,
    toolCallId?: string
  ): void {
    const wasGenerating = this.isGenerating;
    // Always block input while waiting for permission
    this.setGenerating(true);

    if (options.length === 0) {
      options.push({
        optionId: "cancel",
        kind: "reject_once",
        name: "Cancel (No options provided)",
      });
    }

    // Try to find the tool block to embed the permission UI
    let targetContainer: HTMLElement | null = null;
    if (toolCallId) {
      const block = this.blocks.find(
        (b) => b.type === "tool" && b.toolId === toolCallId
      );
      if (block) {
        targetContainer = block.contentEl;
      }
    }

    if (targetContainer) {
      this.renderEmbeddedPermission(
        targetContainer,
        requestId,
        toolCall,
        options,
        wasGenerating
      );
    } else {
      this.renderPermissionOverlay(requestId, toolCall, options, wasGenerating);
    }
  }

  private handlePermissionOptionClick(
    requestId: string,
    option: { optionId: string; kind: string },
    cleanup: () => void,
    wasGenerating: boolean
  ): void {
    const isReject = option.kind.startsWith("reject");
    const outcome = isReject
      ? { outcome: "cancelled" as const }
      : { outcome: "selected" as const, optionId: option.optionId };

    this.vscode.postMessage({
      type: "permissionResponse",
      requestId,
      outcome,
    });

    cleanup();
    this.setGenerating(wasGenerating);
  }

  private renderEmbeddedPermission(
    container: HTMLElement,
    requestId: string,
    toolCall: { kind?: string; title?: string; description?: string },
    options: Array<{ optionId: string; kind: string; name: string }>,
    wasGenerating: boolean
  ): void {
    const wrapper = this.doc.createElement("div");
    wrapper.className = "embedded-permission";

    const header = this.doc.createElement("div");
    header.className = "embedded-permission-header";
    header.innerHTML = `<span class="permission-icon codicon codicon-lock"></span> <span>Permission Required</span>`;

    const body = this.doc.createElement("div");
    body.className = "embedded-permission-body";

    if (toolCall.description) {
      const desc = this.doc.createElement("div");
      desc.className = "permission-tool-desc";
      desc.style.marginBottom = "8px";
      desc.textContent = toolCall.description;
      body.appendChild(desc);
    }

    const optionsContainer = this.doc.createElement("div");
    optionsContainer.className = "embedded-permission-options";

    options.forEach((opt) => {
      const btn = this.doc.createElement("button");
      const isAllow = !opt.kind.startsWith("reject");
      const isAlways = opt.kind.endsWith("always");

      btn.className = `embedded-permission-option ${
        isAllow
          ? "embedded-permission-option-allow"
          : "embedded-permission-option-reject"
      } ${isAlways ? "embedded-permission-option-always" : ""}`;

      const icon = this.doc.createElement("span");
      icon.className = "embedded-permission-option-icon";
      icon.innerHTML = isAllow
        ? `<div class="codicon codicon-check"></div>`
        : `<div class="codicon codicon-close"></div>`;

      const text = this.doc.createElement("span");
      const label = this.getOptionLabel(opt.kind);
      text.textContent = `${label}: ${opt.name}`;

      btn.appendChild(icon);
      btn.appendChild(text);

      btn.addEventListener("click", () => {
        this.handlePermissionOptionClick(
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
    this.elements.messagesEl.scrollTop = this.elements.messagesEl.scrollHeight;
  }

  private renderPermissionOverlay(
    requestId: string,
    toolCall: { kind?: string; title?: string; description?: string },
    options: Array<{ optionId: string; kind: string; name: string }>,
    wasGenerating: boolean
  ): void {
    const overlay = this.doc.createElement("div");
    overlay.className = "permission-dialog-overlay";

    const dialog = this.doc.createElement("div");
    dialog.className = "permission-dialog";

    const header = this.doc.createElement("div");
    header.className = "permission-dialog-header";
    header.innerHTML = `
      <span class="permission-icon codicon codicon-lock"></span>
      <span>Permission Required</span>
    `;

    const body = this.doc.createElement("div");
    body.className = "permission-dialog-body";

    const info = this.doc.createElement("div");
    info.className = "permission-tool-info";

    const kind = this.doc.createElement("div");
    kind.className = "permission-tool-kind";
    kind.textContent = toolCall.kind || "Unknown";

    const title = this.doc.createElement("div");
    title.className = "permission-tool-title";
    title.textContent = toolCall.title || "Tool Call";

    info.appendChild(kind);
    info.appendChild(title);

    if (toolCall.description) {
      const desc = this.doc.createElement("div");
      desc.className = "permission-tool-desc";
      desc.textContent = toolCall.description;
      info.appendChild(desc);
    }

    const optionsContainer = this.doc.createElement("div");
    optionsContainer.className = "permission-options";

    options.forEach((opt) => {
      const btn = this.doc.createElement("button");
      btn.className = `permission-option-btn permission-option-${opt.kind}`;

      const label = this.getOptionLabel(opt.kind);
      btn.textContent = `${label}: ${opt.name}`;

      btn.addEventListener("click", () => {
        this.handlePermissionOptionClick(
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

    this.doc.body.appendChild(overlay);
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

  private updateInputState(): void {
    const text = this.elements.inputEl.textContent?.trim() || "";
    const hasMentions =
      this.elements.inputEl.querySelectorAll(".mention-chip").length > 0;

    // If the hovered image chip is no longer present, hide the preview
    if (
      this.hoveredImageChip &&
      !this.elements.inputEl.contains(this.hoveredImageChip)
    ) {
      this.hoveredImageChip = null;
      this.hideImagePreview();
    }

    // Fix for placeholder: if truly empty of text and mentions, ensure innerHTML is empty
    // to allow :empty CSS selector to work.
    if (!text && !hasMentions) {
      if (this.elements.inputEl.innerHTML !== "") {
        this.elements.inputEl.innerHTML = "";
      }
    }

    this.elements.sendBtn.disabled =
      (!text && !hasMentions) || this.isGenerating;
  }

  private updatePlaceholder(agentName: string): void {
    const placeholder = `Ask ${agentName.toLowerCase()}... (type / for commands, @ for files)`;
    this.elements.inputEl.setAttribute("data-placeholder", placeholder);
  }

  private adjustHeight(): void {
    const { inputEl } = this.elements;
    inputEl.style.height = "auto";
    const maxHeight = this.win.innerHeight / 3;
    const scrollHeight = inputEl.scrollHeight;
    const newHeight = Math.max(52, Math.min(scrollHeight, maxHeight));
    inputEl.style.height = newHeight + "px";
    inputEl.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
  }

  private restoreState(): void {
    const previousState = this.vscode.getState<WebviewState>();
    if (previousState) {
      this.isConnected = previousState.isConnected;
      if (previousState.inputValue) {
        this.elements.inputEl.innerHTML = previousState.inputValue;
        // Re-attach listeners to mention chips
        const chips = Array.from(
          this.elements.inputEl.querySelectorAll(".mention-chip")
        );
        chips.forEach((chip) => {
          const c = chip as HTMLElement;
          const mention: Mention = {
            name: c.dataset.name || "",
            path: c.dataset.path,
            type: c.dataset.type as Mention["type"],
            content: c.dataset.content,
            dataUrl: c.dataset.dataUrl,
            range: c.dataset.range
              ? {
                  startLine: parseInt(c.dataset.range.split("-")[0], 10),
                  endLine: parseInt(c.dataset.range.split("-")[1], 10),
                }
              : undefined,
          };
          const newChip = this.renderMentionChip(mention, false);
          c.replaceWith(newChip);
        });
      }
    }
  }

  private saveState(): void {
    this.vscode.setState<WebviewState>({
      isConnected: this.isConnected,
      inputValue: this.elements.inputEl.innerHTML || "",
      diffChanges: this.diffChanges,
    });
  }

  private setupEventListeners(): void {
    const { sendBtn, stopBtn, inputEl, messagesEl, attachImageBtn } =
      this.elements;

    const { commandAutocomplete } = this.elements;

    sendBtn.addEventListener("click", () => this.send());
    stopBtn.addEventListener("click", () => {
      this.vscode.postMessage({ type: "stop" });
    });

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
          this.scrollSelectedIntoView();
          return;
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
          this.renderAutocomplete();
          this.scrollSelectedIntoView();
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
      this.updateInputState();
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
      this.insertMentionChip({
        name: file.name,
        type: "image",
        dataUrl: base64,
      });
    };
    reader.readAsDataURL(file);
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

  public addMessage(
    text: string,
    type: "user" | "assistant" | "error" | "system",
    mentions?: Mention[]
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

    if (text) {
      const textEl = this.doc.createElement("div");
      textEl.className = "message-content-text";

      const placeholderRegex = /__MENTION_(\d+)__/g;
      let lastIndex = 0;
      let match;

      while ((match = placeholderRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          textEl.appendChild(
            this.doc.createTextNode(text.substring(lastIndex, match.index))
          );
        }

        const idx = parseInt(match[1], 10);
        if (mentions && mentions[idx]) {
          textEl.appendChild(this.renderMentionChip(mentions[idx], true));
        }

        lastIndex = placeholderRegex.lastIndex;
      }

      if (lastIndex < text.length) {
        textEl.appendChild(this.doc.createTextNode(text.substring(lastIndex)));
      }

      div.appendChild(textEl);

      // Clean text for copying (replace placeholders with labels)
      const cleanText = text.replace(/__MENTION_(\d+)__/g, (m, idx) => {
        const i = parseInt(idx, 10);
        return mentions && mentions[i] ? mentions[i].name : m;
      });
      this.messageTexts.set(div, cleanText);
    } else {
      this.messageTexts.set(div, "");
    }

    this.elements.messagesEl.appendChild(div);
    this.elements.messagesEl.scrollTop = this.elements.messagesEl.scrollHeight;

    if (text) {
      this.announceToScreenReader(label + ": " + text.substring(0, 100));
    }
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

  private ensureBlock(type: BlockType, toolId?: string): Block {
    if (this.activeBlock && this.activeBlock.type === type) {
      if (type !== "tool" || this.activeBlock.toolId === toolId) {
        return this.activeBlock;
      }
    }

    // If we're starting a new block and had an active one, finalize the old one.
    // This ensures thoughts fold as soon as the next thing (text or tool) starts.
    if (this.activeBlock) {
      this.finalizeBlock(this.activeBlock);
    }

    // Create new block
    if (!this.currentAssistantMessage) {
      this.currentAssistantMessage = this.addMessage("", "assistant");
      // If generating, move indicator to the bottom of the new message
      if (this.elements.typingIndicatorEl.classList.contains("visible")) {
        this.currentAssistantMessage.appendChild(
          this.elements.typingIndicatorEl
        );
      }
    }

    const blockEl = this.doc.createElement("div");
    blockEl.className = `block block-${type}`;

    let contentEl: HTMLElement;

    if (type === "thought") {
      const details = this.doc.createElement("details");
      details.className = "agent-thought";
      details.setAttribute("open", "");
      details.setAttribute("role", "status");
      details.setAttribute("aria-live", "polite");
      details.setAttribute("aria-label", "Assistant is thinking");
      details.innerHTML = `
        <summary class="thought-header">
          <span class="thought-icon"><span class="codicon codicon-lightbulb"></span></span>
          <span class="thought-title">Thinking...</span>
        </summary>
        <div class="thought-content"></div>
      `;
      blockEl.appendChild(details);
      contentEl = details.querySelector(".thought-content")!;
    } else if (type === "tool") {
      const details = this.doc.createElement("details");
      details.className = "tool-item";
      details.setAttribute("open", "");
      details.innerHTML = `
        <summary class="tool-summary">
          <span class="tool-status running"><span class="codicon codicon-loading animate-spin"></span></span>
          <span class="tool-name">Initializing...</span>
        </summary>
        <div class="tool-details-content"></div>
      `;
      blockEl.appendChild(details);
      contentEl = details.querySelector(".tool-details-content")!;
    } else {
      contentEl = blockEl;
    }

    // Insert block before the typing indicator if it exists within the message
    if (
      this.elements.typingIndicatorEl.parentNode ===
      this.currentAssistantMessage
    ) {
      this.currentAssistantMessage.insertBefore(
        blockEl,
        this.elements.typingIndicatorEl
      );
    } else {
      this.currentAssistantMessage.appendChild(blockEl);
    }

    const block: Block = {
      type,
      element: blockEl,
      contentEl,
      content: "",
      toolId,
    };

    this.activeBlock = block;
    this.blocks.push(block);
    return block;
  }

  private updateAssistantMessageText(): void {
    if (this.currentAssistantMessage) {
      const allText = this.blocks
        .filter((b) => b.type === "text")
        .map((b) => b.content)
        .join("\n\n");
      this.messageTexts.set(this.currentAssistantMessage, allText);
    }
  }

  private finalizeBlock(block: Block): void {
    if (block.type === "thought") {
      const details = block.element.querySelector("details");
      if (details) {
        details.removeAttribute("open");
        const title = details.querySelector(".thought-title");
        if (title) title.textContent = "Thought Process";
      }
    } else if (block.type === "tool") {
      const details = block.element.querySelector("details");
      if (details) {
        // Keep edit/write tools open if they are completed successfully
        // This matches the user's request for "Zed-style" visibility
        const isWriteOrEdit = block.kind === "edit" || block.kind === "write";

        const shouldKeepOpen = isWriteOrEdit || block.status === "failed";

        if (!shouldKeepOpen) {
          details.removeAttribute("open");
        }
      }
    }
  }

  private finalizeBlocks(): void {
    this.blocks.forEach((block) => {
      this.finalizeBlock(block);
    });
    this.activeBlock = null;
  }

  public showThinking(): void {
    this.ensureBlock("thought");
  }

  public hideThinking(): void {
    if (this.activeBlock && this.activeBlock.type === "thought") {
      this.finalizeBlock(this.activeBlock);
      this.activeBlock = null;
    }
  }

  public appendThought(text: string): void {
    const block = this.ensureBlock("thought");
    block.content += text;
    block.contentEl.innerHTML = marked.parse(block.content) as string;
    this.elements.messagesEl.scrollTop = this.elements.messagesEl.scrollHeight;
  }

  public hideThought(): void {
    this.hideThinking();
  }

  public getTools(): Record<string, Tool> {
    const tools: Record<string, Tool> = {};
    this.blocks
      .filter((b) => b.type === "tool" && b.toolId)
      .forEach((b) => {
        const isRunning =
          b.element.querySelector(".tool-status.running") !== null;

        // Handle new detail-input or old tool-input
        const detailInput = b.element.querySelector(".detail-input");
        const toolInput = b.element.querySelector(".tool-input");
        let inputText = "";

        if (detailInput) {
          // In new structure, command is often prefixed with $ in a div
          const cmdDiv = detailInput.querySelector("div");
          if (cmdDiv && cmdDiv.textContent?.startsWith("$ ")) {
            inputText = cmdDiv.textContent.substring(2);
          } else {
            inputText = detailInput.textContent || "";
          }
        } else if (toolInput) {
          inputText = toolInput.textContent || "";
        }

        const input = inputText.startsWith("$ ")
          ? inputText.substring(2)
          : inputText.startsWith("$")
            ? inputText.substring(1).trim()
            : inputText;

        // Clean up name which might contain duration
        let name = b.element.querySelector(".tool-name")?.textContent || "Tool";
        if (name.includes(" | ")) {
          name = name.split(" | ")[0];
        }

        tools[b.toolId!] = {
          id: b.toolId!,
          name: name,
          input: input || null,
          output: b.element.querySelector(".tool-output")?.textContent || null,
          status: isRunning ? "running" : "completed",
          kind: b.kind,
        };
      });
    return tools;
  }

  public updateStatus(state: string): void {
    this.isConnected = state === "connected";
    this.updateViewState();
    this.saveState();
  }

  updateViewState(): void {
    const hasMessages = this.elements.messagesEl.children.length > 0;
    this.elements.welcomeView.style.display = !hasMessages ? "flex" : "none";
    this.elements.messagesEl.style.display = hasMessages ? "flex" : "none";
  }

  showPlan(entries: PlanEntry[]): void {
    if (entries.length === 0) {
      this.hidePlan();
      return;
    }

    this.planEntries = entries;

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
    const inProgressCount = entries.filter(
      (e) => e.status === "in_progress"
    ).length;

    // Get the label text based on current state
    const planLabel = this.getPlanLabel(
      completedCount,
      totalCount,
      inProgressCount
    );

    this.planEl.innerHTML = `
      <div class="plan-header" role="button" tabindex="0" aria-expanded="${this.isPlanExpanded}">
        <span class="plan-toggle-icon ${this.isPlanExpanded ? "expanded" : "collapsed"}"></span>
        <span class="plan-title">${planLabel}</span>
        <span class="plan-progress">${completedCount}/${totalCount}</span>
      </div>
      <div class="plan-entries ${this.isPlanExpanded ? "" : "collapsed"}">
        ${entries
          .map(
            (entry) => `
          <div class="plan-entry plan-entry-${entry.status} plan-priority-${entry.priority}">
            <span class="plan-status-icon">${this.getPlanStatusHtml(entry.status)}</span>
            <span class="plan-content">${escapeHtml(entry.content)}</span>
          </div>
        `
          )
          .join("")}
      </div>
    `;

    // Add click handler for toggle - always re-bind since innerHTML recreates elements
    const headerEl = this.planEl.querySelector(".plan-header");
    if (headerEl) {
      // Use onclick to avoid duplicate bindings
      (headerEl as HTMLElement).onclick = () => this.togglePlan();
      headerEl.addEventListener("keydown", (e: Event) => {
        const keyboardEvent = e as KeyboardEvent;
        if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
          e.preventDefault();
          this.togglePlan();
        }
      });
    }
  }

  private getPlanLabel(
    completedCount: number,
    totalCount: number,
    inProgressCount: number
  ): string {
    if (this.isPlanExpanded) {
      return "Plan";
    }

    // When collapsed, show "Plan(Current): xxxx" format
    if (inProgressCount > 0) {
      const currentEntry = this.planEntries.find(
        (e) => e.status === "in_progress"
      );
      if (currentEntry) {
        // Truncate long content
        const content =
          currentEntry.content.length > 50
            ? currentEntry.content.substring(0, 50) + "..."
            : currentEntry.content;
        return `Plan(Current): ${content}`;
      }
    }

    // If no in-progress, show the last completed item or first pending
    if (completedCount > 0) {
      const lastCompleted = [...this.planEntries]
        .reverse()
        .find((e) => e.status === "completed");
      if (lastCompleted) {
        const content =
          lastCompleted.content.length > 50
            ? lastCompleted.content.substring(0, 50) + "..."
            : lastCompleted.content;
        return `Plan(Current): ${content}`;
      }
    }

    // Default: show first pending item
    const firstPending = this.planEntries.find((e) => e.status === "pending");
    if (firstPending) {
      const content =
        firstPending.content.length > 50
          ? firstPending.content.substring(0, 50) + "..."
          : firstPending.content;
      return `Plan(Current): ${content}`;
    }

    return "Plan(Current)";
  }

  private togglePlan(): void {
    this.isPlanExpanded = !this.isPlanExpanded;
    this.showPlan(this.planEntries);
  }

  private getPlanStatusHtml(status: string): string {
    switch (status) {
      case "completed":
        return '<span class="codicon codicon-check"></span>';
      case "in_progress":
        return '<span class="codicon codicon-loading animate-spin"></span>';
      case "pending":
      default:
        return '<span class="codicon codicon-circle-outline"></span>';
    }
  }

  hidePlan(): void {
    if (this.planEl) {
      this.planEl.remove();
      this.planEl = null;
    }
    this.planEntries = [];
    this.isPlanExpanded = false;
  }

  private send(): void {
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
          const type = el.dataset.type as Mention["type"];
          const dataUrl = el.dataset.dataUrl;

          const mention: Mention = {
            name: el.dataset.name || "",
            path: el.dataset.path,
            type,
            content: el.dataset.content,
            dataUrl,
            range: el.dataset.range
              ? {
                  startLine: parseInt(el.dataset.range.split("-")[0], 10),
                  endLine: parseInt(el.dataset.range.split("-")[1], 10),
                }
              : undefined,
          };

          if (type === "image" && dataUrl) {
            images.push(dataUrl);
          }

          const idx = mentions.length;
          mentions.push(mention);
          text += `__MENTION_${idx}__`;
        } else if (el.tagName === "BR") {
          text += "\n";
        } else {
          text += el.textContent;
        }
      }
    });

    text = text.trim();
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
    this.elements.inputEl.innerHTML = "";
    this.adjustHeight();
    this.elements.inputEl.focus();
    this.hideAutocomplete();
    this.hideImagePreview();
    this.saveState();
    this.updateInputState();
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
        <div class="command-icon codicon codicon-symbol-misc"></div>
        <div class="command-content">
          <div class="command-name"><span class="trigger-char">/</span>${escapeHtml(cmd.name)}</div>
          ${cmd.description ? '<div class="command-description">' + escapeHtml(cmd.description) + "</div>" : ""}
          ${hint}
        </div>
      </div>
    `;
  }

  private renderFileItem(
    file: {
      name: string;
      path: string;
      dir: string;
      type: "file" | "folder";
      fsPath: string;
    },
    i: number
  ): string {
    const isFolder = file.type === "folder";
    const iconClass = isFolder
      ? "codicon codicon-folder"
      : this.getFileIconClass(file.name);

    // 单行显示：文件名 + 路径
    const displayPath = file.dir ? escapeHtml(file.dir + "/") : "";

    return `
      <div class="command-item ${i === this.selectedIndex ? "selected" : ""}" data-index="${i}" role="option" aria-selected="${i === this.selectedIndex}" data-fspath="${escapeHtml(file.fsPath)}">
        <div class="command-icon ${iconClass}"></div>
        <div class="command-content">
          <div class="command-name">
            <span class="file-name">${escapeHtml(file.name)}</span>
            ${displayPath ? '<span class="file-path">' + displayPath + "</span>" : ""}
          </div>
        </div>
      </div>
    `;
  }

  private getFileIconClass(fileName: string): string {
    const extension = fileName.split(".").pop()?.toLowerCase() || "";
    const iconMap: Record<string, string> = {
      ts: "codicon codicon-file-code",
      tsx: "codicon codicon-file-code",
      js: "codicon codicon-file-code",
      jsx: "codicon codicon-file-code",
      json: "codicon codicon-json",
      md: "codicon codicon-markdown",
      css: "codicon codicon-file-code",
      html: "codicon codicon-file-code",
      png: "codicon codicon-file-media",
      jpg: "codicon codicon-file-media",
      jpeg: "codicon codicon-file-media",
      gif: "codicon codicon-file-media",
      svg: "codicon codicon-file-media",
    };
    return iconMap[extension] || "codicon codicon-file";
  }

  private getFileIcon(fileName: string): string {
    const extension = fileName.split(".").pop()?.toLowerCase() || "";
    const iconMap: Record<string, string> = {
      ts: "codicon codicon-file-code",
      tsx: "codicon codicon-file-code",
      js: "codicon codicon-file-code",
      jsx: "codicon codicon-file-code",
      json: "codicon codicon-json",
      md: "codicon codicon-markdown",
      css: "codicon codicon-file-code",
      html: "codicon codicon-file-code",
      png: "codicon codicon-file-media",
      jpg: "codicon codicon-file-media",
      jpeg: "codicon codicon-file-media",
      gif: "codicon codicon-file-media",
      svg: "codicon codicon-file-media",
    };
    return iconMap[extension] || "codicon codicon-file";
  }

  private scrollSelectedIntoView(): void {
    const { commandAutocomplete } = this.elements;
    const selectedItem = commandAutocomplete.querySelector(
      ".command-item.selected"
    );
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
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
        this.insertMentionChip({
          name: file.name,
          path: file.fsPath,
          type: file.type,
        });
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
    this.adjustHeight();
  }

  private renderMentionChip(mention: Mention, readonly = false): HTMLElement {
    const chip = this.doc.createElement("span");
    chip.className = "mention-chip" + (readonly ? " readonly" : "");
    chip.contentEditable = "false";

    chip.dataset.name = mention.name;
    if (mention.path) chip.dataset.path = mention.path;
    chip.dataset.type = mention.type || "file";
    if (mention.content) chip.dataset.content = mention.content;
    if (mention.range)
      chip.dataset.range = `${mention.range.startLine}-${mention.range.endLine}`;
    if (mention.dataUrl) chip.dataset.dataUrl = mention.dataUrl;

    const mentionType = mention.type || "file";

    const typeConfigs: Record<
      string,
      {
        icon: string;
        onClick?: (e: MouseEvent) => void;
        onHover?: (e: MouseEvent) => void;
      }
    > = {
      file: {
        icon: "codicon codicon-file-text",
        onClick: (e) => {
          if (mention.path) {
            e.stopPropagation();
            this.vscode.postMessage({ type: "openFile", path: mention.path });
          }
        },
      },
      selection: {
        icon: "codicon codicon-file-text",
      },
      terminal: {
        icon: "codicon codicon-terminal",
      },
      image: {
        icon: "codicon codicon-file-media",
        onHover: (e) => {
          if (mention.dataUrl) {
            if (!readonly) this.hoveredImageChip = chip;
            this.showImagePreview(mention.dataUrl, e);
          }
        },
      },
    };

    const config = typeConfigs[mentionType] || typeConfigs.file;

    let innerHTML = `<span class="chip-icon ${config.icon}"></span><span class="chip-label">${escapeHtml(mention.name)}</span>`;

    if (!readonly) {
      innerHTML += `<div class="chip-delete" title="Remove attachment"><span class="codicon codicon-close"></span></div>`;
    }

    chip.innerHTML = innerHTML;

    if (!readonly) {
      chip.querySelector(".chip-delete")?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.hoveredImageChip = null;
        this.hideImagePreview();
        chip.remove();
        this.saveState();
        this.updateInputState();
      });
    }

    if (config.onClick) {
      chip.addEventListener("click", config.onClick);
    }

    if (config.onHover) {
      chip.addEventListener("mouseenter", (e) => config.onHover!(e));
      chip.addEventListener("mouseleave", (e) => {
        if (!readonly) {
          // Don't hide if moving to a child element (like the delete button)
          if (
            e.relatedTarget instanceof Node &&
            chip.contains(e.relatedTarget as Node)
          ) {
            return;
          }
          this.hoveredImageChip = null;
        }
        this.hideImagePreview();
      });
    }

    return chip;
  }

  private insertMentionChip(mention: Mention): void {
    const selection = this.win.getSelection();
    if (!selection) return;

    let range: Range;
    if (this.autocompleteMode !== "none" && selection.rangeCount > 0) {
      range = selection.getRangeAt(0);
      range.setStart(range.startContainer, this.autocompleteTriggerPos);
      range.deleteContents();
    } else {
      this.elements.inputEl.focus();
      const currentSelection = this.win.getSelection();
      if (!currentSelection || currentSelection.rangeCount === 0) {
        // If no range, insert at end
        range = this.doc.createRange();
        range.selectNodeContents(this.elements.inputEl);
        range.collapse(false);
      } else {
        range = currentSelection.getRangeAt(0);
      }
    }

    const chip = this.renderMentionChip(mention, false);

    range.insertNode(chip);

    // After inserting the chip, insert a space and move the cursor
    const space = this.doc.createTextNode("\u00A0");
    range.setStartAfter(chip);
    range.insertNode(space);

    const selectionAfter = this.win.getSelection();
    if (selectionAfter) {
      selectionAfter.removeAllRanges();
      const newRange = this.doc.createRange();
      newRange.setStartAfter(space);
      newRange.collapse(true);
      selectionAfter.addRange(newRange);
    }

    this.elements.inputEl.focus();
    this.saveState();
    this.updateInputState();
    this.adjustHeight();
  }

  private setGenerating(isGenerating: boolean): void {
    this.isGenerating = isGenerating;
    const { typingIndicatorEl, messagesEl, sendBtn, stopBtn } = this.elements;
    if (isGenerating) {
      sendBtn.style.display = "none";
      stopBtn.style.display = "flex";
      typingIndicatorEl.classList.add("visible");
      // Move indicator to the end of the current assistant message if it exists,
      // otherwise to the end of the messages container
      if (this.currentAssistantMessage) {
        this.currentAssistantMessage.appendChild(typingIndicatorEl);
      } else {
        messagesEl.appendChild(typingIndicatorEl);
      }
    } else {
      sendBtn.style.display = "flex";
      stopBtn.style.display = "none";
      typingIndicatorEl.classList.remove("visible");
      this.updateInputState();
    }
  }

  private renderDiffSummary(): void {
    const { diffSummaryContainer } = this.elements;
    if (this.diffChanges.length === 0) {
      diffSummaryContainer.style.display = "none";
      diffSummaryContainer.innerHTML = "";
      return;
    }

    diffSummaryContainer.style.display = "block";

    // Calculate total stats
    let totalAdded = 0;
    let totalRemoved = 0;
    this.diffChanges.forEach((change) => {
      const diff = computeLineDiff(change.oldText, change.newText);
      totalAdded += diff.filter((l) => l.type === "add").length;
      totalRemoved += diff.filter((l) => l.type === "remove").length;
    });

    let html = `
      <div class="diff-summary-header">
        <div class="diff-summary-info">
          <span class="codicon codicon-sync"></span>
          <span class="diff-summary-title">${this.diffChanges.length} files modified</span>
          <span class="diff-stat-added">+${totalAdded}</span>
          <span class="diff-stat-removed">-${totalRemoved}</span>
        </div>
        <div class="diff-summary-actions">
          <button class="diff-action-btn accept-all" title="Accept All">
            <span class="codicon codicon-check"></span>
          </button>
          <button class="diff-action-btn rollback-all" title="Rollback All">
            <span class="codicon codicon-trash"></span>
          </button>
          <button class="diff-action-btn toggle-expand ${this.diffSummaryExpanded ? "expanded" : ""}" title="${this.diffSummaryExpanded ? "Collapse" : "Expand"}">
            <span class="codicon codicon-chevron-down"></span>
          </button>
        </div>
      </div>
    `;

    if (this.diffSummaryExpanded) {
      html += `<div class="diff-summary-list">`;
      this.diffChanges.forEach((change) => {
        const diff = computeLineDiff(change.oldText, change.newText);
        const added = diff.filter((l) => l.type === "add").length;
        const removed = diff.filter((l) => l.type === "remove").length;

        html += `
          <div class="diff-summary-item">
            <div class="diff-item-info" title="${escapeHtml(change.path)}">
      <span class="codicon codicon-file-text"></span>
              <span class="diff-item-path">${escapeHtml(change.relativePath)}</span>
              <span class="diff-stat-added">+${added}</span>
              <span class="diff-stat-removed">-${removed}</span>
            </div>
            <div class="diff-item-actions">
              <button class="diff-item-btn review" data-path="${escapeHtml(change.path)}" title="Review">
                <span class="codicon codicon-search"></span>
              </button>
              <button class="diff-item-btn accept" data-path="${escapeHtml(change.path)}" title="Accept">
                <span class="codicon codicon-check"></span>
              </button>
              <button class="diff-item-btn rollback" data-path="${escapeHtml(change.path)}" title="Rollback">
                <span class="codicon codicon-trash"></span>
              </button>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }

    diffSummaryContainer.innerHTML = html;

    // Add event listeners
    const toggleBtn = diffSummaryContainer.querySelector(".toggle-expand");
    toggleBtn?.addEventListener("click", () => {
      this.diffSummaryExpanded = !this.diffSummaryExpanded;
      this.renderDiffSummary();
    });

    const acceptAllBtn = diffSummaryContainer.querySelector(".accept-all");
    acceptAllBtn?.addEventListener("click", () => {
      this.vscode.postMessage({ type: "acceptAllDiffs" });
      this.diffChanges = [];
      this.renderDiffSummary();
      this.saveState();
    });

    const rollbackAllBtn = diffSummaryContainer.querySelector(".rollback-all");
    rollbackAllBtn?.addEventListener("click", () => {
      this.vscode.postMessage({ type: "rollbackAllDiffs" });
      this.diffChanges = [];
      this.renderDiffSummary();
      this.saveState();
    });

    diffSummaryContainer
      .querySelectorAll(".diff-item-btn.review")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const path = (btn as HTMLElement).dataset.path;
          this.vscode.postMessage({ type: "reviewDiff", path });
        });
      });

    diffSummaryContainer
      .querySelectorAll(".diff-item-btn.accept")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const path = (btn as HTMLElement).dataset.path;
          this.vscode.postMessage({ type: "acceptDiff", path });
          this.diffChanges = this.diffChanges.filter((c) => c.path !== path);
          this.renderDiffSummary();
          this.saveState();
        });
      });

    diffSummaryContainer
      .querySelectorAll(".diff-item-btn.rollback")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const path = (btn as HTMLElement).dataset.path;
          this.vscode.postMessage({ type: "rollbackDiff", path });
          this.diffChanges = this.diffChanges.filter((c) => c.path !== path);
          this.renderDiffSummary();
          this.saveState();
        });
      });
  }

  handleMessage(msg: ExtensionMessage): void {
    console.log("[Webview] Message received:", msg.type, msg);
    switch (msg.type) {
      case "fileSearchResults":
        if (msg.results) {
          this.fileResults = msg.results;
          this.selectedIndex = this.fileResults.length > 0 ? 0 : -1;
          this.renderAutocomplete();
        }
        break;
      case "userMessage":
        if (msg.text || (msg.images && msg.images.length > 0)) {
          // Reset assistant state before adding user message
          // This ensures subsequent streamChunk creates a new assistant message
          this.currentAssistantMessage = null;
          this.activeBlock = null;
          this.addMessage(msg.text || "", "user", msg.mentions);
          this.updateViewState();
        }
        break;
      case "addMention":
        if (msg.mention) {
          this.insertMentionChip(msg.mention);
        }
        break;
      case "streamStart":
        this.currentAssistantMessage = null;
        this.activeBlock = null;
        this.blocks = [];
        this.setGenerating(true);
        break;
      case "streamChunk":
        if (msg.text) {
          const block = this.ensureBlock("text");
          block.content += msg.text;
          block.contentEl.innerHTML = marked.parse(block.content) as string;
          this.updateAssistantMessageText();
          this.elements.messagesEl.scrollTop =
            this.elements.messagesEl.scrollHeight;
        }
        break;
      case "thoughtChunk":
        if (msg.text) {
          const block = this.ensureBlock("thought");
          block.content += msg.text;
          block.contentEl.innerHTML = marked.parse(block.content) as string;
          this.elements.messagesEl.scrollTop =
            this.elements.messagesEl.scrollHeight;
        }
        break;
      case "streamEnd":
        this.finalizeBlocks();
        this.setGenerating(false);
        this.elements.inputEl.focus();
        break;
      case "toolCallStart":
        if (msg.toolCallId && msg.name) {
          let block = this.blocks.find(
            (b) => b.type === "tool" && b.toolId === msg.toolCallId
          );
          if (!block) {
            block = this.ensureBlock("tool", msg.toolCallId);
          }
          if (block) {
            if (msg.kind) block.kind = msg.kind;
            if (msg.name) block.title = msg.name;

            const summary = block.element.querySelector("summary");
            if (summary) {
              const summaryHtml = renderToolSummary({
                toolCallId: msg.toolCallId,
                title: msg.name || block.title || "Tool",
                kind: msg.kind || block.kind,
                status: "in_progress",
                rawInput: msg.rawInput,
              });
              summary.innerHTML = summaryHtml;
            }
          }
          this.elements.messagesEl.scrollTop =
            this.elements.messagesEl.scrollHeight;
        }
        break;
      case "toolCallComplete":
        if (msg.toolCallId) {
          let block = this.blocks.find((b) => b.toolId === msg.toolCallId);
          if (!block) {
            block = this.ensureBlock("tool", msg.toolCallId);
          }
          if (block) {
            // Update metadata from completion message
            if (msg.kind) block.kind = msg.kind;
            if (msg.title) block.title = msg.title;
            if (msg.status) block.status = msg.status;

            const finalTitle =
              msg.title || block.title || block.toolId || "Tool";
            const summary = block.element.querySelector("summary");
            if (summary) {
              const summaryHtml = renderToolSummary({
                toolCallId: msg.toolCallId,
                title: finalTitle,
                kind: msg.kind || block.kind,
                status: msg.status || "completed",
                locations: msg.locations,
                rawInput: msg.rawInput,
                duration: msg.duration,
              });
              summary.innerHTML = summaryHtml;
            }

            const detailsHtml = renderToolDetails({
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
            block.contentEl.innerHTML = detailsHtml;

            this.finalizeBlock(block);
          }
        }
        break;
      case "error":
        if (msg.text) this.addMessage(msg.text, "error");
        this.setGenerating(false);
        this.elements.inputEl.focus();
        break;
      case "agentError":
        if (msg.text) this.addMessage(msg.text, "error");
        break;
      case "system":
        if (msg.text) this.addMessage(msg.text, "system");
        break;
      case "connectionState":
        if (msg.state) {
          this.updateStatus(msg.state);
        }
        break;
      case "agentChanged":
        if (msg.agentName) {
          this.updatePlaceholder(msg.agentName);
        }
        this.diffChanges = [];
        this.renderDiffSummary();
      // fallthrough
      case "chatCleared":
        this.elements.messagesEl.innerHTML = "";
        this.currentAssistantMessage = null;
        this.activeBlock = null;
        this.blocks = [];
        this.messageTexts.clear();
        this.hideAutocomplete();
        this.hidePlan();
        this.diffChanges = [];
        this.renderDiffSummary();
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
      case "diffSummary":
        if (msg.changes) {
          this.diffChanges = msg.changes;
          this.renderDiffSummary();
          this.saveState();
        }
        break;
      case "permissionRequest":
        if (msg.requestId && msg.toolCall && msg.options) {
          this.showPermissionDialog(
            msg.requestId,
            msg.toolCall,
            msg.options,
            msg.toolCallId
          );
        }
        break;
    }
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
