import * as assert from "assert";
import { DiffManager } from "../acp/diff-manager";

suite("DiffManager Test Suite", () => {
  let diffManager: DiffManager;

  setup(() => {
    diffManager = new DiffManager();
  });

  test("Initial state is empty", () => {
    assert.strictEqual(diffManager.isEmpty(), true);
    assert.strictEqual(diffManager.getPendingChanges().length, 0);
  });

  test("Recording a change", () => {
    diffManager.recordChange("/path/to/file.ts", "old content", "new content");
    assert.strictEqual(diffManager.isEmpty(), false);
    const pending = diffManager.getPendingChanges();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].path, "/path/to/file.ts");
    assert.strictEqual(pending[0].oldText, "old content");
    assert.strictEqual(pending[0].newText, "new content");
    assert.strictEqual(pending[0].status, "pending");
  });

  test("Updating a pending change", () => {
    diffManager.recordChange("/path/to/file.ts", "old content", "new content");
    diffManager.recordChange(
      "/path/to/file.ts",
      "old content",
      "updated content"
    );
    const pending = diffManager.getPendingChanges();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].newText, "updated content");
  });

  test("Accepting a change", () => {
    diffManager.recordChange("/path/to/file.ts", "old content", "new content");
    diffManager.accept("/path/to/file.ts");
    assert.strictEqual(diffManager.isEmpty(), true);
    assert.strictEqual(diffManager.getPendingChanges().length, 0);
  });

  test("Clearing changes", () => {
    diffManager.recordChange("/path/to/file.ts", "old content", "new content");
    diffManager.clear();
    assert.strictEqual(diffManager.isEmpty(), true);
  });

  test("Accept all changes", () => {
    diffManager.recordChange("file1.ts", "old1", "new1");
    diffManager.recordChange("file2.ts", "old2", "new2");
    diffManager.acceptAll();
    assert.strictEqual(diffManager.isEmpty(), true);
  });
});
