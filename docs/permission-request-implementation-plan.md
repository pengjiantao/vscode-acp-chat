# Agent 权限请求处理实现计划

**版本**：1.0
**日期**：2026-04-01
**方案**：方案一 - 扩展 sessionUpdate 通知机制
**状态**：待实现

---

## 1. 概述

### 1.1 背景

当前 `vscode-acp` 扩展在处理 ACP Agent 权限请求时，采用静默自动批准的方式。用户无法知晓 Agent 何时请求权限，也无法拒绝潜在的危险操作。本计划旨在实现用户交互式权限审批功能。

### 1.2 目标

- 建立从 Agent → Client → Webview → 用户 的权限请求通道
- 向用户展示权限请求详情（工具类型、操作内容、风险提示）
- 支持四种权限选项：`allow_once`、`allow_always`、`reject_once`、`reject_always`
- 保持向后兼容，在无监听器时回退到 auto-approve

### 1.3 协议参考

- [ACP Protocol - Requesting Permission](https://agentclientprotocol.com/protocol/tool-calls#requesting-permission)
- [ACP Protocol - Tool Calls](https://agentclientprotocol.com/protocol/tool-calls)

---

## 2. 架构设计

### 2.1 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                         Agent Subprocess                         │
│  (opencode, claude, etc.)                                        │
│           │                                                       │
│           │ NDJSON (requestPermission)                           │
│           ▼                                                       │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              src/acp/client.ts                              │   │
│  │   requestPermission() → PermissionRequestListener           │   │
│  │          │                                                 │   │
│  │          │ (通知链)                                          │   │
│  └──────────┼─────────────────────────────────────────────────┘   │
│             │                                                     │
│             ▼                                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              src/views/chat.ts                               │   │
│  │   handlePermissionRequest() → webview.postMessage()        │   │
│  └─────────────────────────┬──────────────────────────────────┘   │
│                            │ postMessage                          │
│                            ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │              src/views/webview/main.ts                      │    │
│  │   permissionDialog → 用户交互 → 选择结果                     │    │
│  └─────────────────────────┬──────────────────────────────────┘    │
│                            │ postMessage                          │
│                            ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │              src/views/chat.ts                               │    │
│  │   resolvePermission() → ACPClient                          │    │
│  └─────────────────────────┬──────────────────────────────────┘    │
│                            │                                      │
│                            ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │              src/acp/client.ts                              │    │
│  │   return RequestPermissionResponse                         │    │
│  └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 组件职责

| 组件              | 职责                                                              |
| ----------------- | ----------------------------------------------------------------- |
| `client.ts`       | 维护权限请求监听器，调用监听器处理请求，fallback 到 auto-approve  |
| `chat.ts`         | 注册监听器，接收权限请求，转换为 Webview 消息，管理待处理权限队列 |
| `webview/main.ts` | 渲染权限对话框，收集用户选择，发送结果回 chat.ts                  |

---

## 3. 实现步骤

### Step 1: 扩展 `ACPClient` 添加权限监听器

**文件**：`src/acp/client.ts`

**修改内容**：

1. 添加类型定义：

```typescript
type PermissionCallback = (
  params: RequestPermissionRequest
) => Promise<RequestPermissionResponse>;

type PermissionRequestResolver = (response: RequestPermissionResponse) => void;
```

2. 添加成员变量：

```typescript
private permissionRequestListeners: Set<PermissionCallback> = new Set();
private pendingPermissionRequests: Map<string, PermissionRequestResolver> = new Map();
```

3. 添加公开方法：

```typescript
setOnPermissionRequest(callback: PermissionCallback): () => void {
  this.permissionRequestListeners.add(callback);
  return () => this.permissionRequestListeners.delete(callback);
}
```

4. 修改 `requestPermission` 实现：

```typescript
requestPermission: async (
  params: RequestPermissionRequest
): Promise<RequestPermissionResponse> => {
  console.log("[ACP] Permission request:", JSON.stringify(params, null, 2));

  // 记录原始 toolCall 信息用于日志
  const toolInfo = params.toolCall;
  console.log(
    "[ACP] Tool requiring permission:",
    toolInfo?.kind,
    toolInfo?.title
  );

  // 遍历所有注册的监听器
  for (const listener of this.permissionRequestListeners) {
    try {
      const response = await listener(params);
      if (response?.outcome?.outcome === "selected") {
        console.log(
          "[ACP] Permission granted by listener, optionId:",
          response.outcome.optionId
        );
        return response;
      }
      if (response?.outcome?.outcome === "cancelled") {
        console.log("[ACP] Permission denied by listener");
        return response;
      }
    } catch (error) {
      console.error("[ACP] Permission listener error:", error);
    }
  }

  // Fallback: 自动批准（保持向后兼容）
  const allowOption = params.options.find(
    (opt) => opt.kind === "allow_once" || opt.kind === "allow_always"
  );
  if (allowOption) {
    console.log(
      "[ACP] Auto-approving (fallback), optionId:",
      allowOption.optionId
    );
    return { outcome: { outcome: "selected", optionId: allowOption.optionId } };
  }

  console.log("[ACP] No allow option found, cancelling (fallback)");
  return { outcome: { outcome: "cancelled" } };
};
```

**关键点**：

- 监听器返回 `selected` → 立即返回该结果
- 监听器返回 `cancelled` → 立即返回取消
- 无监听器或监听器异常 → 回退到 auto-approve

---

### Step 2: 在 `ChatViewProvider` 中注册监听器

**文件**：`src/views/chat.ts`

**修改内容**：

1. 添加成员变量：

```typescript
private permissionQueue: Array<{
  id: string;
  params: RequestPermissionRequest;
  resolver: (response: RequestPermissionResponse) => void;
}> = [];
```

2. 添加处理方法：

```typescript
private handlePermissionRequest(
  params: RequestPermissionRequest
): Promise<RequestPermissionResponse> {
  return new Promise((resolve) => {
    const requestId = `perm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log("[Chat] Permission request:", params.toolCall?.title, params.toolCall?.kind);

    // 添加到队列
    this.permissionQueue.push({
      id: requestId,
      params,
      resolver: resolve,
    });

    // 发送到 webview
    this.postMessage({
      type: "permissionRequest",
      requestId,
      toolCall: {
        kind: params.toolCall?.kind,
        title: params.toolCall?.title,
        description: params.toolCall?.description,
      },
      options: params.options.map((opt) => ({
        optionId: opt.optionId,
        kind: opt.kind,
        name: opt.name,
      })),
    });
  });
}
```

3. 在构造函数中注册监听器：

```typescript
// 在构造函数中 this.acpClient.setOnStateChange 之后添加
this.acpClient.setOnPermissionRequest(this.handlePermissionRequest.bind(this));
```

4. 处理 Webview 返回的权限结果（新增 case）：

```typescript
case "permissionResponse":
  if (message.requestId && message.outcome) {
    const pending = this.permissionQueue.find(p => p.id === message.requestId);
    if (pending) {
      pending.resolver(message.outcome);
      this.permissionQueue = this.permissionQueue.filter(p => p.id !== message.requestId);
    }
  }
  break;
