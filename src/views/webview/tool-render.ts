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
  // 2. 从 rawInput 常见字段提取
  if (rawInput) {
    const p =
      rawInput.path || rawInput.file || rawInput.filePath || rawInput.uri;
    if (typeof p === "string") return p;

    const q =
      rawInput.pattern || rawInput.query || rawInput.search || rawInput.keyword;
    if (typeof q === "string") return q;

    const cmd = rawInput.command;
    if (typeof cmd === "string") return cmd;
  }
  // 3. 回退到 title，如果 title 看起来像 UUID/callID 且有其他信息，优先使用其他信息
  if (title && !title.startsWith("call_")) return title;

  return title || "Tool";
}

const BaseRenderer: ToolRenderer = {
  renderSummary(info: ToolCallSummary): string {
    const { kind, duration, status } = info;
    const icon = getToolKindIcon(kind);
    const statusIcon =
      status === "failed" ? "✗" : status === "in_progress" ? "⋯" : "✓";
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
    } else if (rawInput?.path || rawInput?.file) {
      html += `<div class="detail-section"><span class="detail-label">Path:</span> ${escapeHtml(String(rawInput.path || rawInput.file))}</div>`;
    }

    // Intent
    if (rawInput?.description) {
      html += `<div class="detail-section"><span class="detail-label">Intent:</span> ${escapeHtml(String(rawInput.description))}</div>`;
    }

    // Input Parameters
    if (rawInput) {
      html +=
        '<div class="detail-section"><span class="detail-label">Input:</span>';
      html += '<pre class="detail-input">';
      for (const [key, value] of Object.entries(rawInput)) {
        if (key !== "description" && value !== undefined) {
          if (key === "command" || key === "pattern") {
            html += `<div><strong>$ ${escapeHtml(String(value))}</strong></div>`;
          } else {
            html += `<div><span class="param-key">${key}:</span> ${escapeHtml(String(value))}</div>`;
          }
        }
      }
      html += "</pre></div>";
    }

    // Output
    let output = "";
    if (content && content.length > 0) {
      const firstContent = content[0];
      if (firstContent.type === "content" && firstContent.content?.text) {
        output = firstContent.content.text;
      } else if (firstContent.type === "terminal") {
        output = terminalOutput || "";
      } else if (firstContent.type === "diff") {
        output = renderDiff(
          firstContent.path,
          firstContent.oldText,
          firstContent.newText
        );
      }
    } else if (rawOutput?.output) {
      output = String(rawOutput.output);
    }

    if (output) {
      const hasAnsi = hasAnsiCodes(output);
      const outputHtml = hasAnsi ? ansiToHtml(output) : escapeHtml(output);
      const terminalClass = hasAnsi ? " terminal" : "";
      html += `<div class="detail-section"><span class="detail-label">Output:</span>`;
      html += `<pre class="tool-output${terminalClass}">${outputHtml}</pre>`;
      html += "</div>";
    }

    html += "</div>";
    return html;
  },
};

// 专用渲染器映射
const Renderers: Partial<Record<ToolKind, ToolRenderer>> = {
  read: {
    ...BaseRenderer,
    renderSummary(info) {
      const path = getIdentifier(info);
      const limit = info.rawInput?.limit;
      const suffix = limit ? ` (${limit} lines)` : "";
      const statusIcon =
        info.status === "failed"
          ? "✗"
          : info.status === "in_progress"
            ? "⋯"
            : "✓";
      const durationStr = info.duration
        ? ` | ${formatDuration(info.duration)}`
        : "";
      return `
        <span class="tool-status ${info.status === "failed" ? "failed" : info.status === "in_progress" ? "running" : "completed"}">${statusIcon}</span>
        <span class="tool-kind-icon">📖</span>
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
          ? "✗"
          : info.status === "in_progress"
            ? "⋯"
            : "✓";
      const durationStr = info.duration
        ? ` | ${formatDuration(info.duration)}`
        : "";
      return `
        <span class="tool-status ${info.status === "failed" ? "failed" : info.status === "in_progress" ? "running" : "completed"}">${statusIcon}</span>
        <span class="tool-kind-icon">🔍</span>
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
