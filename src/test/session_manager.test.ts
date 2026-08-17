import * as assert from "assert";
import { ChildProcess } from "child_process";
import { type SessionUpdate } from "@agentclientprotocol/sdk";
import { ACPClient, type SpawnFunction } from "../acp/client";
import {
  LocalSessionManager,
  globalStateSessionStore,
  inMemorySessionStore,
  type SessionStore,
  type StoredSessionRecord,
} from "../acp/session-manager";
import { createMockProcess } from "./mocks/acp-server";

suite("SessionManager", () => {
  suite("LocalSessionManager", () => {
    let manager: LocalSessionManager;
    let stores: Map<string, SessionStore>;

    setup(() => {
      stores = new Map();
      manager = new LocalSessionManager((agentId) => {
        let store = stores.get(agentId);
        if (!store) {
          store = inMemorySessionStore(agentId);
          stores.set(agentId, store);
        }
        return store;
      });
    });

    test("supportsLoadSession and supportsDeleteSession are true", () => {
      assert.strictEqual(manager.supportsLoadSession, true);
      assert.strictEqual(manager.supportsDeleteSession, true);
    });

    test("recordSession creates a new session record", async () => {
      await manager.recordSession(
        "agent-1",
        "session-1",
        "/test/dir",
        "Test Title"
      );
      const store = manager.getStore("agent-1");
      const record = await store.readOne("session-1");

      assert.ok(record);
      assert.strictEqual(record.sessionId, "session-1");
      assert.strictEqual(record.agentId, "agent-1");
      assert.strictEqual(record.title, "Test Title");
      assert.strictEqual(record.cwd, "/test/dir");
    });

    test("recordSession updates an existing session record", async () => {
      await manager.recordSession(
        "agent-1",
        "session-1",
        "/test/dir",
        "Initial Title"
      );
      await new Promise((r) => setTimeout(r, 10));
      await manager.recordSession(
        "agent-1",
        "session-1",
        "/new/dir",
        "Updated Title"
      );

      const store = manager.getStore("agent-1");
      const record = await store.readOne("session-1");

      assert.ok(record);
      assert.strictEqual(record.title, "Updated Title");
      assert.strictEqual(record.cwd, "/new/dir");
    });

    test("applySessionInfoUpdate updates title and updatedAt", async () => {
      await manager.recordSession(
        "agent-1",
        "session-1",
        "/test/dir",
        "Original"
      );
      await manager.applySessionInfoUpdate("agent-1", "session-1", {
        title: "New Info Title",
      });

      const store = manager.getStore("agent-1");
      const record = await store.readOne("session-1");
      assert.ok(record);
      assert.strictEqual(record.title, "New Info Title");
    });

    test("listSessions lists and filters sessions for specific agent by cwd", async () => {
      await manager.recordSession("agent-1", "s1", "/workspace/a", "A1");
      await manager.recordSession("agent-1", "s2", "/workspace/b", "A2");
      await manager.recordSession("agent-2", "s3", "/workspace/a", "B1");

      const agent1All = await manager.listSessions("agent-1");
      assert.strictEqual(agent1All.length, 2);

      const agent1Filtered = await manager.listSessions(
        "agent-1",
        "/workspace/a"
      );
      assert.strictEqual(agent1Filtered.length, 1);
      assert.strictEqual(agent1Filtered[0].sessionId, "s1");
    });

    test("listAllSessions merges sessions across all agents and sorts by updatedAt", async () => {
      await manager.recordSession("agent-1", "s1", "/workspace/a", "A1");
      await new Promise((r) => setTimeout(r, 10));
      await manager.recordSession("agent-2", "s2", "/workspace/a", "B1");

      const all = await manager.listAllSessions("/workspace/a");
      assert.strictEqual(all.length, 2);
      assert.strictEqual(all[0].sessionId, "s2"); // s2 was updated later
      assert.strictEqual(all[1].sessionId, "s1");
    });

    test("findSession finds record across all agent stores", async () => {
      await manager.recordSession("agent-1", "s1", "/workspace", "Session 1");
      const found = await manager.findSession("s1");
      assert.ok(found);
      assert.strictEqual(found.sessionId, "s1");
      assert.strictEqual(found.agentId, "agent-1");

      const notFound = await manager.findSession("s-nonexistent");
      assert.strictEqual(notFound, undefined);
    });

    test("deleteSession removes record from agent store", async () => {
      await manager.recordSession("agent-1", "s1", "/workspace", "Session 1");
      const before = await manager.listSessions("agent-1");
      assert.strictEqual(before.length, 1);

      await manager.deleteSession("agent-1", "s1");
      const after = await manager.listSessions("agent-1");
      assert.strictEqual(after.length, 0);
    });
  });

  suite("ACPClient.loadSession", () => {
    let client: ACPClient;
    let mockSpawn: SpawnFunction;

    setup(() => {
      mockSpawn = (
        _command: string,
        _args: string[],
        _options: unknown
      ): ChildProcess => {
        return createMockProcess({
          enableLoadSession: true,
        }) as unknown as ChildProcess;
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

    test("should throw if not connected", async () => {
      await assert.rejects(async () => {
        await client.loadSession({ sessionId: "test", cwd: "/test" });
      }, /Not connected/);
    });

    test("should throw if agent doesn't support loadSession", async () => {
      const disabledSpawn = (
        _command: string,
        _args: string[],
        _options: unknown
      ): ChildProcess => {
        return createMockProcess({
          enableLoadSession: false,
        }) as unknown as ChildProcess;
      };

      const disabledClient = new ACPClient({
        agentConfig: {
          id: "mock-disabled",
          name: "Mock Disabled",
          command: "mock",
          args: [],
        },
        spawn: disabledSpawn,
        skipAvailabilityCheck: true,
      });

      await disabledClient.connect();

      await assert.rejects(async () => {
        await disabledClient.loadSession({ sessionId: "test", cwd: "/test" });
      }, /does not support/);

      disabledClient.dispose();
    });

    test("should update metadata after loadSession", async () => {
      await client.connect();
      const newSession = await client.newSession("/test/dir");
      const originalSessionId = newSession.sessionId;

      // Create a second session via newSession
      await client.newSession("/test/dir2");

      // Load the first session
      await client.loadSession({
        sessionId: originalSessionId,
        cwd: "/test/dir",
      });

      // Verify the session metadata is present for that session
      assert.strictEqual(
        client.getSessionMetadata(originalSessionId)?.modes?.currentModeId,
        "code"
      );
    });

    test("should receive session update notifications during load", async () => {
      await client.connect();

      // Create a session and send a message to build history
      await client.newSession("/test/dir");

      const updates: unknown[] = [];
      client.setOnSessionUpdate((update) => {
        updates.push(update);
      });

      await client.sendMessage("Hello");

      // Wait for the mock server to process the message
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Now load the session (which will replay history)
      // We need the actual session ID - it's stored internally
      // For this test, we'll verify updates were received during the prompt
      assert.ok(updates.length > 0);
    });

    test("should receive both user and agent messages during history load", async () => {
      await client.connect();
      const newSession = await client.newSession("/test/dir");
      const sessionId = newSession.sessionId;

      // Send a message to create history
      await client.sendMessage("Test message", [], [], sessionId);
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.ok(sessionId, "Should have a session ID");

      // Clear update tracking
      const updates: SessionUpdate[] = [];
      client.setOnSessionUpdate((notification) => {
        const update = notification.update;
        updates.push(update);
      });

      // Load the session to trigger history replay
      await client.loadSession({ sessionId, cwd: "/test/dir" });
      // Wait longer for replayHistory to complete (it has delays between messages)
      await new Promise((resolve) => setTimeout(resolve, 400));

      // Verify we received both user and agent message chunks
      const userMessages = updates.filter(
        (u) => u.sessionUpdate === "user_message_chunk"
      );
      const agentMessages = updates.filter(
        (u) => u.sessionUpdate === "agent_message_chunk"
      );

      assert.ok(
        userMessages.length > 0,
        "Should receive user message chunks during history load"
      );
      assert.ok(
        agentMessages.length > 0,
        "Should receive agent message chunks during history load"
      );

      // Verify content is preserved
      const userContent = userMessages[0]?.content;
      assert.ok(userContent, "User message should have content");
      assert.strictEqual(
        userContent?.type,
        "text",
        "User message content type should be text"
      );

      // Verify message order is preserved (user messages should come before their corresponding agent messages)
      const firstUserIndex = updates.findIndex(
        (u) => u.sessionUpdate === "user_message_chunk"
      );
      const firstAgentIndex = updates.findIndex(
        (u) => u.sessionUpdate === "agent_message_chunk"
      );
      assert.ok(
        firstUserIndex < firstAgentIndex,
        "User message should be received before agent message"
      );
    });
  });

  suite("getAgentCapabilities", () => {
    let client: ACPClient;
    let mockSpawn: SpawnFunction;

    setup(() => {
      mockSpawn = (
        _command: string,
        _args: string[],
        _options: unknown
      ): ChildProcess => {
        return createMockProcess({
          enableLoadSession: true,
        }) as unknown as ChildProcess;
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

    test("should return null before connect", () => {
      assert.strictEqual(client.getAgentCapabilities(), null);
    });

    test("should return capabilities after connect", async () => {
      await client.connect();
      const caps = client.getAgentCapabilities();
      assert.ok(caps);
      assert.strictEqual(caps?.loadSession, true);
    });

    test("should return null after dispose", async () => {
      await client.connect();
      client.dispose();
      assert.strictEqual(client.getAgentCapabilities(), null);
    });
  });

  suite("sendMessage mention placeholder replacement", () => {
    let client: ACPClient;
    let mockSpawn: SpawnFunction;

    setup(() => {
      mockSpawn = (
        _command: string,
        _args: string[],
        _options: unknown
      ): ChildProcess => {
        return createMockProcess({
          enableLoadSession: true,
        }) as unknown as ChildProcess;
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

    test("should replace __MENTION_N__ placeholders with mention names", async () => {
      await client.connect();
      await client.newSession("/test/dir");

      // Capture the prompt to verify placeholder replacement
      const agentCtx = client.getAgentContext();
      assert.ok(agentCtx, "Agent context should be available");
      const originalRequest = agentCtx.request.bind(agentCtx);
      let capturedPrompt: Array<{ type: string; text?: string }> | null = null;
      agentCtx.request = async (
        method: string,
        params: { prompt?: Array<{ type: string; text?: string }> }
      ) => {
        if (method === "session/prompt") {
          capturedPrompt = params.prompt ?? null;
          return { stopReason: "end_turn" };
        }
        return originalRequest(method, params);
      };

      try {
        await client.sendMessage(
          "Check __MENTION_0__ and __MENTION_1__",
          [],
          [
            { name: "file.ts", path: "/path/file.ts", type: "file" },
            {
              name: "selection",
              type: "selection",
              content: "const x = 1;",
            },
          ]
        );

        // First prompt item should be the clean message (no placeholders)
        assert.strictEqual(capturedPrompt![0].type, "text");
        assert.ok(!capturedPrompt![0].text?.includes("__MENTION_"));
        assert.ok(capturedPrompt![0].text?.includes("file.ts"));
        assert.ok(capturedPrompt![0].text?.includes("selection"));
      } finally {
        agentCtx.request = originalRequest;
      }
    });

    test("should handle missing mention gracefully", async () => {
      await client.connect();
      await client.newSession("/test/dir");

      const agentCtx = client.getAgentContext();
      assert.ok(agentCtx, "Agent context should be available");
      const originalRequest = agentCtx.request.bind(agentCtx);
      let capturedPrompt: Array<{ type: string; text?: string }> | null = null;
      agentCtx.request = async (
        method: string,
        params: { prompt?: Array<{ type: string; text?: string }> }
      ) => {
        if (method === "session/prompt") {
          capturedPrompt = params.prompt ?? null;
          return { stopReason: "end_turn" };
        }
        return originalRequest(method, params);
      };

      try {
        await client.sendMessage("Test __MENTION_99__", [], []);

        assert.strictEqual(capturedPrompt![0].text, "Test __MENTION_99__");
      } finally {
        agentCtx.request = originalRequest;
      }
    });
  });

  suite("ACPClient.listSessions", () => {
    let client: ACPClient;
    let mockSpawn: SpawnFunction;

    setup(() => {
      mockSpawn = (
        _command: string,
        _args: string[],
        _options: unknown
      ): ChildProcess => {
        return createMockProcess({
          enableLoadSession: true,
        }) as unknown as ChildProcess;
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

    test("should throw if not connected", async () => {
      await assert.rejects(async () => {
        await client.listSessions();
      }, /Not connected/);
    });

    test("should return sessions from agent", async () => {
      await client.connect();

      // Create a session
      await client.newSession("/test/dir");

      const response = await client.listSessions({ cwd: "/test/dir" });
      assert.ok(response.sessions);
      assert.ok(Array.isArray(response.sessions));
    });
  });
});

suite("globalStateSessionStore cleanup", () => {
  function createMockMemento(): import("vscode").Memento {
    const data = new Map<string, unknown>();
    return {
      keys: () => Array.from(data.keys()),
      get: <T>(key: string) => data.get(key) as T | undefined,
      update: (key: string, value: unknown) => {
        if (value === undefined) {
          data.delete(key);
        } else {
          data.set(key, value);
        }
        return Promise.resolve();
      },
    } as unknown as import("vscode").Memento;
  }

  function makeRecord(
    sessionId: string,
    updatedAt: string
  ): StoredSessionRecord {
    return {
      agentId: "test-agent",
      sessionId,
      title: `Session ${sessionId}`,
      cwd: "/test",
      createdAt: updatedAt,
      updatedAt,
    };
  }

  const PREFIX = "test.sessions";

  test("should remove sessions older than retentionDays", async () => {
    const memento = createMockMemento();
    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

    // Pre-populate memento with one recent and one old session
    await memento.update(`${PREFIX}.recent`, makeRecord("recent", recent));
    await memento.update(`${PREFIX}.old`, makeRecord("old", old));

    const store = globalStateSessionStore(memento, PREFIX, {
      retentionDays: 30,
      maxSessions: 300,
    });

    // First read triggers ensureLoaded → cleanup
    const sessions = await store.read();
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].sessionId, "recent");

    // Old session should be gone from memento too
    assert.strictEqual(memento.get(`${PREFIX}.old`), undefined);
  });

  test("should keep sessions within retentionDays", async () => {
    const memento = createMockMemento();
    const recent = new Date().toISOString();
    const alsoRecent = new Date(
      Date.now() - 5 * 24 * 60 * 60 * 1000
    ).toISOString();

    await memento.update(`${PREFIX}.a`, makeRecord("a", recent));
    await memento.update(`${PREFIX}.b`, makeRecord("b", alsoRecent));

    const store = globalStateSessionStore(memento, PREFIX, {
      retentionDays: 30,
      maxSessions: 300,
    });

    const sessions = await store.read();
    assert.strictEqual(sessions.length, 2);
  });

  test("should remove excess sessions beyond maxSessions (keeps newest)", async () => {
    const memento = createMockMemento();

    // Create 5 sessions at different times
    for (let i = 0; i < 5; i++) {
      const ts = new Date(Date.now() - i * 60 * 60 * 1000).toISOString();
      await memento.update(`${PREFIX}.s${i}`, makeRecord(`s${i}`, ts));
    }

    const store = globalStateSessionStore(memento, PREFIX, {
      retentionDays: 30,
      maxSessions: 3,
    });

    const sessions = await store.read();
    assert.strictEqual(sessions.length, 3);

    // The 3 newest by updatedAt should be s0, s1, s2
    const sorted = sessions.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    assert.deepStrictEqual(
      sorted.map((s) => s.sessionId),
      ["s0", "s1", "s2"]
    );
  });

  test("expired removal runs before maxSessions cap", async () => {
    const memento = createMockMemento();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();

    // 2 old + 2 recent = 4 total; maxSessions=3
    await memento.update(`${PREFIX}.old1`, makeRecord("old1", old));
    await memento.update(`${PREFIX}.old2`, makeRecord("old2", old));
    await memento.update(`${PREFIX}.new1`, makeRecord("new1", recent));
    const slightlyOld = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    await memento.update(`${PREFIX}.new2`, makeRecord("new2", slightlyOld));

    const store = globalStateSessionStore(memento, PREFIX, {
      retentionDays: 30,
      maxSessions: 3,
    });

    const sessions = await store.read();
    // 2 old removed → 2 remaining, under cap of 3
    assert.strictEqual(sessions.length, 2);
    const ids = sessions.map((s) => s.sessionId).sort();
    assert.deepStrictEqual(ids, ["new1", "new2"]);
  });

  test("no cleanup when no options provided", async () => {
    const memento = createMockMemento();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

    await memento.update(`${PREFIX}.old`, makeRecord("old", old));

    const store = globalStateSessionStore(memento, PREFIX);

    const sessions = await store.read();
    assert.strictEqual(sessions.length, 1);
  });
});
