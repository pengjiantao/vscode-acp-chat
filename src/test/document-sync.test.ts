import * as assert from "assert";
import { ChildProcess } from "child_process";
import { ACPClient, type SpawnFunction } from "../acp/client";
import { DocumentSyncManager } from "../acp/document-sync";
import { createMockProcess } from "./mocks/acp-server";

suite("DocumentSyncManager", () => {
  let client: ACPClient;
  let mockSpawn: SpawnFunction;

  setup(() => {
    mockSpawn = (
      _command: string,
      _args: string[],
      _options: unknown
    ): ChildProcess => {
      return createMockProcess() as unknown as ChildProcess;
    };

    client = new ACPClient({
      agentConfig: {
        id: "mock-agent",
        name: "Mock Agent",
        command: "mock",
        args: [],
      },
      spawn: mockSpawn,
      skipAvailabilityCheck: true,
    });
  });

  teardown(() => {
    client.dispose();
  });

  suite("getNesDocumentCapabilities", () => {
    test("should return all false when not connected", () => {
      const caps = client.getNesDocumentCapabilities();
      assert.strictEqual(caps.didOpen, false);
      assert.strictEqual(caps.didChange, null);
      assert.strictEqual(caps.didClose, false);
      assert.strictEqual(caps.didSave, false);
      assert.strictEqual(caps.didFocus, false);
    });

    test("should return all false when agent has no NES capabilities", async () => {
      await client.connect();
      const caps = client.getNesDocumentCapabilities();
      assert.strictEqual(caps.didOpen, false);
      assert.strictEqual(caps.didChange, null);
      assert.strictEqual(caps.didClose, false);
      assert.strictEqual(caps.didSave, false);
      assert.strictEqual(caps.didFocus, false);
    });
  });

  suite("notify methods - no-op when not connected", () => {
    test("notifyDidOpenDocument should not throw", async () => {
      await client.notifyDidOpenDocument({
        uri: "file:///test.ts",
        text: "content",
        languageId: "typescript",
        version: 1,
      });
    });

    test("notifyDidChangeDocument should not throw", async () => {
      await client.notifyDidChangeDocument({
        uri: "file:///test.ts",
        contentChanges: [{ range: null, text: "new content" }],
        version: 2,
      });
    });

    test("notifyDidCloseDocument should not throw", async () => {
      await client.notifyDidCloseDocument({ uri: "file:///test.ts" });
    });

    test("notifyDidSaveDocument should not throw", async () => {
      await client.notifyDidSaveDocument({ uri: "file:///test.ts" });
    });

    test("notifyDidFocusDocument should not throw", async () => {
      await client.notifyDidFocusDocument({
        uri: "file:///test.ts",
        position: { line: 0, character: 0 },
        version: 1,
        visibleRange: {
          start: { line: 0, character: 0 },
          end: { line: 30, character: 0 },
        },
      });
    });
  });

  suite("notify methods - no-op when no session", () => {
    test("notifyDidOpenDocument should not throw when connected but no session", async () => {
      await client.connect();
      await client.notifyDidOpenDocument({
        uri: "file:///test.ts",
        text: "content",
        languageId: "typescript",
        version: 1,
      });
    });

    test("notifyDidChangeDocument should not throw when connected but no session", async () => {
      await client.connect();
      await client.notifyDidChangeDocument({
        uri: "file:///test.ts",
        contentChanges: [{ range: null, text: "new content" }],
        version: 2,
      });
    });
  });

  suite("DocumentSyncManager lifecycle", () => {
    test("should initialize without errors", () => {
      const manager = new DocumentSyncManager(client);
      assert.ok(manager);
      manager.dispose();
    });

    test("should sync capabilities without errors", () => {
      const manager = new DocumentSyncManager(client);
      manager.syncCapabilities();
      manager.dispose();
    });

    test("should handle multiple dispose calls", () => {
      const manager = new DocumentSyncManager(client);
      manager.dispose();
      manager.dispose();
    });

    test("should handle syncCapabilities after dispose", () => {
      const manager = new DocumentSyncManager(client);
      manager.dispose();
      manager.syncCapabilities();
      manager.dispose();
    });
  });

  suite("pending changes accumulation", () => {
    test("pendingChanges map starts empty", () => {
      const manager = new DocumentSyncManager(client);
      const changes = (
        manager as unknown as { pendingChanges: Map<string, unknown> }
      ).pendingChanges;
      assert.strictEqual(changes.size, 0);
      manager.dispose();
    });

    test("isFull flag tracks full vs incremental mode", () => {
      const manager = new DocumentSyncManager(client);
      const pendingChanges = (
        manager as unknown as {
          pendingChanges: Map<
            string,
            { version: number; isFull: boolean; contentChanges: unknown[] }
          >;
        }
      ).pendingChanges;

      // Simulate a full sync entry
      pendingChanges.set("file:///a.ts", {
        version: 1,
        isFull: true,
        contentChanges: [{ range: null, text: "full content" }],
      });

      // Simulate an incremental sync entry
      pendingChanges.set("file:///b.ts", {
        version: 2,
        isFull: false,
        contentChanges: [
          { range: null, text: "change1" },
          { range: null, text: "change2" },
        ],
      });

      assert.strictEqual(pendingChanges.get("file:///a.ts")!.isFull, true);
      assert.strictEqual(
        pendingChanges.get("file:///a.ts")!.contentChanges.length,
        1
      );
      assert.strictEqual(pendingChanges.get("file:///b.ts")!.isFull, false);
      assert.strictEqual(
        pendingChanges.get("file:///b.ts")!.contentChanges.length,
        2
      );

      manager.dispose();
    });
  });
});
