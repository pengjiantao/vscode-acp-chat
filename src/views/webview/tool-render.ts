import {
  ToolKind,
  ToolCallSummary,
  escapeHtml,
  renderDiff,
  hasAnsiCodes,
  ansiToHtml,
} from "./main";

export interface ToolRenderer {
  renderSummary(info: ToolCallSummary): string;
  renderDetails(info: ToolCallSummary): string;
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

// 通用信息提取助手
function getIdentifier(info: ToolCallSummary): string {
  const { locations, rawInput, title } = info;
  // 1. 优先从 locations 提取 (后端通常在处理完成后填充)
  if (locations && locations.length > 0) return locations[0].path;

  // 2. 核心：检查是否有人性化的 title。
  // 如果 title 本身已经是一段描述性的文字（含空格且不是技术 ID），直接使用它。
  if (title && !isTechnicalName(title)) return title;

  // 3. 次优：从 rawInput 提取参数 (路径、文件、命令等)
  // 如果工具名是技术性的（如 read_file），提取具体的参数比显示技术名更有用。
  if (rawInput) {
    const p =
      rawInput.path ||
      rawInput.file ||
      rawInput.filePath ||
      rawInput.file_path ||
      rawInput.uri ||
      rawInput.filename ||
      rawInput.filepath ||
      rawInput.file_name ||
      rawInput.target ||
      rawInput.target_file ||
      rawInput.destination ||
      rawInput.destination_path ||
      rawInput.source ||
      rawInput.source_path;
    if (typeof p === "string" && p.length > 0 && p !== "true" && p !== "false")
      return p;

    const q =
      rawInput.pattern ||
      rawInput.query ||
      rawInput.search ||
      rawInput.keyword ||
      rawInput.regex ||
      rawInput.text;
    if (typeof q === "string" && q.length > 0) return q;

    const cmd = rawInput.command || rawInput.cmd || rawInput.script;
    if (typeof cmd === "string" && cmd.length > 0) return cmd;

    // 检查描述字段
    if (
      typeof rawInput.description === "string" &&
      rawInput.description &&
      !isTechnicalName(rawInput.description)
    )
      return rawInput.description;
  }

  // 4. 兜底：尝试从 rawInput 寻找任何其他的实质性字符串字段
  if (rawInput) {
    for (const [key, value] of Object.entries(rawInput)) {
      if (
        typeof value === "string" &&
        value.length > 0 &&
        !["tool", "kind", "id", "call_id", "description"].includes(
          key.toLowerCase()
        )
      ) {
        return value;
      }
    }
  }

  return title || "Tool";
}

function isTechnicalName(name: string): boolean {
  if (!name) return true;
  const lower = name.toLowerCase();
  const genericTitles = [
    "bash",
    "sh",
    "shell",
    "execute_command",
    "run_command",
    "read_file",
    "read_text_file",
    "readfile",
    "readtextfile",
    "write_file",
    "write_text_file",
    "writefile",
    "writetextfile",
    "write_to_file",
    "replace_file_content",
    "patch_file",
    "create_file",
    "view_file",
    "ls",
    "list_dir",
    "list_directory",
    "grep",
    "grep_search",
    "tool",
    "read",
    "write",
    "search",
    "execute",
    "run",
    "move",
    "delete",
    "remove",
    "edit",
    "think",
    "fetch",
    "curl",
    "wget",
    "http",
    "read file",
    "write file",
    "edit file",
    "delete file",
    "run command",
    "run shell command",
    "execute command",
    "search files",
    "list files",
    "list directory",
  ];

  return (
    genericTitles.includes(lower) ||
    // 如果没有空格且包含 _ 或 -，或者全是小写字母且较短，通常是技术性的工具名
    (!name.includes(" ") && (name.includes("_") || name.includes("-"))) ||
    // 全小写字母无空格且较短
    (name.length < 20 && /^[a-z]+$/.test(lower)) ||
    // 类似于 "Read XXX" 的简短动作描述 (只有两个词，第一个词是 generic)
    (name.split(" ").length <= 2 &&
      genericTitles.some((gt) => lower.startsWith(gt + " ")))
  );
}

function normalizeKindLabel(kind: string | undefined): string {
  if (!kind) return "Tool";
  const lower = kind.toLowerCase();

  if (lower.startsWith("read")) return "Read";
  if (lower.startsWith("write")) return "Write";
  if (
    lower.startsWith("edit") ||
    lower.startsWith("patch") ||
    lower.includes("replace")
  )
    return "Edit";
  if (lower.startsWith("search") || lower.startsWith("grep")) return "Search";
  if (
    lower.startsWith("execute") ||
    lower.startsWith("run") ||
    lower === "bash" ||
    lower === "sh"
  )
    return "Run";
  if (lower.startsWith("delete") || lower.startsWith("remove")) return "Delete";
  if (lower.startsWith("move") || lower.startsWith("rename")) return "Move";

  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

const BaseRenderer: ToolRenderer = {
  renderSummary(info: ToolCallSummary): string {
    const { kind, duration, status } = info;
    const iconClass = getToolKindIcon(kind);
    const icon = iconClass ? `<span class="${iconClass}"></span>` : "";
    const statusIcon =
      status === "failed"
        ? '<span class="codicon codicon-close"></span>'
        : status === "in_progress"
          ? '<span class="codicon codicon-loading animate-spin"></span>'
          : '<span class="codicon codicon-check"></span>';
    const statusClass =
      status === "failed"
        ? "failed"
        : status === "in_progress"
          ? "running"
          : "completed";
    const durationStr = duration ? ` | ${formatDuration(duration)}` : "";
    const identifier = getIdentifier(info);

    let kindLabel = normalizeKindLabel(kind);

    return `
      <span class="tool-status ${statusClass}">${statusIcon}</span>
      ${icon ? `<span class="tool-kind-icon">${icon}</span> ` : ""}
      <span class="tool-name"><strong>${kindLabel}:</strong> ${escapeHtml(identifier)}${durationStr}</span>
    `;
  },

  renderDetails(info: ToolCallSummary): string {
    const { kind, locations, rawInput, rawOutput, content, terminalOutput } =
      info;
    let html = '<div class="tool-details-panel">';

    // Type
    html += `<div class="detail-section"><span class="detail-label">Type:</span> ${kind || "unknown"}</div>`;

    // Locations
    if (locations && locations.length > 0) {
      html +=
        '<div class="detail-section"><span class="detail-label">Path:</span>';
      for (const loc of locations) {
        html += `<div class="detail-path">${escapeHtml(loc.path)}${loc.line ? `:${loc.line}` : ""}</div>`;
      }
      html += "</div>";
    } else {
      const p =
        rawInput?.path ||
        rawInput?.file ||
        rawInput?.filePath ||
        rawInput?.file_path ||
        rawInput?.uri ||
        rawInput?.filename ||
        rawInput?.target ||
        rawInput?.target_file ||
        rawInput?.destination ||
        rawInput?.source;
      if (typeof p === "string") {
        html += `<div class="detail-section"><span class="detail-label">Path:</span> ${escapeHtml(p)}</div>`;
      }
    }

    // Intent
    if (rawInput?.description) {
      html += `<div class="detail-section"><span class="detail-label">Intent:</span> ${escapeHtml(String(rawInput.description))}</div>`;
    }

    // Input Parameters
    if (rawInput) {
      const skipInputKeys = [
        "description",
        "content",
        "text",
        "newContent",
        "newText",
        "new_string",
        "old_string",
        "replacement",
        "path",
        "file",
        "filePath",
        "file_path",
        "filename",
        "uri",
      ];

      const hasDiff = content?.some((c) => c.type === "diff");

      const hasMeaningfulInput = Object.keys(rawInput).some((k) => {
        if (k === "description") return false;
        if (hasDiff && skipInputKeys.includes(k)) return false;
        return rawInput[k] !== undefined;
      });

      if (hasMeaningfulInput) {
        html +=
          '<div class="detail-section"><span class="detail-label">Input:</span>';
        html += '<pre class="detail-input">';
        for (const [key, value] of Object.entries(rawInput)) {
          if (key === "description") continue;
          if (hasDiff && skipInputKeys.includes(key)) continue;

          if (value !== undefined) {
            if (key === "command" || key === "pattern") {
              html += `<div><strong>$ ${escapeHtml(String(value))}</strong></div>`;
            } else {
              html += `<div><span class="param-key">${key}:</span> ${escapeHtml(String(value))}</div>`;
            }
          }
        }
        html += "</pre></div>";
      }
    }

    // Output / Content
    let hasOutput = false;
    if (content && content.length > 0) {
      for (const item of content) {
        if (item.type === "content" && item.content?.text) {
          html += `<div class="detail-section"><span class="detail-label">Output:</span>`;
          html += `<pre class="tool-output">${escapeHtml(item.content.text)}</pre></div>`;
          hasOutput = true;
        } else if (item.type === "terminal") {
          const output = terminalOutput || "";
          const hasAnsi = hasAnsiCodes(output);
          const outputHtml = hasAnsi ? ansiToHtml(output) : escapeHtml(output);
          const terminalClass = hasAnsi ? " terminal" : "";
          html += `<div class="detail-section"><span class="detail-label">Terminal:</span>`;
          html += `<pre class="tool-output${terminalClass}">${outputHtml}</pre></div>`;
          hasOutput = true;
        } else if (item.type === "diff") {
          html += renderDiff(item.path, item.oldText, item.newText);
          hasOutput = true;
        }
      }
    }

    if (!hasOutput) {
      let output = "";
      if (terminalOutput) {
        output = terminalOutput;
      } else if (rawOutput?.output) {
        output = String(rawOutput.output);
      }

      if (output) {
        const hasAnsi = hasAnsiCodes(output);
        const outputHtml = hasAnsi ? ansiToHtml(output) : escapeHtml(output);
        const terminalClass = hasAnsi ? " terminal" : "";
        html += `<div class="detail-section"><span class="detail-label">Output:</span>`;
        html += `<pre class="tool-output${terminalClass}">${outputHtml}</pre></div>`;
      }
    }

    html += "</div>";
    return html;
  },
};

// 专用渲染器映射
const Renderers: Partial<Record<ToolKind, ToolRenderer>> = {
  edit: {
    ...BaseRenderer,
    renderSummary(info) {
      const path = getIdentifier(info);
      const statusIcon =
        info.status === "failed"
          ? '<span class="codicon codicon-close"></span>'
          : info.status === "in_progress"
            ? '<span class="codicon codicon-loading animate-spin"></span>'
            : '<span class="codicon codicon-check"></span>';
      const durationStr = info.duration
        ? ` | ${formatDuration(info.duration)}`
        : "";
      return `
        <span class="tool-status ${info.status === "failed" ? "failed" : info.status === "in_progress" ? "running" : "completed"}">${statusIcon}</span>
        <span class="tool-kind-icon"><span class="codicon codicon-edit"></span></span>
        <span class="tool-name"><strong>Edit:</strong> ${escapeHtml(path)}${durationStr}</span>
      `;
    },
  },
  read: {
    ...BaseRenderer,
    renderSummary(info) {
      const path = getIdentifier(info);
      const limit = info.rawInput?.limit;
      const suffix = limit ? ` (${limit} lines)` : "";
      const statusIcon =
        info.status === "failed"
          ? '<span class="codicon codicon-close"></span>'
          : info.status === "in_progress"
            ? '<span class="codicon codicon-loading animate-spin"></span>'
            : '<span class="codicon codicon-check"></span>';
      const durationStr = info.duration
        ? ` | ${formatDuration(info.duration)}`
        : "";
      return `
        <span class="tool-status ${info.status === "failed" ? "failed" : info.status === "in_progress" ? "running" : "completed"}">${statusIcon}</span>
        <span class="tool-kind-icon"><span class="codicon codicon-file-text"></span></span>
        <span class="tool-name"><strong>Read:</strong> ${escapeHtml(path)}${suffix}${durationStr}</span>
      `;
    },
  },
  search: {
    ...BaseRenderer,
    renderSummary(info) {
      const query = getIdentifier(info);
      const statusIcon =
        info.status === "failed"
          ? '<span class="codicon codicon-close"></span>'
          : info.status === "in_progress"
            ? '<span class="codicon codicon-loading animate-spin"></span>'
            : '<span class="codicon codicon-check"></span>';
      const durationStr = info.duration
        ? ` | ${formatDuration(info.duration)}`
        : "";
      return `
        <span class="tool-status ${info.status === "failed" ? "failed" : info.status === "in_progress" ? "running" : "completed"}">${statusIcon}</span>
        <span class="tool-kind-icon"><span class="codicon codicon-search"></span></span>
        <span class="tool-name"><strong>Search:</strong> "${escapeHtml(query)}"${durationStr}</span>
      `;
    },
  },
};

export function renderToolSummary(info: ToolCallSummary): string {
  const renderer = Renderers[info.kind as ToolKind] || BaseRenderer;
  return renderer.renderSummary(info);
}

export function renderToolDetails(info: ToolCallSummary): string {
  const renderer = Renderers[info.kind as ToolKind] || BaseRenderer;
  return renderer.renderDetails(info);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