```

5. 处理超时逻辑（新增方法）：

```typescript
private timeoutPermissionRequest(
  requestId: string,
  timeoutMs: number = 60000
): void {
  setTimeout(() => {
    const pending = this.permissionQueue.find(p => p.id === requestId);
    if (pending) {
      console.log("[Chat] Permission request timeout, auto-cancelling");
      pending.resolver({ outcome: { outcome: "cancelled" } });
      this.permissionQueue = this.permissionQueue.filter(p => p.id !== requestId);
    }
  }, timeoutMs);
}
```

**关键点**：

- 每个请求生成唯一 ID 用于追踪
- 权限请求进入队列，支持超时管理
- Webview 响应通过 resolver 传回

---

### Step 3: Webview 新增权限对话框

**文件**：`src/views/webview/main.ts`

**修改内容**：

1. 添加消息类型：

```typescript
// 在 handleMessage 附近的类型定义中添加
interface PermissionRequestMessage {
  type: "permissionRequest";
  requestId: string;
  toolCall: {
    kind?: string;
    title?: string;
    description?: string;
  };
  options: Array<{
    optionId: string;
    kind: string;
    name: string;
  }>;
}

interface PermissionResponseMessage {
  type: "permissionResponse";
  requestId: string;
  outcome: {
    outcome: "selected" | "cancelled";
    optionId?: string;
  };
}
```

2. 添加权限对话框渲染方法：

```typescript
private showPermissionDialog(
  requestId: string,
  toolCall: PermissionRequestMessage["toolCall"],
  options: PermissionRequestMessage["options"]
): void {
  // 阻止其他输入
  this.setGenerating(true);

  const dialog = document.createElement("div");
  dialog.className = "permission-dialog-overlay";
  dialog.innerHTML = `
    <div class="permission-dialog">
      <div class="permission-dialog-header">
        <span class="permission-icon">🔐</span>
        <span>Permission Required</span>
      </div>
      <div class="permission-dialog-body">
        <div class="permission-tool-info">
          <div class="permission-tool-kind">${this.escapeHtml(toolCall.kind || "Unknown")}</div>
          <div class="permission-tool-title">${this.escapeHtml(toolCall.title || "Tool Call")}</div>
          ${toolCall.description ? `<div class="permission-tool-desc">${this.escapeHtml(toolCall.description)}</div>` : ""}
        </div>
        <div class="permission-options">
          ${options.map(opt => `
            <button
              class="permission-option-btn permission-option-${opt.kind}"
              data-option-id="${opt.optionId}"
              data-kind="${opt.kind}"
            >
              ${this.getOptionLabel(opt.kind)}: ${this.escapeHtml(opt.name)}
            </button>
          `).join("")}
        </div>
      </div>
    </div>
  `;

  // 绑定按钮事件
  dialog.querySelectorAll(".permission-option-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const target = e.target as HTMLButtonElement;
      const optionId = target.dataset.optionId!;
      const kind = target.dataset.kind!;

      const outcome: PermissionResponseMessage["outcome"] =
        kind.startsWith("reject")
          ? { outcome: "cancelled" }
          : { outcome: "selected", optionId };

      this.sendPermissionResponse(requestId, outcome);
      dialog.remove();
      this.setGenerating(false);
    });
  });

  // 添加到 DOM
  document.body.appendChild(dialog);
}

