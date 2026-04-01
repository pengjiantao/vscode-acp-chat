# 工具调用 Block 展示信息增强计划

## 背景

当前 VSCode ACP 客户端的工具调用 block 展示信息较少，用户难以快速理解 agent 执行了哪些操作、作用于哪些文件、执行结果如何。本计划旨在扩展工具调用的展示信息，提供更丰富的人类友好总结，同时保留详细信息的可展开性。

---

## 一、当前状态分析

### 1.1 ACP 协议定义

根据 `@agentclientprotocol/sdk` schema，ToolCallUpdate 包含以下字段：

| 字段            | 类型               | 说明                                                                          |
| --------------- | ------------------ | ----------------------------------------------------------------------------- |
| `toolCallId`    | string             | 工具调用唯一标识                                                              |
| `title`         | string             | 人类可读标题                                                                  |
| `kind`          | ToolKind           | 工具类型 (read/edit/delete/move/search/execute/think/fetch/switch_mode/other) |
| `status`        | ToolCallStatus     | 执行状态 (pending/in_progress/completed/failed)                               |
| `content`       | ToolCallContent[]  | 内容数组 (content/diff/terminal 类型)                                         |
| `rawInput`      | object             | 原始输入参数                                                                  |
| `rawOutput`     | object             | 原始输出结果                                                                  |
| **`locations`** | ToolCallLocation[] | **文件位置 (path, line)**                                                     |

**ToolCallLocation 结构**：

```typescript
interface ToolCallLocation {
  path: string; // 文件路径 (必填)
  line?: number; // 行号 (可选)
}
```

### 1.2 当前代码实现

**chat.ts - 消息发送** (`src/views/chat.ts:505-547`)：

```typescript
this.postMessage({
  type: "toolCallComplete",
  toolCallId: update.toolCallId,
  title: update.title,
  kind: update.kind,
  content: update.content,
  rawInput: update.rawInput,
  rawOutput: update.rawOutput,
  status: update.status,
  terminalOutput,
});
```

**问题**：

1. `locations` 字段未被发送
2. `toolCallStart` 时未记录开始时间，无法计算执行时长
3. 前端仅展示工具名称和简单状态，无详细路径和时间信息

**webview/main.ts - 消息处理** (`src/views/webview/main.ts:1680-1720`)：

- 仅提取 `content` 中的文本/diff/terminal 内容
- 展示为可折叠的 `<details>` 元素
- 无路径、执行时间、意图等元信息展示

---

## 二、期望展示效果

### 2.1 人类友好总结行

每个工具调用以单行总结形式展示：

```
📖 Read: src/utils/helper.ts (45 lines) | 23ms ✓
✏️ Edit: src/index.js - modified 3 lines | 15ms ✓
🔍 Search: "TODO" in 12 files | 8ms ✓
🔧 Execute: npm install | 2.3s ✓
```

### 2.2 可展开详细信息

点击展开后显示：

```
📖 Read: src/utils/helper.ts (45 lines) | 23ms ✓
├─ 类型: read
├─ 路径: /home/user/project/src/utils/helper.ts
├─ 意图: Reading utility functions for refactoring
│
├─ 输入:
│   $ Read file
│   Path: src/utils/helper.ts
│   Line: 0, Limit: 50
│
├─ 输出:
│   [文件内容预览...]
│
└─ 状态: completed ✓
```

### 2.3 分类展示逻辑

| Kind        | 总结格式                            | 关键信息             |
| ----------- | ----------------------------------- | -------------------- |
| read        | `Read: {path} ({n} lines)`          | 文件路径、读取行数   |
| edit        | `Edit: {path} - modified {n} lines` | 文件路径、修改行数   |
| delete      | `Delete: {path}`                    | 文件路径             |
| move        | `Move: {from} → {to}`               | 源路径、目标路径     |
| search      | `Search: "{query}" in {n} files`    | 搜索内容、匹配文件数 |
| execute     | `Execute: {command}`                | 命令名称             |
| think       | `Think: {summary}`                  | 思考摘要             |
| fetch       | `Fetch: {url}`                      | URL                  |
| switch_mode | `Switch Mode: {mode}`               | 目标模式             |
| other       | `{title}`                           | 标题                 |

---

## 三、实现计划

### 3.1 阶段一：数据层增强

**目标**：确保所有必要信息从前端传递到 webview

**修改文件**：`src/views/chat.ts`

#### 1. 记录工具调用开始时间

在 `handleSessionUpdate` 中为每个 toolCallId 记录开始时间：

```typescript
// 新增成员变量
private toolCallStartTimes: Map<string, number> = new Map();

// 修改 tool_call 处理
} else if (update.sessionUpdate === "tool_call") {
  this.toolCallStartTimes.set(update.toolCallId, Date.now());
  this.postMessage({
    type: "toolCallStart",
    name: update.title,
    toolCallId: update.toolCallId,
    kind: update.kind,
  });
}
```

#### 2. 发送完整信息到 webview

修改 `tool_call_update` 处理：

