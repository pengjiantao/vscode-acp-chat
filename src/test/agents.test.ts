import * as assert from "assert";
import { AGENTS, getAgent, getFirstAvailableAgent } from "../acp/agents";

suite("agents", () => {
  suite("AGENTS", () => {
    test("should have at least one agent defined", () => {
      assert.ok(AGENTS.length > 0);
    });

    test("should have unique ids for all agents", () => {
      const ids = AGENTS.map((a) => a.id);
      const uniqueIds = new Set(ids);
      assert.strictEqual(uniqueIds.size, ids.length);
    });

    test("should have required properties for each agent", () => {
      for (const agent of AGENTS) {
        assert.ok(agent.id, "agent.id should be defined");
        assert.ok(agent.name, "agent.name should be defined");
        assert.ok(agent.command, "agent.command should be defined");
        assert.ok(Array.isArray(agent.args), "agent.args should be an array");
      }
    });

    test("should include opencode agent", () => {
      const opencode = AGENTS.find((a) => a.id === "opencode");
      assert.ok(opencode, "opencode agent should exist");
      assert.strictEqual(opencode?.command, "opencode");
    });

    test("should include claude-code agent", () => {
      const claude = AGENTS.find((a) => a.id === "claude-code");
      assert.ok(claude, "claude-code agent should exist");
      assert.strictEqual(claude?.command, "npx");
    });
  });

  suite("getAgent", () => {
    test("should return agent by id", () => {
      const agent = getAgent("opencode");
      assert.ok(agent, "agent should be defined");
      assert.strictEqual(agent?.id, "opencode");
      assert.strictEqual(agent?.name, "OpenCode");
    });

    test("should return undefined for unknown id", () => {
      const agent = getAgent("nonexistent-agent");
      assert.strictEqual(agent, undefined);
    });
  });

  suite("getFirstAvailableAgent", () => {
    test("should return an agent with required properties", () => {
      const agent = getFirstAvailableAgent();
      assert.ok(agent, "agent should be defined");
      assert.ok(agent.id, "agent.id should be defined");
      assert.ok(agent.name, "agent.name should be defined");
      assert.ok(agent.command, "agent.command should be defined");
      assert.ok(Array.isArray(agent.args), "agent.args should be an array");
    });

    test("should return an agent from AGENTS", () => {
      const agent = getFirstAvailableAgent();
      const agentIds = AGENTS.map((a) => a.id);
      assert.ok(
        agentIds.includes(agent.id),
        `agent.id ${agent.id} should be in AGENTS`
      );
    });
  });
});
