import {
  ToolKind,
  ToolCallSummary,
  escapeHtml,
  getToolKindIcon,
  renderDiff,
  hasAnsiCodes,
  ansiToHtml,
} from "./main";

export interface ToolRenderer {
  renderSummary(info: ToolCallSummary): string;
  renderDetails(info: ToolCallSummary): string;
}

// 通用信息提取助手
function getIdentifier(info: ToolCallSummary): string {
  const { locations, rawInput, title } = info;
  // 1. 优先从 locations 提取
  if (locations && locations.length > 0) return locations[0].path;

  // 2. 检查描述字段
  if (
    rawInput &&
    typeof rawInput.description === "string" &&
    rawInput.description
  )
    return rawInput.description;

  // 3. 检查是否有“有意义”的 title。
  // 对于大部分现代 Agent (如 Claude)，title 已经是经过润色的人类可读描述。
  const genericTitles = [
    "bash",
    "sh",
    "shell",
    "execute_command",
    "read_file",
    "write_file",
    "ls",
    "grep",
    "tool",
    "read",
    "write",
    "search",
    "execute",
    "move",
    "delete",
    "edit",
    "think",
    "fetch",
  ];
  const isGeneric =
    !title ||
    title.startsWith("call_") ||
    /^[0-9a-f-]{32,}$/i.test(title) ||
    genericTitles.includes(title.toLowerCase());

  if (title && !isGeneric) return title;

  // 4. 从 rawInput 常见字段提取 (作为通用标题的补充)
  if (rawInput) {
    const p =
      rawInput.path ||
      rawInput.file ||
      rawInput.filePath ||
      rawInput.file_path ||
      rawInput.uri ||
      rawInput.filename ||
      rawInput.target;
    if (typeof p === "string") return p;

    const q =
      rawInput.pattern ||
      rawInput.query ||
      rawInput.search ||
      rawInput.keyword ||
      rawInput.regex ||
      rawInput.text;
    if (typeof q === "string") return q;

    const cmd = rawInput.command || rawInput.cmd || rawInput.script;
    if (typeof cmd === "string") return cmd;

    // 5. 兜底：尝试从 rawInput 寻找任何其他的字符串字段
    for (const [key, value] of Object.entries(rawInput)) {
      if (
        typeof value === "string" &&
        value.length > 0 &&
        !["tool", "kind", "id", "call_id"].includes(key.toLowerCase())
      ) {
        return value;
      }
    }
  }

  return title || "Tool";
}

const BaseRenderer: ToolRenderer = {
  renderSummary(info: ToolCallSummary): string {
    const { kind, duration, status } = info;
    const iconClass = getToolKindIcon(kind);
    const icon = iconClass ? `<span class="icon ${iconClass}"></span>` : "";
    const statusIcon =
      status === "failed"
        ? '<span class="icon icon-dismiss"></span>'
        : status === "in_progress"
          ? '<span class="icon icon-sparkle animate-spin"></span>'
          : '<span class="icon icon-checkmark"></span>';
    const statusClass =
      status === "failed"
        ? "failed"
        : status === "in_progress"
          ? "running"
          : "completed";
    const durationStr = duration ? ` | ${formatDuration(duration)}` : "";
    const identifier = getIdentifier(info);

    let kindLabel =
      (kind || "tool").charAt(0).toUpperCase() + (kind || "tool").slice(1);
    if (kind === "execute") kindLabel = "Run";

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
        rawInput?.target;
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
          ? '<span class="icon icon-dismiss"></span>'
          : info.status === "in_progress"
            ? '<span class="icon icon-sparkle animate-spin"></span>'
            : '<span class="icon icon-checkmark"></span>';
      const durationStr = info.duration
        ? ` | ${formatDuration(info.duration)}`
        : "";
      return `
        <span class="tool-status ${info.status === "failed" ? "failed" : info.status === "in_progress" ? "running" : "completed"}">${statusIcon}</span>
        <span class="tool-kind-icon"><span class="icon icon-edit"></span></span>
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
          ? '<span class="icon icon-dismiss"></span>'
          : info.status === "in_progress"
            ? '<span class="icon icon-sparkle animate-spin"></span>'
            : '<span class="icon icon-checkmark"></span>';
      const durationStr = info.duration
        ? ` | ${formatDuration(info.duration)}`
        : "";
      return `
        <span class="tool-status ${info.status === "failed" ? "failed" : info.status === "in_progress" ? "running" : "completed"}">${statusIcon}</span>
        <span class="tool-kind-icon"><span class="icon icon-document"></span></span>
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
          ? '<span class="icon icon-dismiss"></span>'
          : info.status === "in_progress"
            ? '<span class="icon icon-sparkle animate-spin"></span>'
            : '<span class="icon icon-checkmark"></span>';
      const durationStr = info.duration
        ? ` | ${formatDuration(info.duration)}`
        : "";
      return `
        <span class="tool-status ${info.status === "failed" ? "failed" : info.status === "in_progress" ? "running" : "completed"}">${statusIcon}</span>
        <span class="tool-kind-icon"><span class="icon icon-search"></span></span>
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
