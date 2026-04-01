import * as assert from "assert";
import { Mention } from "../views/webview/main";

/**
 * Since it's hard to mock the full WebviewController in a simple Node test
 * due to DOM dependencies, we'll verify the data structures and
 * formatting logic in ACPClient.
 */
import { ACPClient } from "../acp/client";

suite("Mentions Logic", () => {
  test("ACPClient formats different mention types correctly", async () => {
    // We can't easily connect to a real server, but we can test the sendMessage prompt building
    // by mocking the connection.
    const client = new ACPClient({ skipAvailabilityCheck: true } as any);
    (client as any).connection = {
      prompt: async (params: any) => {
        return params; // Return params to verify them
      },
    };
    (client as any).currentSessionId = "test-session";

    const mentions: Mention[] = [
      { name: "file.ts", path: "/path/file.ts", type: "file" },
      {
        name: "file.ts:1-5",
        path: "/path/file.ts",
        type: "selection",
        content: "const x = 1;",
        range: { startLine: 1, endLine: 5 },
      },
      {
        name: "Terminal",
        type: "terminal",
        content: "error: fail",
      },
    ];

    const result = await client.sendMessage("my message", [], mentions as any);
    const prompt = (result as any).prompt;

    assert.strictEqual(prompt[0].text, "my message");

    const contextText = prompt[1].text;
    assert.ok(contextText.includes("Context - Referenced Items:"));
    assert.ok(
      contextText.includes("[Referenced File: file.ts at /path/file.ts]")
    );
    assert.ok(contextText.includes("[Code Selection from file.ts:1-5]:"));
    assert.ok(contextText.includes("const x = 1;"));
    assert.ok(contextText.includes("[Terminal Selection (Terminal)]:"));
    assert.ok(contextText.includes("error: fail"));
  });
});
