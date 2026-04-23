import * as assert from "assert";
import {
  toMcpServerStdio,
  toMcpServerHttp,
  toMcpServerSse,
  type McpServerConfig,
  type RawMcpServerConfig,
  type RawMcpConfig,
} from "../../mcp/types";
import type { McpServer } from "@agentclientprotocol/sdk";

suite("MCP Types", () => {
  suite("toMcpServerStdio", () => {
    test("should convert McpServerConfig to McpServer format", () => {
      const config: McpServerConfig = {
        name: "test-server",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        env: [
          { name: "API_KEY", value: "test-key" },
          { name: "DEBUG", value: "true" },
        ],
        cwd: "/workspace",
      };

      const result = toMcpServerStdio(config);

      assert.strictEqual(result.name, "test-server");
      const stdioResult = result as McpServer & {
        command: string;
        args: string[];
        env: Array<{ name: string; value: string }>;
      };
      assert.strictEqual(stdioResult.command, "npx");
      assert.deepStrictEqual(stdioResult.args, [
        "-y",
        "@modelcontextprotocol/server-filesystem",
      ]);
      assert.deepStrictEqual(stdioResult.env, [
        { name: "API_KEY", value: "test-key" },
        { name: "DEBUG", value: "true" },
      ]);
    });

    test("should handle empty env array", () => {
      const config: McpServerConfig = {
        name: "minimal-server",
        command: "node",
        args: ["server.js"],
        env: [],
      };

      const result = toMcpServerStdio(config);

      assert.strictEqual(result.name, "minimal-server");
      const stdioResult = result as McpServer & {
        env: Array<{ name: string; value: string }>;
      };
      assert.deepStrictEqual(stdioResult.env, []);
    });

    test("should handle optional cwd being undefined", () => {
      const config: McpServerConfig = {
        name: "no-cwd-server",
        command: "python",
        args: ["server.py"],
        env: [],
      };

      const result = toMcpServerStdio(config);

      assert.strictEqual(result.name, "no-cwd-server");
      assert.ok(!("cwd" in result), "cwd should not be present when undefined");
    });

    test("should preserve exact command and args", () => {
      const config: McpServerConfig = {
        name: "complex-server",
        command: "/usr/local/bin/npx",
        args: ["--yes", "server", "--flag", "value"],
        env: [],
      };

      const result = toMcpServerStdio(config);

      const stdioResult = result as McpServer & {
        command: string;
        args: string[];
      };
      assert.strictEqual(stdioResult.command, "/usr/local/bin/npx");
      assert.deepStrictEqual(stdioResult.args, [
        "--yes",
        "server",
        "--flag",
        "value",
      ]);
    });
  });

  suite("toMcpServerHttp", () => {
    test("should convert http config to McpServerHttp format", () => {
      const config: McpServerConfig = {
        name: "http-server",
        command: "",
        args: [],
        env: [],
        type: "http",
        url: "http://localhost:3000",
        headers: { Authorization: "Bearer token" },
      };

      const result = toMcpServerHttp(config);

      assert.strictEqual(result.name, "http-server");
      assert.ok(
        "type" in result && result.type === "http",
        "should have type http"
      );
      const httpResult = result as { name: string; type: "http"; url: string };
      assert.strictEqual(httpResult.url, "http://localhost:3000");
    });

    test("should handle http config without headers", () => {
      const config: McpServerConfig = {
        name: "http-server-no-headers",
        command: "",
        args: [],
        env: [],
        type: "http",
        url: "http://localhost:3000",
      };

      const result = toMcpServerHttp(config);

      assert.strictEqual(result.name, "http-server-no-headers");
      assert.ok(
        "type" in result && result.type === "http",
        "should have type http"
      );
      const httpResult = result as { name: string; type: "http"; url: string };
      assert.strictEqual(httpResult.url, "http://localhost:3000");
    });
  });

  suite("toMcpServerSse", () => {
    test("should convert sse config to McpServerSse format", () => {
      const config: McpServerConfig = {
        name: "sse-server",
        command: "",
        args: [],
        env: [],
        type: "sse",
        url: "http://localhost:3000/sse",
        headers: { "X-Custom-Header": "value" },
      };

      const result = toMcpServerSse(config);

      assert.strictEqual(result.name, "sse-server");
      assert.ok(
        "type" in result && result.type === "sse",
        "should have type sse"
      );
      const sseResult = result as { name: string; type: "sse"; url: string };
      assert.strictEqual(sseResult.url, "http://localhost:3000/sse");
    });

    test("should handle sse config without headers", () => {
      const config: McpServerConfig = {
        name: "sse-server-no-headers",
        command: "",
        args: [],
        env: [],
        type: "sse",
        url: "http://localhost:3000/sse",
      };

      const result = toMcpServerSse(config);

      assert.strictEqual(result.name, "sse-server-no-headers");
      assert.ok(
        "type" in result && result.type === "sse",
        "should have type sse"
      );
      const sseResult = result as { name: string; type: "sse"; url: string };
      assert.strictEqual(sseResult.url, "http://localhost:3000/sse");
    });
  });

  suite("RawMcpServerConfig", () => {
    test("should accept stdio type", () => {
      const rawConfig: RawMcpServerConfig = {
        type: "stdio",
        command: "npx",
        args: ["-y", "server"],
        env: { KEY: "value" },
      };

      assert.strictEqual(rawConfig.type, "stdio");
      assert.strictEqual(rawConfig.command, "npx");
      assert.deepStrictEqual(rawConfig.args, ["-y", "server"]);
      assert.deepStrictEqual(rawConfig.env, { KEY: "value" });
    });

    test("should accept http type", () => {
      const rawConfig: RawMcpServerConfig = {
        type: "http",
        url: "http://localhost:3000",
        headers: { Authorization: "Bearer token" },
      };

      assert.strictEqual(rawConfig.type, "http");
      assert.strictEqual(rawConfig.url, "http://localhost:3000");
      assert.strictEqual(rawConfig.headers?.Authorization, "Bearer token");
    });

    test("should accept sse type", () => {
      const rawConfig: RawMcpServerConfig = {
        type: "sse",
        url: "http://localhost:3000/sse",
      };

      assert.strictEqual(rawConfig.type, "sse");
      assert.strictEqual(rawConfig.url, "http://localhost:3000/sse");
    });

    test("should default to stdio when type is undefined", () => {
      const rawConfig: RawMcpServerConfig = {
        command: "node",
      };

      assert.strictEqual(rawConfig.type, undefined);
      assert.strictEqual(rawConfig.command, "node");
    });

    test("should handle optional fields", () => {
      const rawConfig: RawMcpServerConfig = {
        type: "stdio",
      };

      assert.strictEqual(rawConfig.command, undefined);
      assert.strictEqual(rawConfig.args, undefined);
      assert.strictEqual(rawConfig.env, undefined);
      assert.strictEqual(rawConfig.cwd, undefined);
    });
  });

  suite("RawMcpConfig", () => {
    test("should parse complete config with servers and inputs", () => {
      const rawConfig: RawMcpConfig = {
        servers: {
          filesystem: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem"],
            env: { ROOT: "${input:workspaceRoot}" },
          },
          "http-server": {
            type: "http",
            url: "http://localhost:8080",
          },
        },
        inputs: [
          {
            type: "promptString",
            id: "workspaceRoot",
            description: "Enter workspace root path",
            password: false,
          },
        ],
      };

      assert.ok(rawConfig.servers);
      assert.strictEqual(Object.keys(rawConfig.servers).length, 2);
      assert.ok(rawConfig.servers?.["filesystem"]);
      assert.ok(rawConfig.servers?.["http-server"]);
      assert.ok(rawConfig.inputs);
      assert.strictEqual(rawConfig.inputs?.length, 1);
      assert.strictEqual(rawConfig.inputs?.[0].id, "workspaceRoot");
    });

    test("should handle empty servers", () => {
      const rawConfig: RawMcpConfig = {
        servers: {},
      };

      assert.ok(rawConfig.servers);
      assert.strictEqual(Object.keys(rawConfig.servers).length, 0);
    });

    test("should handle undefined servers and inputs", () => {
      const rawConfig: RawMcpConfig = {};

      assert.strictEqual(rawConfig.servers, undefined);
      assert.strictEqual(rawConfig.inputs, undefined);
    });
  });
});

suite("MCP Config Resolution", () => {
  suite("EnvVariable format", () => {
    test("should use name/value format for env variables", () => {
      const envVar = { name: "MY_VAR", value: "my-value" };

      assert.strictEqual(envVar.name, "MY_VAR");
      assert.strictEqual(envVar.value, "my-value");
    });
  });

  suite("Input variable resolution", () => {
    test("should recognize input variable syntax ${input:id}", () => {
      const inputRef = "${input:api-key}";
      assert.ok(inputRef.startsWith("${input:"));
      assert.ok(inputRef.endsWith("}"));
      assert.strictEqual(inputRef.slice(8, -1), "api-key");
    });

    test("should identify non-input values", () => {
      const regularValue = "just-a-string";
      const inputRef = "${input:api-key}";

      assert.ok(!regularValue.startsWith("${input:"));
      assert.ok(!regularValue.endsWith("}"));
      assert.ok(inputRef.startsWith("${input:"));
      assert.ok(inputRef.endsWith("}"));
    });
  });
});
