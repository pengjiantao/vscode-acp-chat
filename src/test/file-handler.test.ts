import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { FileHandler } from "../acp/file-handler";
import { DiffManager } from "../acp/diff-manager";
import { RequestError } from "@agentclientprotocol/sdk";

function tmpDir(): string {
  return path.join(
    os.tmpdir(),
    `vscode-acp-file-handler-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  );
}

async function rmrf(dir: string): Promise<void> {
  await vscode.workspace.fs.delete(vscode.Uri.file(dir), {
    recursive: true,
    useTrash: false,
  });
}

suite("FileHandler.writeTextFile parent directory Test Suite", () => {
  let diffManager: DiffManager;
  let handler: FileHandler;
  let root: string;

  setup(() => {
    diffManager = new DiffManager();
    handler = new FileHandler(diffManager);
    root = tmpDir();
  });

  teardown(async () => {
    handler.dispose();
    diffManager.dispose();
    try {
      await rmrf(root);
    } catch {
      // ignore cleanup failures
    }
  });

  test("Creates a missing immediate parent directory", async () => {
    const filePath = path.join(root, "new-parent", "file.txt");
    const res = await handler.handleWriteTextFile({
      path: filePath,
      content: "hello",
      sessionId: "test-session",
    });
    assert.deepStrictEqual(res, {});

    const stat = await vscode.workspace.fs.stat(
      vscode.Uri.file(path.dirname(filePath))
    );
    assert.ok(stat.type & vscode.FileType.Directory);

    const content = await vscode.workspace.fs.readFile(
      vscode.Uri.file(filePath)
    );
    assert.strictEqual(new TextDecoder().decode(content), "hello");
  });

  test("Creates missing nested (multi-level) parent directories", async () => {
    const filePath = path.join(root, "a", "b", "c", "deep.txt");
    await handler.handleWriteTextFile({
      path: filePath,
      content: "nested",
      sessionId: "test-session",
    });

    const stat = await vscode.workspace.fs.stat(
      vscode.Uri.file(path.join(root, "a", "b", "c"))
    );
    assert.ok(stat.type & vscode.FileType.Directory);

    const content = await vscode.workspace.fs.readFile(
      vscode.Uri.file(filePath)
    );
    assert.strictEqual(new TextDecoder().decode(content), "nested");
  });

  test("Overwrites an existing file without recreating its parent", async () => {
    const filePath = path.join(root, "existing", "file.txt");
    await handler.handleWriteTextFile({
      path: filePath,
      content: "v1",
      sessionId: "test-session",
    });
    await handler.handleWriteTextFile({
      path: filePath,
      content: "v2",
      sessionId: "test-session",
    });

    const content = await vscode.workspace.fs.readFile(
      vscode.Uri.file(filePath)
    );
    assert.strictEqual(new TextDecoder().decode(content), "v2");
  });

  test("Throws -32602 when parent path is a file, not a directory", async () => {
    const fileParent = path.join(root, "not-a-dir");
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(fileParent),
      new TextEncoder().encode("x")
    );

    const filePath = path.join(fileParent, "file.txt");
    await assert.rejects(
      () =>
        handler.handleWriteTextFile({
          path: filePath,
          content: "y",
          sessionId: "test-session",
        }),
      (err: unknown) => {
        const re = err as RequestError;
        return re instanceof RequestError && re.code === -32602;
      }
    );
  });

  test("Throws -32603 with clear message when directory creation fails", async () => {
    const readonlyParent = path.join(root, "readonly");
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(readonlyParent));
    // `fs.chmodSync` is used (instead of `vscode.workspace.fs`) because the
    // VS Code FS API has no chmod; we need a real permission change on disk so
    // that the subsequent `createDirectory` fails with EACCES and exercises
    // the -32603 branch. Restored in `finally` so teardown can clean up.
    fs.chmodSync(readonlyParent, 0o555);

    const filePath = path.join(readonlyParent, "sub", "file.txt");
    try {
      await assert.rejects(
        () =>
          handler.handleWriteTextFile({
            path: filePath,
            content: "y",
            sessionId: "test-session",
          }),
        (err: unknown) => {
          const re = err as RequestError;
          return (
            re instanceof RequestError &&
            re.code === -32603 &&
            typeof re.message === "string" &&
            re.message.includes("Failed to create parent directory")
          );
        }
      );
    } finally {
      fs.chmodSync(readonlyParent, 0o755);
    }
  });

  test("Writes a file whose parent is an existing top-level directory without recursing", async () => {
    // Parent is the temp root, which already exists as a directory. This
    // exercises the short-circuit in `ensureParentDirectory` (stat succeeds,
    // returns immediately) and confirms no attempt is made to create/recreate
    // the parent — the closest practical check for the root `fsPath` guard.
    const filePath = path.join(root, "top-level.txt");
    const res = await handler.handleWriteTextFile({
      path: filePath,
      content: "root file",
      sessionId: "test-session",
    });
    assert.deepStrictEqual(res, {});

    const content = await vscode.workspace.fs.readFile(
      vscode.Uri.file(filePath)
    );
    assert.strictEqual(new TextDecoder().decode(content), "root file");
  });
});

suite("FileHandler.readTextFile line/limit Test Suite", () => {
  let diffManager: DiffManager;
  let handler: FileHandler;
  let root: string;

  setup(() => {
    diffManager = new DiffManager();
    handler = new FileHandler(diffManager);
    root = tmpDir();
  });

  teardown(async () => {
    handler.dispose();
    diffManager.dispose();
    try {
      await rmrf(root);
    } catch {
      // ignore cleanup failures
    }
  });

  test("Returns full content when line/limit are omitted", async () => {
    const filePath = path.join(root, "full.txt");
    const text = "line1\nline2\nline3\nline4\n";
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(filePath),
      new TextEncoder().encode(text)
    );

    const res = await handler.handleReadTextFile({
      path: filePath,
      sessionId: "test-session",
    });
    assert.strictEqual(res.content, text);
  });

  test("Slices content with line and limit", async () => {
    const filePath = path.join(root, "sliced.txt");
    const text = "a\nb\nc\nd\ne\n";
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(filePath),
      new TextEncoder().encode(text)
    );

    const res = await handler.handleReadTextFile({
      path: filePath,
      line: 1,
      limit: 2,
      sessionId: "test-session",
    });
    assert.strictEqual(res.content, "b\nc");
  });

  test("Defaults limit to end of file when only line is given", async () => {
    const filePath = path.join(root, "tail.txt");
    const text = "a\nb\nc\nd\n";
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(filePath),
      new TextEncoder().encode(text)
    );

    const res = await handler.handleReadTextFile({
      path: filePath,
      line: 2,
      sessionId: "test-session",
    });
    assert.strictEqual(res.content, "c\nd\n");
  });

  test("Returns a directory listing for a directory path", async () => {
    const dirPath = path.join(root, "listing");
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(path.join(dirPath, "child.txt")),
      new TextEncoder().encode("x")
    );

    const res = await handler.handleReadTextFile({
      path: dirPath,
      sessionId: "test-session",
    });
    assert.ok(res.content.includes("[Directory listing for:"));
    assert.ok(res.content.includes("child.txt"));
  });
});