```typescript
} else if (update.sessionUpdate === "tool_call_update") {
  if (update.status === "completed" || update.status === "failed") {
    const startTime = this.toolCallStartTimes.get(update.toolCallId);
    const duration = startTime ? Date.now() - startTime : undefined;
    this.toolCallStartTimes.delete(update.toolCallId);

    this.postMessage({
      type: "toolCallComplete",
      toolCallId: update.toolCallId,
      title: update.title,
      kind: update.kind,
      content: update.content,
      rawInput: update.rawInput,
      rawOutput: update.rawOutput,
      status: update.status,
      terminalOutput,
      locations: update.locations,      // 新增
      duration,                          // 新增
    });
  }
}
```

---

### 3.2 阶段二：Webview 类型扩展

**目标**：扩展前端类型定义以支持新字段

**修改文件**：`src/views/webview/main.ts`

#### 1. 扩展 ExtensionMessage 接口

在文件顶部添加新接口：

```typescript
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
```

#### 2. 扩展 ExtensionMessage 类型

在 `ExtensionMessage` 接口中添加新字段：

```typescript
export interface ExtensionMessage {
  // ... 现有字段 ...
  locations?: ToolCallLocation[];
  duration?: number;
}
```

---

### 3.3 阶段三：展示逻辑重写

**目标**：生成人类友好的总结行和可展开的详细信息

**修改文件**：`src/views/webview/main.ts`

#### 1. 新增工具总结生成函数

```typescript
function generateToolSummary(info: ToolCallSummary): string {
  const { kind, title, locations, rawInput, duration, status } = info;
  const icon = getToolKindIcon(kind);
  const statusIcon = status === "failed" ? "✗" : "✓";
  const durationStr = duration ? ` | ${formatDuration(duration)}` : "";

  switch (kind) {
    case "read": {
      const path = locations?.[0]?.path || rawInput?.path || title;
      const limit = rawInput?.limit;
      const lineCount = limit ? ` (${limit} lines)` : "";
      return `${icon} Read: ${path}${lineCount}${durationStr} ${statusIcon}`;
    }
    case "edit": {
      const path = locations?.[0]?.path || rawInput?.path || title;
      return `${icon} Edit: ${path}${durationStr} ${statusIcon}`;
    }
    case "search": {
      const query = rawInput?.command || rawInput?.description || title;
      return `${icon} Search: "${query}"${durationStr} ${statusIcon}`;
    }
    case "execute": {
      const cmd = rawInput?.command || title;
      return `${icon} Execute: ${cmd}${durationStr} ${statusIcon}`;
    }
    default:
      return `${icon} ${title}${durationStr} ${statusIcon}`;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
```

#### 2. 新增详细信息生成函数

```typescript
function generateToolDetailsHtml(info: ToolCallSummary): string {
  const { kind, locations, rawInput, rawOutput, content, terminalOutput } =
    info;
  let html = '<div class="tool-details-panel">';

  // 类型和状态
  html += `<div class="detail-section"><span class="detail-label">类型:</span> ${kind || "unknown"}</div>`;

  // 路径信息
  if (locations && locations.length > 0) {
    html +=
      '<div class="detail-section"><span class="detail-label">路径:</span>';
    for (const loc of locations) {
      html += `<div class="detail-path">${escapeHtml(loc.path)}${loc.line ? `:${loc.line}` : ""}</div>`;
    }
    html += "</div>";
  } else if (rawInput?.path) {
    html += `<div class="detail-section"><span class="detail-label">路径:</span> ${escapeHtml(rawInput.path)}</div>`;
  }

  // 意图描述
  if (rawInput?.description) {
    html += `<div class="detail-section"><span class="detail-label">意图:</span> ${escapeHtml(rawInput.description)}</div>`;
  }

  // 输入信息
  if (rawInput) {
    html +=
      '<div class="detail-section"><span class="detail-label">输入:</span>';
    html += '<pre class="detail-input">';
    if (rawInput.command) {
      html += `<div>$ ${escapeHtml(rawInput.command)}</div>`;
    }
    for (const [key, value] of Object.entries(rawInput)) {
      if (key !== "command" && key !== "description") {
        html += `<div>${key}: ${escapeHtml(String(value))}</div>`;
      }
    }
    html += "</pre></div>";
  }

  // 输出信息
  let output = "";
  if (content && content.length > 0) {
    const firstContent = content[0];
    if (firstContent.type === "content" && firstContent.content?.text) {
      output = firstContent.content.text;
    } else if (firstContent.type === "terminal") {
      output = terminalOutput || "";
    } else if (firstContent.type === "diff") {
      // diff 处理由 renderDiff 函数负责
      output = `[Diff: ${firstContent.path}]`;
    }
  } else if (rawOutput?.output) {
    output = rawOutput.output;
  }

  if (output) {
    const hasAnsi = hasAnsiCodes(output);
    const outputHtml = hasAnsi ? ansiToHtml(output) : escapeHtml(output);
    const terminalClass = hasAnsi ? " terminal" : "";
    html += `<div class="detail-section"><span class="detail-label">输出:</span>`;
    html += `<pre class="tool-output${terminalClass}">${outputHtml}</pre>`;
    html += "</div>";
  }

  html += "</div>";
  return html;
}
```

