import * as vscode from "vscode";
import type { ACPClient } from "./client";

// Only sync local filesystem documents. Untitled, vscode-vfs, and other
// virtual schemes are excluded — expand this set if agents need them.
const SUPPORTED_SCHEMES = new Set(["file"]);

/**
 * Manages sending ACP document sync notifications to active agents.
 *
 * Listens to VSCode workspace/editor events and forwards them as
 * didOpen / didChange / didClose / didSave / didFocus notifications,
 * gated by each agent's NES document capabilities.
 */
export class DocumentSyncManager implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private enabled = false;
  private syncKind: "full" | "incremental" | null = null;
  private readonly clientProvider: () => ACPClient[];

  /** Debounce timer for didChange */
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanges: Map<
    string,
    {
      version: number;
      isFull: boolean;
      contentChanges: Array<{
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        } | null;
        text: string;
      }>;
    }
  > = new Map();

  constructor(clientOrProvider: ACPClient | (() => ACPClient[])) {
    if (typeof clientOrProvider === "function") {
      this.clientProvider = clientOrProvider;
    } else {
      this.clientProvider = () => [clientOrProvider];
    }

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("vscode-acp-chat.enableDocumentSync")) {
          this.syncCapabilities();
        }
      })
    );
  }

  private getClients(): ACPClient[] {
    return this.clientProvider().filter((c) => c && c.isConnected());
  }

  /**
   * Read agent capabilities and register event listeners accordingly.
   * Call this after each successful connect / agent switch.
   */
  syncCapabilities(): void {
    this.disposeListeners();

    const config = vscode.workspace.getConfiguration("vscode-acp-chat");
    if (!config.get<boolean>("enableDocumentSync", true)) {
      this.enabled = false;
      return;
    }

    const clients = this.getClients();

    for (const client of clients) {
      const caps = client.getNesDocumentCapabilities();
      if (caps.didChange?.syncKind) {
        this.syncKind = caps.didChange.syncKind;
      }
    }

    // Even if no clients are connected yet, enable listeners if config is on so new connections get events
    this.enabled = true;

    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => this.onDidOpen(doc))
    );
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.onDidChange(e))
    );
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => this.onDidClose(doc))
    );
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => this.onDidSave(doc))
    );
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) =>
        this.onDidFocus(editor)
      )
    );
  }

  dispose(): void {
    this.disposeListeners();
    if (this.changeTimer) {
      clearTimeout(this.changeTimer);
      this.changeTimer = null;
    }
    this.pendingChanges.clear();
  }

  private disposeListeners(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this.enabled = false;
  }

  private isSupportedDocument(doc: vscode.TextDocument): boolean {
    return SUPPORTED_SCHEMES.has(doc.uri.scheme);
  }

  private onDidOpen(doc: vscode.TextDocument): void {
    if (!this.enabled || !this.isSupportedDocument(doc)) return;

    for (const client of this.getClients()) {
      if (client.getNesDocumentCapabilities().didOpen) {
        client
          .notifyDidOpenDocument({
            uri: doc.uri.toString(),
            text: doc.getText(),
            languageId: doc.languageId,
            version: doc.version,
          })
          .catch((err) => console.error("[DocumentSync] didOpen failed:", err));
      }
    }
  }

  private onDidChange(e: vscode.TextDocumentChangeEvent): void {
    if (!this.enabled || !this.isSupportedDocument(e.document)) return;
    if (e.contentChanges.length === 0) return;

    const uri = e.document.uri.toString();
    const existing = this.pendingChanges.get(uri);

    // Full sync: replace with latest full text snapshot
    if (this.syncKind === "full") {
      this.pendingChanges.set(uri, {
        version: e.document.version,
        isFull: true,
        contentChanges: [{ range: null, text: e.document.getText() }],
      });
    } else {
      // Incremental: accumulate changes, merging with any prior pending changes
      const newChanges = e.contentChanges.map((c) => ({
        range: c.range
          ? {
              start: {
                line: c.range.start.line,
                character: c.range.start.character,
              },
              end: { line: c.range.end.line, character: c.range.end.character },
            }
          : null,
        text: c.text,
      }));

      if (existing && !existing.isFull) {
        // Append to existing incremental changes
        existing.contentChanges.push(...newChanges);
        existing.version = e.document.version;
      } else {
        // First change for this URI (or previous was full, which we overwrite)
        this.pendingChanges.set(uri, {
          version: e.document.version,
          isFull: false,
          contentChanges: newChanges,
        });
      }
    }

    // Debounce: flush after 100ms of inactivity
    if (this.changeTimer) {
      clearTimeout(this.changeTimer);
    }
    this.changeTimer = setTimeout(() => this.flushChanges(), 100);
  }

  private flushChanges(): void {
    this.changeTimer = null;
    for (const [uri, { version, contentChanges }] of this.pendingChanges) {
      for (const client of this.getClients()) {
        const caps = client.getNesDocumentCapabilities();
        if (caps.didChange) {
          let changesToSend = contentChanges;
          if (
            caps.didChange.syncKind === "full" &&
            contentChanges.length > 0 &&
            contentChanges[0].range !== null
          ) {
            const doc = vscode.workspace.textDocuments.find(
              (d) => d.uri.toString() === uri
            );
            if (doc) {
              changesToSend = [{ range: null, text: doc.getText() }];
            }
          }
          client
            .notifyDidChangeDocument({
              uri,
              contentChanges: changesToSend,
              version,
            })
            .catch((err) =>
              console.error("[DocumentSync] didChange failed:", err)
            );
        }
      }
    }
    this.pendingChanges.clear();
  }

  private onDidClose(doc: vscode.TextDocument): void {
    if (!this.enabled || !this.isSupportedDocument(doc)) return;

    for (const client of this.getClients()) {
      if (client.getNesDocumentCapabilities().didClose) {
        client
          .notifyDidCloseDocument({ uri: doc.uri.toString() })
          .catch((err) =>
            console.error("[DocumentSync] didClose failed:", err)
          );
      }
    }
  }

  private onDidSave(doc: vscode.TextDocument): void {
    if (!this.enabled || !this.isSupportedDocument(doc)) return;

    for (const client of this.getClients()) {
      if (client.getNesDocumentCapabilities().didSave) {
        client
          .notifyDidSaveDocument({ uri: doc.uri.toString() })
          .catch((err) => console.error("[DocumentSync] didSave failed:", err));
      }
    }
  }

  private onDidFocus(editor: vscode.TextEditor | undefined): void {
    if (!this.enabled || !editor) return;
    const doc = editor.document;
    if (!this.isSupportedDocument(doc)) return;

    const position = editor.selection.active;
    const visibleRanges = editor.visibleRanges;
    const visibleRange =
      visibleRanges.length > 0
        ? visibleRanges[0]
        : new vscode.Range(0, 0, 0, 0);

    for (const client of this.getClients()) {
      if (client.getNesDocumentCapabilities().didFocus) {
        client
          .notifyDidFocusDocument({
            uri: doc.uri.toString(),
            position: { line: position.line, character: position.character },
            version: doc.version,
            visibleRange: {
              start: {
                line: visibleRange.start.line,
                character: visibleRange.start.character,
              },
              end: {
                line: visibleRange.end.line,
                character: visibleRange.end.character,
              },
            },
          })
          .catch((err) =>
            console.error("[DocumentSync] didFocus failed:", err)
          );
      }
    }
  }
}
