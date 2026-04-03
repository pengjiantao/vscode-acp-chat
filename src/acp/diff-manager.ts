import * as vscode from "vscode";

export interface FileChange {
  path: string;
  oldText: string | null;
  newText: string;
  status: "pending" | "accepted" | "rolledback";
}

export class DiffManager {
  private changes: Map<string, FileChange> = new Map();
  private onDidChangeCallbacks: Array<(changes: FileChange[]) => void> = [];

  public onDidChange(
    callback: (changes: FileChange[]) => void
  ): vscode.Disposable {
    this.onDidChangeCallbacks.push(callback);
    return {
      dispose: () => {
        this.onDidChangeCallbacks = this.onDidChangeCallbacks.filter(
          (cb) => cb !== callback
        );
      },
    };
  }

  private notify(): void {
    const pendingChanges = this.getPendingChanges();
    this.onDidChangeCallbacks.forEach((cb) => cb(pendingChanges));
  }

  public recordChange(
    path: string,
    oldText: string | null,
    newText: string
  ): void {
    const existing = this.changes.get(path);
    if (existing && existing.status === "pending") {
      this.changes.set(path, {
        ...existing,
        newText,
      });
    } else {
      this.changes.set(path, {
        path,
        oldText,
        newText,
        status: "pending",
      });
    }
    this.notify();
  }

  public getPendingChanges(): FileChange[] {
    return Array.from(this.changes.values()).filter(
      (c) => c.status === "pending"
    );
  }

  public accept(path: string): void {
    const change = this.changes.get(path);
    if (change) {
      change.status = "accepted";
      this.notify();
    }
  }

  public async rollback(path: string): Promise<void> {
    const change = this.changes.get(path);
    if (change && change.status === "pending") {
      try {
        const uri = vscode.Uri.file(path);
        if (change.oldText === null) {
          // File was created, so rollback means delete
          await vscode.workspace.fs.delete(uri, {
            recursive: true,
            useTrash: true,
          });
        } else {
          // File was modified, rollback means restore old text
          const content = new TextEncoder().encode(change.oldText);
          await vscode.workspace.fs.writeFile(uri, content);
        }
        change.status = "rolledback";
        this.notify();
      } catch {
        vscode.window.showErrorMessage(`Failed to rollback ${path}`);
      }
    }
  }

  public acceptAll(): void {
    for (const change of this.changes.values()) {
      if (change.status === "pending") {
        change.status = "accepted";
      }
    }
    this.notify();
  }

  public async rollbackAll(): Promise<void> {
    const pending = this.getPendingChanges();
    for (const change of pending) {
      await this.rollback(change.path);
    }
  }

  public clear(): void {
    this.changes.clear();
    this.notify();
  }

  public isEmpty(): boolean {
    return this.getPendingChanges().length === 0;
  }
}
