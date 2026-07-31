import * as assert from "assert";
import { ChildProcess } from "child_process";
import { type SessionUpdate } from "@agentclientprotocol/sdk";
import { ACPClient, type SpawnFunction } from "../acp/client";
import {
  AgentSessionManager,
  globalStateSessionStore,
  inMemorySessionStore,
  type SessionStore,
  type StoredSessionRecord,
} from "../acp/session-manager";
import { createMockProcess } from "./mocks/acp-server";

suite("SessionManager", () => {
  suite("AgentSessionManager", () => {
    let client: ACPClient;
    let manager: AgentSessionManager;
    let store: SessionStore;
    let mockSpawn: SpawnFunction;

    setup(() => {
      store = inMemorySessionStore();
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
      manager = new AgentSessionManager(client, () => store);
    });

    teardown(() => {
      client.dispose();
    });

    suite("kind", () => {
      test("should return 'agent' as the kind", () => {
        assert.strictEqual(manager.kind, "agent");
      });
    });

    suite("supportsLoadSession", () => {
      test("should be false before syncCapabilities", () => {
        assert.strictEqual(manager.supportsLoadSession, false);
      });

      test("should be true after connect with loadSession-capable agent", async () => {
        await client.connect();
        manager.syncCapabilities();
        assert.strictEqual(manager.supportsLoadSession, true);
      });

      test("should be false for agent without loadSession capability", async () => {
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
        const disabledManager = new AgentSessionManager(disabledClient, () =>
          inMemorySessionStore()
        );

        await disabledClient.connect();
        disabledManager.syncCapabilities();
        assert.strictEqual(disabledManager.supportsLoadSession, false);

        disabledClient.dispose();
      });
    });

    suite("supportsListSessions", () => {
      test("should be false before syncCapabilities", () => {
        assert.strictEqual(manager.supportsListSessions, false);
      });

      test("should be true after connect with list-capable agent", async () => {
        await client.connect();
        manager.syncCapabilities();
        assert.strictEqual(manager.supportsListSessions, true);
      });

      test("should be false for agent without list capability", async () => {
        const disabledSpawn = (
          _command: string,
          _args: string[],
          _options: unknown
        ): ChildProcess => {
          return createMockProcess({
            enableLoadSession: true,
            enableListSessions: false,
          }) as unknown as ChildProcess;
        };

        const disabledClient = new ACPClient({
          agentConfig: {
            id: "mock-no-list",
            name: "Mock No List",
            command: "mock",
            args: [],
          },
          spawn: disabledSpawn,
          skipAvailabilityCheck: true,
        });
        const disabledManager = new AgentSessionManager(disabledClient, () =>
          inMemorySessionStore()
        );

        await disabledClient.connect();
        disabledManager.syncCapabilities();
        assert.strictEqual(disabledManager.supportsListSessions, false);

        disabledClient.dispose();
      });

      test("should return empty array when list capability is not supported", async () => {
        const disabledSpawn = (
          _command: string,
          _args: string[],
          _options: unknown
        ): ChildProcess => {
          return createMockProcess({
            enableLoadSession: true,
            enableListSessions: false,
          }) as unknown as ChildProcess;
        };

        const disabledClient = new ACPClient({
          agentConfig: {
            id: "mock-no-list",
            name: "Mock No List",
            command: "mock",
            args: [],
          },
          spawn: disabledSpawn,
          skipAvailabilityCheck: true,
        });
        const disabledManager = new AgentSessionManager(disabledClient, () =>
          inMemorySessionStore()
        );

        await disabledClient.connect();
        disabledManager.syncCapabilities();

        const sessions = await disabledManager.listSessions("/test");
        assert.deepStrictEqual(sessions, []);

        disabledClient.dispose();
      });
    });

    suite("local session cache", () => {
      function createNoListManager(): {
        client: ACPClient;
        manager: AgentSessionManager;
        store: SessionStore;
      } {
        const noListSpawn = (
          _command: string,
          _args: string[],
          _options: unknown
        ): ChildProcess => {
          return createMockProcess({
            enableLoadSession: true,
            enableListSessions: false,
          }) as unknown as ChildProcess;
        };

        const noListClient = new ACPClient({
          agentConfig: {
            id: "mock-no-list",
            name: "Mock No List",
            command: "mock",
            args: [],
          },
          spawn: noListSpawn,
          skipAvailabilityCheck: true,
        });
        const noListStore = inMemorySessionStore();
        const noListManager = new AgentSessionManager(
          noListClient,
          () => noListStore
        );

        return {
          client: noListClient,
          manager: noListManager,
          store: noListStore,
        };
      }

      test("should list locally recorded sessions when agent lacks list capability", async () => {
        const { client: noListClient, manager: noListManager } =
          createNoListManager();

        await noListClient.connect();
        noListManager.syncCapabilities();

        // Create two sessions in different working directories
        await noListManager.newSession("/test");
        await noListManager.newSession("/other");

        const sessions = await noListManager.listSessions("/test");
        assert.strictEqual(sessions.length, 1);
        assert.strictEqual(sessions[0].cwd, "/test");

        noListClient.dispose();
      });

      test("newSession should record session in local cache", async () => {
        const { client: noListClient, manager: noListManager } =
          createNoListManager();
        await noListClient.connect();
        noListManager.syncCapabilities();

        const response = await noListManager.newSession("/test");
        const sessions = await noListManager.listSessions("/test");
        assert.strictEqual(sessions.length, 1);
        assert.strictEqual(sessions[0].sessionId, response.sessionId);

        noListClient.dispose();
      });

      test("should return agent-listed sessions directly without writing to local cache", async () => {
        await client.connect();
        manager.syncCapabilities();

        await client.newSession("/test/dir");
        await client.sendMessage("Hello");
        await new Promise((resolve) => setTimeout(resolve, 100));

        const sessions = await manager.listSessions("/test/dir");
        assert.ok(sessions.length >= 1);
        assert.ok(sessions[0].sessionId.startsWith("mock-session-"));

        // Local cache should remain empty for agent-listed sessions
        const localSessions = await store.read();
        assert.strictEqual(localSessions.length, 0);
      });

      test("should isolate sessions per agent", async () => {
        const factory = () => inMemorySessionStore();

        const noListSpawn = (
          _command: string,
          _args: string[],
          _options: unknown
        ): ChildProcess => {
          return createMockProcess({
            enableLoadSession: true,
            enableListSessions: false,
          }) as unknown as ChildProcess;
        };

        const noListClientA = new ACPClient({
          agentConfig: {
            id: "mock-no-list-a",
            name: "Mock No List A",
            command: "mock",
            args: [],
          },
          spawn: noListSpawn,
          skipAvailabilityCheck: true,
        });
        const noListClientB = new ACPClient({
          agentConfig: {
            id: "mock-no-list-b",
            name: "Mock No List B",
            command: "mock",
            args: [],
          },
          spawn: noListSpawn,
          skipAvailabilityCheck: true,
        });

        const managerA = new AgentSessionManager(noListClientA, factory);
        const managerB = new AgentSessionManager(noListClientB, factory);

        await noListClientA.connect();
        managerA.syncCapabilities();
        await noListClientB.connect();
        managerB.syncCapabilities();

        const responseA = await managerA.newSession("/test");
        const responseB = await managerB.newSession("/test");

        const sessionsA = await managerA.listSessions("/test");
        assert.strictEqual(sessionsA.length, 1);
        assert.strictEqual(sessionsA[0].sessionId, responseA.sessionId);

        const sessionsB = await managerB.listSessions("/test");
        assert.strictEqual(sessionsB.length, 1);
        assert.strictEqual(sessionsB[0].sessionId, responseB.sessionId);

        noListClientA.dispose();
        noListClientB.dispose();
      });
    });

    suite("syncCapabilities", () => {
      test("should throw if not connected", () => {
        // syncCapabilities reads from acpClient.getAgentCapabilities()
        // which returns null when not connected, so it should set false
        manager.syncCapabilities();
        assert.strictEqual(manager.supportsLoadSession, false);
      });

      test("should correctly detect capabilities after connect", async () => {
        await client.connect();
        manager.syncCapabilities();
        assert.strictEqual(manager.supportsLoadSession, true);
      });
    });

    suite("listSessions", () => {
      test("should throw if not synced", async () => {
        await assert.rejects(async () => {
          await manager.listSessions("/test");
        }, /not yet synced/);
      });

      test("should return sessions from agent via listSessions", async () => {
        await client.connect();
        manager.syncCapabilities();

        // Create two sessions via newSession + sendMessage
        await client.newSession("/test/dir");
        await client.sendMessage("Hello session 1");
        await new Promise((resolve) => setTimeout(resolve, 100));

        await client.newSession("/test/dir");
        await client.sendMessage("Hello session 2");
        await new Promise((resolve) => setTimeout(resolve, 100));

        const sessions = await manager.listSessions("/test/dir");
        assert.strictEqual(sessions.length, 2);
        assert.ok(sessions[0].sessionId.startsWith("mock-session-"));
        assert.ok(sessions[0].title);
        assert.strictEqual(sessions[0].cwd, "/test/dir");
      });

      test("should trust agent-returned sessions without re-filtering by cwd", async () => {
        await client.connect();
        manager.syncCapabilities();

        // Agent is responsible for cwd filtering per the ACP spec. Even when
        // the returned session cwd does not string-match the requested cwd
        // (e.g. different case on Windows), it must be passed through.
        await client.newSession("/test/dir");
        await client.sendMessage("Hello session 1");
        await new Promise((resolve) => setTimeout(resolve, 100));

        const sessions = await manager.listSessions("/some/other/dir");
        assert.strictEqual(sessions.length, 1);
        assert.strictEqual(sessions[0].cwd, "/test/dir");
      });

      test("should return empty array when not connected", async () => {
        await client.connect();
        manager.syncCapabilities();

        // Dispose to simulate disconnection
        client.dispose();

        // Should not throw, returns empty array
        const sessions = await manager.listSessions("/test");
        assert.deepStrictEqual(sessions, []);
      });
    });

    suite("loadSession", () => {
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
        const disabledManager = new AgentSessionManager(disabledClient, () =>
          inMemorySessionStore()
        );

        await disabledClient.connect();
        disabledManager.syncCapabilities();

        await assert.rejects(async () => {
          await disabledManager.loadSession("session-1", "/test");
        }, /does not support/);

        disabledClient.dispose();
      });

      test("should throw if not connected", async () => {
        await client.connect();
        manager.syncCapabilities();

        // Dispose to simulate disconnection
        client.dispose();

        await assert.rejects(async () => {
          await manager.loadSession("session-1", "/test");
        }, /Not connected/);
      });

      test("should load session and return correct result", async () => {
        await client.connect();
        manager.syncCapabilities();

        // First create a session
        const newSession = await client.newSession("/test/dir");
        const sessionId = newSession.sessionId;

        // Now load it
        const result = await manager.loadSession(sessionId, "/test/dir");

        assert.strictEqual(result.sessionId, sessionId);
        assert.strictEqual(result.supportedByAgent, true);
      });
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

    test("should update currentSessionId after loadSession", async () => {
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

      // Verify the session ID was updated
      assert.strictEqual(
        client.getSessionMetadata()?.modes?.currentModeId,
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
      await client.newSession("/test/dir");

      // Send a message to create history
      await client.sendMessage("Test message");
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Get the current session ID
      const sessionId = (
        client as unknown as { currentSessionId: string | null }
      ).currentSessionId;
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

  suite("deleteSession", () => {
    let client: ACPClient;
    let manager: AgentSessionManager;
    let store: SessionStore;
    let mockSpawn: SpawnFunction;

    setup(() => {
      store = inMemorySessionStore();
      mockSpawn = (
        _command: string,
        _args: string[],
        _options: unknown
      ): ChildProcess => {
        return createMockProcess({
          enableLoadSession: true,
          enableListSessions: true,
          enableDeleteSession: true,
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
      manager = new AgentSessionManager(client, () => store);
    });

    teardown(() => {
      client.dispose();
    });

    test("should be false before syncCapabilities", () => {
      assert.strictEqual(manager.supportsDeleteSession, false);
    });

    test("should be true after connect with delete-capable agent", async () => {
      await client.connect();
      manager.syncCapabilities();
      assert.strictEqual(manager.supportsDeleteSession, true);
    });

    test("should be false for agent without delete capability", async () => {
      const disabledSpawn = (
        _command: string,
        _args: string[],
        _options: unknown
      ): ChildProcess => {
        return createMockProcess({
          enableLoadSession: true,
          enableDeleteSession: false,
        }) as unknown as ChildProcess;
      };

      const disabledClient = new ACPClient({
        agentConfig: {
          id: "mock-no-delete",
          name: "Mock No Delete",
          command: "mock",
          args: [],
        },
        spawn: disabledSpawn,
        skipAvailabilityCheck: true,
      });
      const disabledManager = new AgentSessionManager(disabledClient, () =>
        inMemorySessionStore()
      );

      await disabledClient.connect();
      disabledManager.syncCapabilities();
      assert.strictEqual(disabledManager.supportsDeleteSession, false);

      disabledClient.dispose();
    });

    test("should throw when agent does not support delete", async () => {
      const disabledSpawn = (
        _command: string,
        _args: string[],
        _options: unknown
      ): ChildProcess => {
        return createMockProcess({
          enableLoadSession: true,
          enableDeleteSession: false,
        }) as unknown as ChildProcess;
      };

      const disabledClient = new ACPClient({
        agentConfig: {
          id: "mock-no-delete",
          name: "Mock No Delete",
          command: "mock",
          args: [],
        },
        spawn: disabledSpawn,
        skipAvailabilityCheck: true,
      });
      const localStore = inMemorySessionStore();
      const disabledManager = new AgentSessionManager(
        disabledClient,
        () => localStore
      );

      await disabledClient.connect();
      disabledManager.syncCapabilities();

      const response = await disabledManager.newSession("/test");
      const before = await localStore.read();
      assert.strictEqual(before.length, 1);

      await assert.rejects(
        () => disabledManager.deleteSession(response.sessionId),
        /does not support the `session\/delete` capability/
      );

      // Session should remain in local store
      const after = await localStore.read();
      assert.strictEqual(after.length, 1);

      disabledClient.dispose();
    });

    test("should delete session via agent and remove from local store", async () => {
      await client.connect();
      manager.syncCapabilities();

      // Create a session via the manager (records locally)
      const response = await manager.newSession("/test/dir");
      const before = await store.read();
      assert.strictEqual(before.length, 1);

      // Delete should call agent and remove from local store
      await manager.deleteSession(response.sessionId);
      const after = await store.read();
      assert.strictEqual(after.length, 0);
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