private getOptionLabel(kind: string): string {
  const labels: Record<string, string> = {
    "allow_once": "Allow Once",
    "allow_always": "Always Allow",
    "reject_once": "Reject Once",
    "reject_always": "Always Reject",
  };
  return labels[kind] || kind;
}

private sendPermissionResponse(
  requestId: string,
  outcome: PermissionResponseMessage["outcome"]
): void {
  this.view?.webview.postMessage({
    type: "permissionResponse",
    requestId,
    outcome,
  } as PermissionResponseMessage);
}
```

3. 在 `handleMessage` 中添加处理逻辑：

```typescript
case "permissionRequest":
  if (msg.requestId && msg.toolCall && msg.options) {
    this.showPermissionDialog(msg.requestId, msg.toolCall, msg.options);
  }
  break;
```

4. 添加样式（`media/main.css` 新增）：

```css
.permission-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.permission-dialog {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-widget-border);
  border-radius: 8px;
  max-width: 480px;
  width: 90%;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.permission-dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border-bottom: 1px solid var(--vscode-widget-border);
  font-weight: 600;
  font-size: 14px;
}

.permission-dialog-body {
  padding: 16px;
}

.permission-tool-info {
  margin-bottom: 16px;
}

.permission-tool-kind {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 4px;
}

.permission-tool-title {
  font-size: 15px;
  font-weight: 500;
}

.permission-tool-desc {
  margin-top: 8px;
  font-size: 13px;
  color: var(--vscode-descriptionForeground);
}

.permission-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.permission-option-btn {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border: 1px solid var(--vscode-widget-border);
  border-radius: 4px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition: background 0.15s;
}