#### 3. 修改 toolCallComplete 处理逻辑

在 `WebviewController.handleMessage` 的 `toolCallComplete` case 中：

```typescript
case "toolCallComplete":
  if (msg.toolCallId) {
    const block = this.blocks.find((b) => b.toolId === msg.toolCallId);
    if (block) {
      const summary = block.element.querySelector("summary");
      if (summary) {
        // 生成友好总结
        const summaryText = generateToolSummary({
          toolCallId: msg.toolCallId,
          title: msg.title || block.toolId || "Tool",
          kind: msg.kind || block.kind,
          status: msg.status || "completed",
          locations: msg.locations,
          rawInput: msg.rawInput,
          duration: msg.duration,
        });
        summary.innerHTML = summaryText;
      }

      // 生成详细信息
      const detailsHtml = generateToolDetailsHtml({
        toolCallId: msg.toolCallId,
        title: msg.title,
        kind: msg.kind,
        status: msg.status,
        locations: msg.locations,
        rawInput: msg.rawInput,
        rawOutput: msg.rawOutput,
        content: msg.content,
        duration: msg.duration,
        terminalOutput: msg.terminalOutput,
      });
      block.contentEl.innerHTML = detailsHtml;

      // 保持展开状态或折叠
      const details = block.element.querySelector("details");
      if (details && msg.status !== "failed") {
        details.removeAttribute("open");
      }
    }
  }
  break;
```

---

### 3.4 阶段四：样式增强

**目标**：为新的展示元素添加样式

**修改文件**：`media/main.css` (或创建新样式)

```css
/* 工具调用总结行 */
.tool-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--vscode-font-family);
  font-size: 13px;
}

.tool-kind-icon {
  font-size: 14px;
}

.tool-duration {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.tool-status.completed {
  color: var(--vscode-terminal-ansiGreen);
}

.tool-status.failed {
  color: var(--vscode-terminal-ansiRed);
}

/* 详细信息面板 */
.tool-details-panel {
  padding: 8px 0;
  border-top: 1px solid var(--vscode-widget-border);
  margin-top: 8px;
}

.detail-section {
  margin-bottom: 8px;
}

.detail-label {
  font-weight: 600;
  color: var(--vscode-foreground);
  margin-right: 8px;
}

.detail-path {
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-textLink-foreground);
  margin-left: 16px;
}

.detail-input {
  background: var(--vscode-textBlockQuote-background);
  padding: 8px;
  border-radius: 4px;
  margin: 4px 0;
  overflow-x: auto;
}

.detail-input div {
  margin: 2px 0;
}

/* 工具输出 */
.tool-output {
  background: var(--vscode-textBlockQuote-background);
  padding: 8px;
  border-radius: 4px;
  margin: 4px 0;
  overflow-x: auto;
  max-height: 300px;
  overflow-y: auto;
}

.tool-output.terminal {
  font-family: var(--vscode-terminal-font-family);
  font-size: 12px;
}
```

---

## 四、验证清单

- [ ] `locations` 字段是否被 agent 正确发送
- [ ] `rawInput.description` 是否在需要时可用
- [ ] 执行时间统计是否准确
- [ ] 各类型工具调用的总结格式是否正确
- [ ] 详细信息展开/折叠行为是否符合预期
- [ ] ANSI 颜色代码是否正确渲染
- [ ] Diff 内容是否正确显示
- [ ] 终端输出是否正确显示
- [ ] 长输出是否正确截断

---

## 五、依赖与风险

### 5.1 依赖项

1. **Agent 端实现**：`locations` 字段的填充依赖 agent 端实现
   - 建议：在早期版本中添加 console.log 验证数据

2. **SDK 版本**：`@agentclientprotocol/sdk` 版本需支持 ToolCallUpdate 的 locations 字段

### 5.2 风险

1. **数据完整性**：部分工具调用可能不提供 `locations` 或 `description`，需有 fallback 逻辑
2. **性能影响**：详细信息渲染需考虑大输出场景，应有截断机制
3. **向后兼容**：新增字段需考虑旧版 agent 的兼容性

---

## 六、后续优化方向

1. **路径跳转**：点击总结行中的路径可跳转到对应文件
2. **差异高亮**：在 diff 视图中支持行内差异高亮
3. **输出搜索**：支持在工具输出中搜索
4. **执行历史**：记录一段时间内的工具调用统计
5. **Performance Insight**：汇总各类型工具调用的耗时分布

---

## 七、参考资料

- [ACP Protocol Specification](https://agentclientprotocol.com/protocol/tool-calls)
- [ToolCallUpdate Schema](../../node_modules/@agentclientprotocol/sdk/schema/schema.json)
- 当前实现：`src/views/chat.ts` - `handleSessionUpdate`
- Webview 实现：`src/views/webview/main.ts` - `WebviewController.handleMessage`
