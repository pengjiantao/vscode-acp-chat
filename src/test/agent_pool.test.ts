import * as assert from "assert";
import { AgentPool } from "../acp/agent-pool";
import { ACPClient } from "../acp/client";

class MockTestClient {
  public connected = false;
  public disposed = false;
  public cancelCalled = false;
  public closed = false;

  isConnected() {
    return this.connected;
  }

  async connect(_cwd: string) {
    this.connected = true;
  }

  getAgentName() {
    return "Mock Agent";
  }

  getAgentCapabilities() {
    return {
      sessionCapabilities: {
        close: {},
      },
    };
  }

  async cancel(_sessionId?: string) {
    this.cancelCalled = true;
  }

  async closeSession() {
    this.closed = true;
  }

  dispose() {
    this.disposed = true;
    this.connected = false;
  }
}

suite("AgentPool Test Suite", () => {
  let pool: AgentPool;
  let createdClients: Map<string, MockTestClient>;

  setup(() => {
    createdClients = new Map();
    pool = new AgentPool({
      idleTimeoutMs: 50, // Short timeout for testing
      clientFactory: (config) => {
        const client = new MockTestClient();
        createdClients.set(config.id, client);
        return client as unknown as ACPClient;
      },
    });
  });

  teardown(() => {
    pool.dispose();
  });

  test("creates and reuses client for the same agentId", async () => {
    const client1 = await pool.getClient("agent-1", "/cwd");
    const client2 = await pool.getClient("agent-1", "/cwd");
    assert.strictEqual(client1, client2);
    assert.strictEqual(createdClients.size, 1);
  });

  test("creates separate clients for different agentIds", async () => {
    const client1 = await pool.getClient("agent-1", "/cwd");
    const client2 = await pool.getClient("agent-2", "/cwd");
    assert.notStrictEqual(client1, client2);
    assert.strictEqual(createdClients.size, 2);
    assert.strictEqual(pool.getActiveAgentCount(), 2);
  });

  test("onClientCreated fires for newly created clients", async () => {
    const initializedAgents: string[] = [];
    pool.onClientCreated((client, agentId) => {
      initializedAgents.push(agentId);
    });

    await pool.getClient("agent-a", "/cwd");
    await pool.getClient("agent-b", "/cwd");
    await pool.getClient("agent-a", "/cwd"); // Already created, should not re-trigger

    assert.deepStrictEqual(initializedAgents, ["agent-a", "agent-b"]);
  });

  test("session registration keeps agent alive and idle timeout cleans up when 0 sessions", async () => {
    await pool.getClient("agent-1", "/cwd");
    pool.registerSession("agent-1", "session-1");
    pool.registerSession("agent-1", "session-2");

    assert.strictEqual(pool.getActiveAgentCount(), 1);

    // Unregister session-1 -> still 1 session remaining
    pool.unregisterSession("agent-1", "session-1");
    await new Promise((r) => setTimeout(r, 70));
    assert.strictEqual(pool.getActiveAgentCount(), 1);

    // Unregister session-2 -> 0 sessions remaining -> idle timer fires
    pool.unregisterSession("agent-1", "session-2");
    await new Promise((r) => setTimeout(r, 70));
    assert.strictEqual(pool.getActiveAgentCount(), 0);
  });

  test("re-registering a session before idle timeout cancels teardown", async () => {
    await pool.getClient("agent-1", "/cwd");
    pool.registerSession("agent-1", "session-1");
    pool.unregisterSession("agent-1", "session-1");

    // Before 50ms expires, re-register
    await new Promise((r) => setTimeout(r, 20));
    pool.registerSession("agent-1", "session-2");

    // Wait past the original 50ms timeout
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(pool.getActiveAgentCount(), 1);
  });

  test("cancelSession delegates to client cancel", async () => {
    const client = (await pool.getClient(
      "agent-1",
      "/cwd"
    )) as unknown as MockTestClient;
    await pool.cancelSession("agent-1", "session-1");
    assert.strictEqual(client.cancelCalled, true);
  });

  test("dispose cleans up all clients", async () => {
    await pool.getClient("agent-1", "/cwd");
    await pool.getClient("agent-2", "/cwd");
    assert.strictEqual(pool.getActiveAgentCount(), 2);

    pool.dispose();
    assert.strictEqual(pool.getActiveAgentCount(), 0);
  });
});
