import * as vscode from "vscode";
import { AgentPool } from "./acp/agent-pool";
import { ChatViewProvider } from "./views/chat";
import { getAgentsWithStatus } from "./acp/agents";

/** VSCode ACP agent pool managing multiple agent connections. */
let agentPool: AgentPool | undefined;
/** Chat view provider instance. */
let chatProvider: ChatViewProvider | undefined;
/** Status bar item showing connection state. */
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Activates the VSCode ACP extension.
 * Sets up the chat view, status bar, commands, and configuration watchers.
 */
export function activate(context: vscode.ExtensionContext) {
  // Open Developer Tools for webview debugging
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-acp-chat.openDevTools", () => {
      vscode.commands.executeCommand(
        "workbench.action.webview.openDeveloperTools"
      );
    })
  );

  // Initialize AgentPool and ChatViewProvider
  agentPool = new AgentPool();
  chatProvider = new ChatViewProvider(
    context.extensionUri,
    agentPool,
    context.globalState
  );

  // Create and show status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = "vscode-acp-chat.startChat";
  statusBarItem.tooltip = "VSCode ACP - Click to open chat";
  updateStatusBar("disconnected");
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Watch for configuration changes to reload MCP servers or refresh agents
  const mcpConfigWatcher = vscode.workspace.onDidChangeConfiguration(
    async (e) => {
      if (
        e.affectsConfiguration("mcp") ||
        e.affectsConfiguration("vscode-acp-chat.passMcpServers")
      ) {
        try {
          const clients = agentPool?.getActiveClients() || [];
          for (const client of clients) {
            await client.reloadMcpServers();
          }
        } catch (error) {
          console.error("[Extension] Failed to reload MCP servers:", error);
        }
      }

      if (e.affectsConfiguration("vscode-acp-chat.customAgents")) {
        getAgentsWithStatus(true); // Force refresh agents cache and re-validate
      }
    }
  );
  context.subscriptions.push(mcpConfigWatcher);

  // Register webview view provider for the chat panel
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      chatProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  );

  // Open chat view
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-acp-chat.startChat", async () => {
      await vscode.commands.executeCommand("vscode-acp-chat.chatView.focus");
    })
  );

  // Create a new chat session
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-acp-chat.newChat", () => {
      chatProvider?.newChat();
    })
  );

  // Clear current chat messages
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-acp-chat.clearChat", () => {
      chatProvider?.clearChat();
    })
  );

  // Load a previous chat session from history
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-acp-chat.loadHistory", async () => {
      if (!chatProvider) return;

      try {
        const sessions = await chatProvider.listAllSessions();

        if (sessions.length === 0) {
          vscode.window.showInformationMessage(
            "No history sessions available."
          );
          return;
        }

        const items = sessions.map((s) => ({
          label: `[${s.agentName || s.agentId}] ${s.title}`,
          description: s.sessionId,
          detail: `${vscode.workspace.asRelativePath(s.cwd)} · ${new Date(s.updatedAt).toLocaleString()}`,
          sessionId: s.sessionId,
          agentId: s.agentId,
          buttons: [
            {
              iconPath: new vscode.ThemeIcon("trash"),
              tooltip: "Delete this session",
            },
          ],
        }));

        const quickPick = vscode.window.createQuickPick<(typeof items)[0]>();
        quickPick.items = items;
        quickPick.placeholder = "Select a conversation to load";
        quickPick.title = "VSCode ACP: Load History";

        const activeSessionId = chatProvider.getActiveSessionId();
        const activeItem = items.find(
          (item) => item.sessionId === activeSessionId
        );
        if (activeItem) {
          quickPick.activeItems = [activeItem];
        }

        quickPick.onDidAccept(async () => {
          const selected = quickPick.selectedItems[0];
          if (selected && chatProvider) {
            quickPick.dispose();
            await chatProvider.loadHistorySession(
              selected.sessionId,
              selected.agentId
            );
          }
        });

        quickPick.onDidTriggerItemButton(async (e) => {
          const item = e.item;
          const confirmed = await vscode.window.showWarningMessage(
            `Delete session "${item.label}"?`,
            { modal: true },
            "Delete"
          );
          if (confirmed === "Delete" && chatProvider) {
            try {
              await chatProvider.deleteHistorySession(
                item.agentId,
                item.sessionId
              );
              quickPick.items = quickPick.items.filter(
                (qi) => qi.sessionId !== item.sessionId
              );
              if (quickPick.items.length === 0) {
                quickPick.dispose();
                vscode.window.showInformationMessage(
                  "No more history sessions available."
                );
              }
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              vscode.window.showErrorMessage(
                `Failed to delete session: ${message}`
              );
            }
          }
        });

        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to load history: ${message}`);
      }
    })
  );

  // Delete a chat session from history
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-acp-chat.deleteHistorySession",
      async () => {
        if (!chatProvider) return;

        try {
          const sessions = await chatProvider.listAllSessions();

          if (sessions.length === 0) {
            vscode.window.showInformationMessage(
              "No history sessions available to delete."
            );
            return;
          }

          const items = sessions.map((s) => ({
            label: `[${s.agentName || s.agentId}] ${s.title}`,
            description: s.sessionId,
            detail: `${vscode.workspace.asRelativePath(s.cwd)} · ${new Date(s.updatedAt).toLocaleString()}`,
            sessionId: s.sessionId,
            agentId: s.agentId,
          }));

          const selected = await vscode.window.showQuickPick(items, {
            placeHolder: "Select a conversation to delete",
            title: "VSCode ACP: Delete History Session",
          });

          if (selected) {
            const confirmed = await vscode.window.showWarningMessage(
              `Delete session "${selected.label}"?`,
              { modal: true },
              "Delete"
            );
            if (confirmed === "Delete") {
              await chatProvider.deleteHistorySession(
                selected.agentId,
                selected.sessionId
              );
              vscode.window.showInformationMessage(
                `Session "${selected.label}" deleted.`
              );
            }
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            `Failed to delete session: ${message}`
          );
        }
      }
    )
  );

  // Select AI agent and start a session
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-acp-chat.selectAgent", async () => {
      await chatProvider?.showNewChatQuickPick();
    })
  );

  // Send current editor/terminal selection to the chat
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-acp-chat.sendSelectionToChat",
      async () => {
        const activeEditor = vscode.window.activeTextEditor;
        const activeTerminal = vscode.window.activeTerminal;

        // Try editor selection first
        if (activeEditor && !activeEditor.selection.isEmpty) {
          const selection = activeEditor.selection;
          const text = activeEditor.document.getText(selection);
          const fileName = vscode.workspace.asRelativePath(
            activeEditor.document.uri
          );

          chatProvider?.addSelection({
            type: "selection",
            name: `${fileName}:${selection.start.line + 1}-${selection.end.line + 1}`,
            path: activeEditor.document.uri.fsPath,
            content: text,
            range: {
              startLine: selection.start.line + 1,
              endLine: selection.end.line + 1,
            },
          });

          await vscode.commands.executeCommand(
            "vscode-acp-chat.chatView.focus"
          );
          return;
        }

        // Try terminal selection if no editor selection
        if (activeTerminal) {
          await vscode.commands.executeCommand(
            "workbench.action.terminal.copySelection"
          );
          const selection = await vscode.env.clipboard.readText();

          if (selection) {
            chatProvider?.addSelection({
              type: "terminal",
              name: `Terminal: ${activeTerminal.name}`,
              content: selection,
            });
            await vscode.commands.executeCommand(
              "vscode-acp-chat.chatView.focus"
            );
          } else {
            vscode.window.showInformationMessage(
              "No text selected in editor or terminal."
            );
          }
        }
      }
    )
  );

  // Send terminal selection to chat (may include args from terminal context)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-acp-chat.sendTerminalSelectionToChat",
      async (args?: unknown) => {
        let selection = "";
        let terminalName = "Terminal";

        if (args && typeof args === "object") {
          const argsObj = args as Record<string, unknown>;
          if (
            typeof argsObj.selection === "string" &&
            argsObj.selection.length > 0
          ) {
            selection = argsObj.selection;
          }
          if (
            argsObj.terminal &&
            typeof argsObj.terminal === "object" &&
            "name" in argsObj.terminal
          ) {
            terminalName = (argsObj.terminal as Record<string, unknown>)
              .name as string;
          } else if (typeof argsObj.name === "string") {
            terminalName = argsObj.name;
          }
        }

        const activeTerminal = vscode.window.activeTerminal;
        if (terminalName === "Terminal" && activeTerminal) {
          terminalName = activeTerminal.name;
        }

        if (!selection && activeTerminal) {
          await vscode.commands.executeCommand(
            "workbench.action.terminal.copySelection"
          );
          selection = await vscode.env.clipboard.readText();
        }

        if (selection) {
          chatProvider?.addSelection({
            type: "terminal",
            name: `Terminal: ${terminalName}`,
            content: selection,
          });
          await vscode.commands.executeCommand(
            "vscode-acp-chat.chatView.focus"
          );
        } else {
          vscode.window.showInformationMessage("No text selected in terminal.");
        }
      }
    )
  );

  context.subscriptions.push({
    dispose: () => {
      agentPool?.dispose();
    },
  });
}

/**
 * Updates the status bar item to reflect the current connection state.
 * @param state - The connection state: disconnected, connecting, connected, or error.
 */
function updateStatusBar(
  state: "disconnected" | "connecting" | "connected" | "error"
): void {
  if (!statusBarItem) return;

  const icons: Record<string, string> = {
    disconnected: "$(debug-disconnect)",
    connecting: "$(sync~spin)",
    connected: "$(check)",
    error: "$(error)",
  };

  const labels: Record<string, string> = {
    disconnected: "ACP: Disconnected",
    connecting: "ACP: Connecting...",
    connected: "ACP: Connected",
    error: "ACP: Error",
  };

  statusBarItem.text = `${icons[state] || icons.disconnected} ACP`;
  statusBarItem.tooltip = labels[state] || labels.disconnected;

  if (state === "error") {
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground"
    );
  } else if (state === "connecting") {
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
  } else {
    statusBarItem.backgroundColor = undefined;
  }
}

/**
 * Cleans up resources when the extension is deactivated.
 */
export function deactivate() {
  agentPool?.dispose();
}
