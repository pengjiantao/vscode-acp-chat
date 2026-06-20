import * as vscode from "vscode";
import type { ACPClient } from "./client";

// Only sync local filesystem documents. Untitled, vscode-vfs, and other
// virtual schemes are excluded — expand this set if agents need them.
const SUPPORTED_SCHEMES = new Set(["file"]);

/**
 * Manages sending ACP document sync notifications to the agent.
 *
 * Listens to VSCode workspace/editor events and forwards them as
 * didOpen / didChange / didClose / didSave / didFocus notifications,
 * gated by the agent's NES document capabilities.
 */
export class DocumentSyncManager implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private enabled = false;
  private syncKind: "full" | "incremental" | null = null;

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

  constructor(private acpClient: ACPClient) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("vscode-acp-chat.enableDocumentSync")) {
          this.syncCapabilities();
        }
      })
    );
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

    const caps = this.acpClient.getNesDocumentCapabilities();
    const hasAnyCapability =
      caps.didOpen ||
      caps.didChange !== null ||
      caps.didClose ||
      caps.didSave ||
      caps.didFocus;

    if (!hasAnyCapability) {
      this.enabled = false;
      return;
    }

    this.enabled = true;
    this.syncKind = caps.didChange?.syncKind ?? null;

    if (caps.didOpen) {
      this.disposables.push(
        vscode.workspace.onDidOpenTextDocument((doc) => this.onDidOpen(doc))
      );
    }

    if (caps.didChange) {
      this.disposables.push(
        vscode.workspace.onDidChangeTextDocument((e) => this.onDidChange(e))
      );
    }

    if (caps.didClose) {
      this.disposables.push(
        vscode.workspace.onDidCloseTextDocument((doc) => this.onDidClose(doc))
      );
    }

    if (caps.didSave) {
      this.disposables.push(
        vscode.workspace.onDidSaveTextDocument((doc) => this.onDidSave(doc))
      );
    }

    if (caps.didFocus) {
      this.disposables.push(
        vscode.window.onDidChangeActiveTextEditor((editor) =>
          this.onDidFocus(editor)
        )
      );
    }
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

    this.acpClient
      .notifyDidOpenDocument({
        uri: doc.uri.toString(),
        text: doc.getText(),
        languageId: doc.languageId,
        version: doc.version,
      })
      .catch((err) => console.error("[DocumentSync] didOpen failed:", err));
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
      this.acpClient
        .notifyDidChangeDocument({ uri, contentChanges, version })
        .catch((err) => console.error("[DocumentSync] didChange failed:", err));
    }
    this.pendingChanges.clear();
  }

  private onDidClose(doc: vscode.TextDocument): void {
    if (!this.enabled || !this.isSupportedDocument(doc)) return;

    this.acpClient
      .notifyDidCloseDocument({ uri: doc.uri.toString() })
      .catch((err) => console.error("[DocumentSync] didClose failed:", err));
  }

  private onDidSave(doc: vscode.TextDocument): void {
    if (!this.enabled || !this.isSupportedDocument(doc)) return;

    this.acpClient
      .notifyDidSaveDocument({ uri: doc.uri.toString() })
      .catch((err) => console.error("[DocumentSync] didSave failed:", err));
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

    this.acpClient
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
      .catch((err) => console.error("[DocumentSync] didFocus failed:", err));
  }
}
