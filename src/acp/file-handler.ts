import * as vscode from "vscode";
import {
  RequestError,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from "@agentclientprotocol/sdk";
import type { DiffManager } from "./diff-manager";

/**
 * Handles ACP `readTextFile` / `writeTextFile` requests against the VS Code
 * filesystem abstraction (`vscode.workspace.fs`), so it works for local,
 * remote, and virtual filesystems alike.
 */
export class FileHandler {
  /**
   * Pre-write snapshot of file contents, keyed by absolute path.
   * `null` means the file did not exist before the write (newly created);
   * a string is the previous content. Entries are consumed once via
   * `getLastFileContent` (which deletes them) so each snapshot is used once.
   */
  private lastFileContents: Map<string, string | null> = new Map();
  private textDecoder = new TextDecoder();
  private textEncoder = new TextEncoder();

  constructor(private diffManager: DiffManager) {}

  /**
   * Return the pre-write snapshot for `path` and remove it from the cache.
   * Returns `undefined` when no snapshot was captured for this path.
   * Returns `null` when the file was newly created (did not exist before write).
   */
  getLastFileContent(path: string): string | null | undefined {
    if (!this.lastFileContents.has(path)) {
      return undefined;
    }
    const value = this.lastFileContents.get(path);
    this.lastFileContents.delete(path);
    return value;
  }

  clearLastFileContents(): void {
    this.lastFileContents.clear();
  }

  dispose(): void {
    this.lastFileContents.clear();
  }

  /**
   * Read a text file (or directory listing) and return its contents.
   * Supports optional `line`/`limit` slicing of the returned text.
   */
  async handleReadTextFile(
    params: ReadTextFileRequest
  ): Promise<ReadTextFileResponse> {
    try {
      const uri = vscode.Uri.file(params.path);

      // Prefer the in-memory document when the file is open in an editor, so
      // unsaved buffer changes are reflected instead of the on-disk version.
      const openDoc = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.fsPath === uri.fsPath
      );

      let content: string;
      if (openDoc) {
        content = openDoc.getText();
      } else {
        // `statError` is captured separately so we can distinguish a missing
        // file (from a failed stat) from a read failure on an existing file.
        let stat: vscode.FileStat | undefined;
        let statError: unknown;
        try {
          stat = await vscode.workspace.fs.stat(uri);
        } catch (err) {
          statError = err;
        }

        if (stat && stat.type & vscode.FileType.Directory) {
          // A directory path returns a formatted listing instead of content.
          content = await this.buildDirectoryListing(uri);
        } else {
          try {
            const fileContent = await vscode.workspace.fs.readFile(uri);
            content = this.textDecoder.decode(fileContent);
          } catch (readError) {
            const errorMessage =
              readError instanceof Error
                ? readError.message
                : String(readError);
            // Map common "not found" messages to a proper resource-not-found error.
            if (
              errorMessage.includes("ENOENT") ||
              errorMessage.includes("File not found") ||
              errorMessage.includes("no such file")
            ) {
              throw RequestError.resourceNotFound(params.path);
            } else if (statError !== undefined) {
              // stat failed but read also failed: surface the stat error.
              throw statError instanceof RequestError
                ? statError
                : new RequestError(-32603, String(statError), {
                    path: params.path,
                  });
            } else {
              throw readError instanceof RequestError
                ? readError
                : new RequestError(-32603, String(readError), {
                    path: params.path,
                  });
            }
          }
        }
      }

      // Optional line-range slicing (0-based, like the ACP spec).
      if (params.line !== undefined || params.limit !== undefined) {
        const lines = content.split("\n");
        const startLine = params.line ?? 0;
        const lineLimit = params.limit ?? lines.length;
        const selectedLines = lines.slice(startLine, startLine + lineLimit);
        content = selectedLines.join("\n");
      }

      return { content };
    } catch (error) {
      console.error("[FileHandler] Failed to read file:", error);
      if (error instanceof RequestError) {
        throw error;
      }
      throw new RequestError(-32603, String(error), { path: params.path });
    }
  }

  /**
   * Write `params.content` to `params.path`, creating any missing parent
   * directories. Returns an empty object on success.
   */
  async handleWriteTextFile(
    params: WriteTextFileRequest
  ): Promise<WriteTextFileResponse> {
    try {
      const uri = vscode.Uri.file(params.path);

      // 1. Reject writing onto an existing directory (use readTextFile for listings).
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type & vscode.FileType.Directory) {
          throw new RequestError(
            -32602,
            `Cannot write to "${params.path}": path is a directory, not a file. Use readTextFile to list directory contents.`,
            { path: params.path }
          );
        }
      } catch (error) {
        // A non-directory stat error (e.g. file does not exist yet) is fine;
        // only re-throw errors we explicitly raised.
        if (error instanceof RequestError) {
          throw error;
        }
      }

      // 2. Ensure the parent directory exists (creating it recursively if needed).
      const parentUri = vscode.Uri.joinPath(uri, "..");
      await this.ensureParentDirectory(parentUri, params.path);

      // 3. Capture the pre-write snapshot for diff/rollback support.
      let oldContent: string | null = null;
      try {
        const fileContent = await vscode.workspace.fs.readFile(uri);
        oldContent = this.textDecoder.decode(fileContent);
        this.lastFileContents.set(params.path, oldContent);
      } catch {
        // File did not exist before this write: record `null` (newly created).
        this.lastFileContents.set(params.path, null);
      }

      // 4. Encode and write the new content (overwrites if the file exists).
      const content = this.textEncoder.encode(params.content);
      await vscode.workspace.fs.writeFile(uri, content);

      // 5. Record the change so the diff view / rollback can present it.
      this.diffManager.recordChange(params.path, oldContent, params.content);

      return {};
    } catch (error) {
      console.error("[FileHandler] Failed to write file:", error);
      if (error instanceof RequestError) {
        throw error;
      }
      throw new RequestError(-32603, String(error), { path: params.path });
    }
  }

  /**
   * Ensure `parentUri` exists as a directory, creating it (and any missing
   * ancestors) when it does not. Throws a `RequestError` when the path exists
   * but is not a directory, or when directory creation fails.
   *
   * `vscode.workspace.fs.createDirectory` does not create intermediate
   * directories, so we recurse upward to the nearest existing ancestor and
   * then create the directories back down to `parentUri`.
   */
  private async ensureParentDirectory(
    parentUri: vscode.Uri,
    filePath: string
  ): Promise<void> {
    try {
      const stat = await vscode.workspace.fs.stat(parentUri);
      if (stat.type & vscode.FileType.Directory) {
        return;
      }
      // Exists but is a file (or other non-directory type): invalid target.
      throw new RequestError(
        -32602,
        `Cannot write to "${filePath}": parent path "${parentUri.fsPath}" exists but is not a directory.`,
        { path: filePath, parent: parentUri.fsPath }
      );
    } catch (error) {
      // Only re-throw errors we explicitly raised; a stat failure here means
      // the directory simply does not exist yet, which we handle below.
      if (error instanceof RequestError) {
        throw error;
      }
    }

    // Recurse to the grandparent first so intermediate directories are created
    // in order. The `fsPath` equality guard stops the recursion at the
    // filesystem root (where ".." resolves to the same path).
    const grandParentUri = vscode.Uri.joinPath(parentUri, "..");
    if (grandParentUri.fsPath !== parentUri.fsPath) {
      await this.ensureParentDirectory(grandParentUri, filePath);
    }

    try {
      await vscode.workspace.fs.createDirectory(parentUri);
    } catch (error) {
      // Surface a clear, actionable error instead of leaking the raw cause.
      throw new RequestError(
        -32603,
        `Failed to create parent directory "${parentUri.fsPath}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        { path: filePath, parent: parentUri.fsPath }
      );
    }
  }

  /**
   * Build a human-readable listing for a directory path. `stat` is called per
   * entry to enrich each line with size/mtime/permissions; a failed stat is
   * recorded as an `error` rather than aborting the whole listing.
   */
  private async buildDirectoryListing(uri: vscode.Uri): Promise<string> {
    const entries = await vscode.workspace.fs.readDirectory(uri);

    const childStats = await Promise.all(
      entries.map(async ([name, type]) => {
        try {
          const childStat = await vscode.workspace.fs.stat(
            vscode.Uri.joinPath(uri, name)
          );
          return { name, type, stat: childStat, error: null };
        } catch (err) {
          return {
            name,
            type,
            stat: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    return this.formatDirectoryListing(uri, childStats);
  }

  /**
   * Render the directory listing produced by `buildDirectoryListing` into a
   * plain-text string. Each entry is tagged with its type and, when available,
   * its size, modification/creation times, and permission summary.
   */
  private formatDirectoryListing(
    uri: vscode.Uri,
    childStats: Array<{
      name: string;
      type: vscode.FileType;
      stat: vscode.FileStat | null;
      error: string | null;
    }>
  ): string {
    const header = `[Directory listing for: ${uri.fsPath}]`;
    if (childStats.length === 0) {
      return `${header}\n(empty directory)\nNote: line/limit parameters are ignored for directory paths. Recursive listing is not supported.`;
    }

    const lines = childStats.map((entry) => {
      const tag = this.fileTypeTag(entry.type);
      if (entry.error) {
        return `${tag} ${entry.name}  (stat error: ${entry.error})`;
      }
      const stat = entry.stat!;
      const mtime = new Date(stat.mtime).toISOString();
      const ctime = new Date(stat.ctime).toISOString();
      const perms = this.formatPermissions(stat.permissions);
      return `${tag} ${entry.name}  size=${stat.size}  mtime=${mtime}  ctime=${ctime}  perms=${perms}`;
    });

    return [
      header,
      ...lines,
      "Note: line/limit parameters are ignored for directory paths. Recursive listing is not supported.",
    ].join("\n");
  }

  /** Map a `vscode.FileType` bitmask to a short, human-readable tag. */
  private fileTypeTag(type: vscode.FileType): string {
    const isLink = (type & vscode.FileType.SymbolicLink) !== 0;
    const isDir = (type & vscode.FileType.Directory) !== 0;
    const isFile = (type & vscode.FileType.File) !== 0;
    if (isLink) {
      return isDir ? "[LINK->DIR]" : isFile ? "[LINK->FILE]" : "[LINK]";
    }
    if (isDir) return "[DIR]";
    if (isFile) return "[FILE]";
    return "[UNKNOWN]";
  }

  /** Summarize `vscode.FilePermission` as a short read/write indicator. */
  private formatPermissions(perms: vscode.FilePermission | undefined): string {
    if (perms === undefined) {
      return "n/a";
    }
    const isReadonly = (perms & vscode.FilePermission.Readonly) !== 0;
    return isReadonly ? "r--" : "-w-";
  }
}
