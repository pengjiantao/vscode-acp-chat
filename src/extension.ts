import * as vscode from "vscode";
import { ACPClient } from "./acp/client";
import { ChatViewProvider } from "./views/chat";
import { getAgentsWithStatus } from "./acp/agents";

/** VSCode ACP extension client instance. */
let acpClient: ACPClient | undefined;
/** Chat view provider instance. */
let chatProvider: ChatViewProvider | undefined;
/** Status bar item showing connection state. */
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Activates the VSCode ACP extension.
 * Sets up the chat view, status bar, commands, and configuration watchers.
 */
export function activate(context: vscode.ExtensionContext) {
  console.log("VSCode ACP extension is now active");

  // Open Developer Tools for webview debugging
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-acp-chat.openDevTools", () => {
      vscode.commands.executeCommand(
        "workbench.action.webview.openDeveloperTools"
      );
    })
  );

  // Initialize ACP client and chat view provider
  acpClient = new ACPClient();
  chatProvider = new ChatViewProvider(
    context.extensionUri,
    acpClient,
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

  // Update status bar on connection state changes
  acpClient.setOnStateChange((state) => {
    updateStatusBar(state);
  });

  // Watch for configuration changes to reload MCP servers or refresh agents
  const mcpConfigWatcher = vscode.workspace.onDidChangeConfiguration(
    async (e) => {
      if (e.affectsConfiguration("mcp")) {
        try {
          await acpClient?.reloadMcpServers();
          console.log(
            "[Extension] MCP servers reloaded due to configuration change"
          );
        } catch (error) {
          console.error("[Extension] Failed to reload MCP servers:", error);
        }
      }

      if (e.affectsConfiguration("vscode-acp-chat.passMcpServers")) {
        await acpClient?.reloadMcpServers();
        console.log(`[Extension] MCP passthrough configuration changed`);
      }

      if (e.affectsConfiguration("vscode-acp-chat.customAgents")) {
        getAgentsWithStatus(true); // Force refresh agents cache and re-validate
        console.log(
          `[Extension] Custom agents configuration changed, cache refreshed`
        );
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

  // Open chat view and connect to ACP server
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-acp-chat.startChat", async () => {
      await vscode.commands.executeCommand("vscode-acp-chat.chatView.focus");

      if (!acpClient?.isConnected()) {
        try {
          await acpClient?.connect();
          vscode.window.showInformationMessage("VSCode ACP connected");
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to connect: ${error}`);
        }
      }
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

      if (!chatProvider.getSupportsLoadSession()) {
        vscode.window.showInformationMessage(
          "The current agent does not support loading history sessions."
        );
        return;
      }

      try {
        const sessions = await chatProvider.listSessions();

        if (sessions.length === 0) {
          vscode.window.showInformationMessage(
            "No history sessions available for the current agent."
          );
          return;
        }

        const items = sessions.map((s) => ({
          label: s.title,
          description: s.sessionId,
          detail: `${vscode.workspace.asRelativePath(s.cwd)} · ${new Date(s.updatedAt).toLocaleString()}`,
          sessionId: s.sessionId,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Select a conversation to load",
          title: "VSCode ACP: Load History",
        });

        if (selected) {
          await chatProvider.loadHistorySession(selected.sessionId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to load history: ${message}`);
      }
    })
  );

  // Switch to a different AI agent
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-acp-chat.selectAgent", async () => {
      const agents = getAgentsWithStatus();
      const availableAgents = agents.filter((a) => a.available);
      const currentAgentId = acpClient?.getAgentId();

      const items = availableAgents.map((a) => ({
        label: a.name,
        description: a.id,
        id: a.id,
        picked: a.id === currentAgentId,
        detail: a.id === currentAgentId ? "$(check) Currently selected" : "",
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select an AI agent",
        title: "VSCode ACP: Select Agent",
      });

      if (selected) {
        await chatProvider?.switchAgent(selected.id);
      }
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
          // VS Code doesn't have a direct API to get terminal selection text.
          // The standard workaround is to use the "copySelection" command and then read from clipboard.
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
      async (args?: any) => {
        let selection = "";
        let terminalName = "Terminal";

        // If invoked from terminal/context, args might contain the selection and/or terminal
        if (args && typeof args === "object") {
          if (typeof args.selection === "string" && args.selection.length > 0) {
            selection = args.selection;
          }
          if (args.terminal && args.terminal.name) {
            terminalName = args.terminal.name;
          } else if (args.name) {
            terminalName = args.name;
          }
        }

        const activeTerminal = vscode.window.activeTerminal;
        if (terminalName === "Terminal" && activeTerminal) {
          terminalName = activeTerminal.name;
        }

        // Fallback to clipboard method if selection wasn't passed via args
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
      acpClient?.dispose();
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
  console.log("VSCode ACP extension deactivating");
  acpClient?.dispose();
}