.permission-option-btn:hover {
  background: var(--vscode-button-hoverBackground);
}

.permission-option-allow_once,
.permission-option-allow_always {
  border-color: var(--vscode-testing-iconPassed);
}

.permission-option-reject_once,
.permission-option-reject_always {
  border-color: var(--vscode-testing-iconFailed);
}
```

---

### Step 4: 类型导出更新

**文件**：`src/acp/client.ts`

在 `export interface` 区域添加权限相关类型的导出（如果需要被外部使用）：

```typescript
export type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
```

---

## 4. 测试计划

### 4.1 单元测试

**文件**：`src/test/permission.test.ts`（新建）

```typescript
import * as vscode from "vscode";
import { describe, it, beforeEach, afterEach } from "mocha";
import { ACPClient } from "../acp/client";
import { SinonStub, stub, restore } from "sinon";

suite("Permission Request Handling", () => {
  let client: ACPClient;

  beforeEach(() => {
    client = new ACPClient({ skipAvailabilityCheck: true });
  });

  afterEach(() => {
    restore();
  });

  it("should call registered permission listener", async () => {
    const listener = stub().resolves({
      outcome: { outcome: "selected", optionId: "allow-1" },
    });
    client.setOnPermissionRequest(listener);

    // Mock process and connection for testing
    // ... (setup mocks)

    // Note: Full integration test requires mock ACP server
  });

  it("should fallback to auto-approve when no listener", async () => {
    // Test the fallback behavior
  });
});
```

### 4.2 E2E 测试

**文件**：`e2e/permission.spec.ts`（新建）

```typescript
import { test, expect } from "@playwright/test";

test.describe("Permission Request Flow", () => {
  test("should show permission dialog when agent requests permission", async ({
    page,
  }) => {
    // Open VS Code with extension
    // Trigger a dangerous operation
    // Verify dialog appears
  });

  test("should allow user to approve permission", async ({ page }) => {
    // Click Allow Once button
    // Verify operation proceeds
  });

  test("should allow user to deny permission", async ({ page }) => {
    // Click Reject Once button
    // Verify operation cancelled
  });
});
```

---

## 5. 配置文件变更

无配置文件变更。

---

## 6. 依赖变更

无新增依赖。

---

## 7. 风险与缓解

| 风险              | 概率 | 影响 | 缓解措施                 |
| ----------------- | ---- | ---- | ------------------------ |
| 权限对话框阻塞 UI | 中   | 中   | 添加超时机制（默认 60s） |
| 权限队列状态混乱  | 低   | 中   | 单一队列 + 请求 ID 追踪  |
| Webview 消息丢失  | 低   | 高   | 添加确认机制             |

---

## 8. 后续优化（可选）

1. **记住用户偏好**：将用户的 `allow_always`/`reject_always` 选择存储到 `globalState`
2. **批量权限**：同一类型的操作自动批准（基于存储的偏好）
3. **权限历史**：在 UI 中显示历史权限决策
4. **高风险操作警告**：对删除文件、执行 shell 等操作显示额外警告

---

## 9. 文件变更清单

| 文件                          | 操作 | 变更类型                 |
| ----------------------------- | ---- | ------------------------ |
| `src/acp/client.ts`           | 修改 | 添加权限监听器机制       |
| `src/views/chat.ts`           | 修改 | 注册监听器，添加消息处理 |
| `src/views/webview/main.ts`   | 修改 | 添加权限对话框 UI        |
| `media/main.css`              | 修改 | 添加权限对话框样式       |
| `src/test/permission.test.ts` | 新增 | 单元测试                 |
| `e2e/permission.spec.ts`      | 新增 | E2E 测试                 |

---

## 10. 验收标准

- [ ] Agent 请求权限时，Webview 显示权限对话框
- [ ] 对话框显示工具类型、名称、描述
- [ ] 用户可选择四个选项之一
- [ ] 用户选择后，权限结果正确传回 Agent
- [ ] 无监听器时，行为与原来一致（auto-approve）
- [ ] 单元测试覆盖核心逻辑
- [ ] E2E 测试覆盖用户交互流程
