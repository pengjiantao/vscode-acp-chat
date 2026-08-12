/* eslint-disable @typescript-eslint/no-explicit-any */
import * as assert from "assert";
import { ACPClient } from "../acp/client";
import { CreateElicitationRequest } from "@agentclientprotocol/sdk";

function makeFormRequest(
  overrides: Partial<CreateElicitationRequest> = {}
): CreateElicitationRequest {
  return {
    mode: "form",
    sessionId: "test-session",
    message: "Please provide the following details",
    requestedSchema: {
      type: "object",
      title: "Deploy Details",
      properties: {
        target: { type: "string", title: "Target", enum: ["staging", "prod"] },
      },
      required: ["target"],
    },
    ...overrides,
  } as CreateElicitationRequest;
}

suite("Elicitation Request Tests", () => {
  let client: ACPClient;

  setup(() => {
    client = new ACPClient();
  });

  teardown(() => {
    client.dispose();
  });

  test("should fallback to decline when no listeners are registered", async () => {
    const response = await (client as any).handleElicitationRequest(
      makeFormRequest()
    );
    assert.strictEqual(response.action, "decline");
  });

  test("should call registered listener and use its response", async () => {
    client.setOnElicitationRequest(async (params) => {
      assert.strictEqual(
        params.message,
        "Please provide the following details"
      );
      return {
        action: "accept",
        content: { target: "prod" },
      };
    });

    const response = await (client as any).handleElicitationRequest(
      makeFormRequest()
    );
    assert.strictEqual(response.action, "accept");
    assert.deepStrictEqual(response.content, { target: "prod" });
  });

  test("should fallback to decline if listener throws", async () => {
    client.setOnElicitationRequest(async () => {
      throw new Error("Listener failed");
    });

    const response = await (client as any).handleElicitationRequest(
      makeFormRequest()
    );
    assert.strictEqual(response.action, "decline");
  });

  test("should fallback to decline if listener returns void", async () => {
    client.setOnElicitationRequest(async () => {});

    const response = await (client as any).handleElicitationRequest(
      makeFormRequest()
    );
    assert.strictEqual(response.action, "decline");
  });

  test("should ignore listeners after unsubscribing", async () => {
    let called = false;
    const unsubscribe = client.setOnElicitationRequest(async () => {
      called = true;
      return { action: "accept", content: {} };
    });
    unsubscribe();

    const response = await (client as any).handleElicitationRequest(
      makeFormRequest()
    );
    assert.strictEqual(called, false);
    assert.strictEqual(response.action, "decline");
  });

  test("should broadcast completion notifications to listeners", () => {
    const received: string[] = [];
    client.setOnElicitationComplete((notification) => {
      received.push(notification.elicitationId);
    });

    client.handleElicitationComplete({ elicitationId: "url-1" });
    client.handleElicitationComplete({ elicitationId: "url-2" });

    assert.deepStrictEqual(received, ["url-1", "url-2"]);
  });
});
