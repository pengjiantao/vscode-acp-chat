import * as assert from "assert";
import { ACPClient } from "../acp/client";
import { RequestPermissionRequest } from "@agentclientprotocol/sdk";

suite("Permission Request Tests", () => {
  let client: ACPClient;

  setup(() => {
    client = new ACPClient();
  });

  teardown(() => {
    client.dispose();
  });

  test("should fallback to auto-approve when no listeners are registered", async () => {
    const params: RequestPermissionRequest = {
      sessionId: "test-session",
      toolCall: {
        toolCallId: "test-tool-1",
        kind: "edit",
        title: "Write to file",
      },
      options: [
        { optionId: "allow", kind: "allow_once", name: "Allow" },
        { optionId: "deny", kind: "reject_once", name: "Deny" },
      ],
    };

    const response = await (client as any).handleRequestPermission(params);

    // Default behavior is to select the first 'allow' option
    assert.strictEqual(response.outcome.outcome, "selected");
    assert.strictEqual(response.outcome.optionId, "allow");
  });

  test("should call registered listener and use its response", async () => {
    const params: RequestPermissionRequest = {
      sessionId: "test-session",
      toolCall: {
        toolCallId: "test-tool-2",
        kind: "edit",
        title: "Write to file",
      },
      options: [
        { optionId: "allow", kind: "allow_once", name: "Allow" },
        { optionId: "deny", kind: "reject_once", name: "Deny" },
      ],
    };

    client.setOnPermissionRequest(async (p) => {
      assert.strictEqual(p.toolCall.toolCallId, "test-tool-2");
      return {
        outcome: {
          outcome: "selected",
          optionId: "deny",
        },
      };
    });

    const response = await (client as any).handleRequestPermission(params);
    assert.strictEqual(response.outcome.outcome, "selected");
    assert.strictEqual(response.outcome.optionId, "deny");
  });

  test("should fallback to auto-approve if listener throws", async () => {
    const params: RequestPermissionRequest = {
      sessionId: "test-session",
      toolCall: {
        toolCallId: "test-tool-3",
        kind: "edit",
        title: "Write to file",
      },
      options: [
        { optionId: "allow", kind: "allow_once", name: "Allow" },
        { optionId: "deny", kind: "reject_once", name: "Deny" },
      ],
    };

    client.setOnPermissionRequest(async () => {
      throw new Error("Listener failed");
    });

    const response = await (client as any).handleRequestPermission(params);
    assert.strictEqual(response.outcome.outcome, "selected");
    assert.strictEqual(response.outcome.optionId, "allow");
  });
});
