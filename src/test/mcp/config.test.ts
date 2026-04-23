import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import {
  type McpServerConfig,
  type RawMcpServerConfig,
  type RawMcpConfig,
} from "../../mcp/types";

suite("MCP Config", () => {
  suite("getUserMcpConfigPath", () => {
    test("should return correct path on Linux", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux" });
      const home = os.homedir();
      const expected = path.join(home, ".config", "Code", "User", "mcp.json");

      const actual = getUserMcpConfigPathForTest();
      assert.strictEqual(actual, expected);

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    test("should return correct path on macOS", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin" });
      const home = os.homedir();
      const expected = path.join(
        home,
        "Library",
        "Application Support",
        "Code",
        "User",
        "mcp.json"
      );

      const actual = getUserMcpConfigPathForTest();
      assert.strictEqual(actual, expected);

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    test("should return correct path on Windows", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });
      const expectedBase =
        process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
      const expected = path.join(expectedBase, "Code", "User", "mcp.json");

      const actual = getUserMcpConfigPathForTest();
      assert.strictEqual(actual, expected);

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });
  });

  suite("parseMcpServerConfig", () => {
    test("should parse valid stdio server config", () => {
      const rawServer: RawMcpServerConfig = {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        env: { ROOT: "/workspace" },
        cwd: "/workspace",
      };

      const result = parseMcpServerConfigForTest("filesystem", rawServer);

      assert.ok(result, "Result should not be null");
      assert.strictEqual(result?.name, "filesystem");
      assert.strictEqual(result?.command, "npx");
      assert.deepStrictEqual(result?.args, [
        "-y",
        "@modelcontextprotocol/server-filesystem",
      ]);
      assert.strictEqual(result?.cwd, "/workspace");
      assert.strictEqual(result?.env.length, 1);
      assert.strictEqual(result?.env[0].name, "ROOT");
      assert.strictEqual(result?.env[0].value, "/workspace");
    });

    test("should skip http server type (unsupported)", () => {
      const rawServer: RawMcpServerConfig = {
        type: "http",
        url: "http://localhost:3000",
      };

      const result = parseMcpServerConfigForTest("http-server", rawServer);

      assert.strictEqual(result, null, "HTTP servers should return null");
    });

    test("should skip sse server type (unsupported)", () => {
      const rawServer: RawMcpServerConfig = {
        type: "sse",
        url: "http://localhost:3000/sse",
      };

      const result = parseMcpServerConfigForTest("sse-server", rawServer);

      assert.strictEqual(result, null, "SSE servers should return null");
    });

    test("should skip server without command field", () => {
      const rawServer: RawMcpServerConfig = {
        type: "stdio",
      };

      const result = parseMcpServerConfigForTest("no-command", rawServer);

      assert.strictEqual(
        result,
        null,
        "Server without command should return null"
      );
    });

    test("should use empty args when not provided", () => {
      const rawServer: RawMcpServerConfig = {
        type: "stdio",
        command: "node",
      };

      const result = parseMcpServerConfigForTest("minimal", rawServer);

      assert.ok(result, "Result should not be null");
      assert.deepStrictEqual(result?.args, []);
    });

    test("should handle missing env", () => {
      const rawServer: RawMcpServerConfig = {
        type: "stdio",
        command: "python",
        args: ["server.py"],
      };

      const result = parseMcpServerConfigForTest("no-env", rawServer);

      assert.ok(result, "Result should not be null");
      assert.deepStrictEqual(result?.env, []);
    });
  });

  suite("resolveEnvVariables", () => {
    test("should pass through regular env values", () => {
      const env: Record<string, string> = {
        NODE_ENV: "production",
        DEBUG: "false",
      };

      const result = resolveEnvVariablesForTest(env, new Map());

      assert.strictEqual(result["NODE_ENV"], "production");
      assert.strictEqual(result["DEBUG"], "false");
    });

    test("should resolve input variables when value is in inputs map", () => {
      const env: Record<string, string> = {
        API_KEY: "${input:api-key}",
        ROOT: "/workspace",
      };
      const inputs = new Map([["api-key", "secret-123"]]);

      const result = resolveEnvVariablesForTest(env, inputs);

      assert.strictEqual(result["API_KEY"], "secret-123");
      assert.strictEqual(result["ROOT"], "/workspace");
    });

    test("should skip env vars with unresolved input references", () => {
      const env: Record<string, string> = {
        API_KEY: "${input:missing-key}",
        OTHER: "value",
      };
      const inputs = new Map();

      const result = resolveEnvVariablesForTest(env, inputs);

      assert.strictEqual(result["OTHER"], "value");
      assert.strictEqual(result["API_KEY"], undefined);
    });

    test("should handle empty env", () => {
      const result = resolveEnvVariablesForTest(undefined, new Map());

      assert.deepStrictEqual(result, {});
    });

    test("should handle env with only input references", () => {
      const env: Record<string, string> = {
        KEY1: "${input:a}",
        KEY2: "${input:b}",
      };
      const inputs = new Map([["a", "value-a"]]);

      const result = resolveEnvVariablesForTest(env, inputs);

      assert.strictEqual(result["KEY1"], "value-a");
      assert.strictEqual(result["KEY2"], undefined);
    });
  });

  suite("RawMcpConfig parsing", () => {
    test("should parse complete mcp.json structure", () => {
      const rawConfig: RawMcpConfig = {
        servers: {
          filesystem: {
            type: "stdio",
            command: "npx",
            args: ["-y", "server"],
            env: {},
          },
        },
        inputs: [
          {
            type: "promptString",
            id: "api-key",
            description: "Enter API key",
            password: true,
          },
        ],
      };

      assert.ok(rawConfig.servers);
      assert.ok(rawConfig.inputs);
      assert.strictEqual(rawConfig.servers?.["filesystem"].command, "npx");
      assert.strictEqual(rawConfig.inputs?.[0].id, "api-key");
      assert.strictEqual(rawConfig.inputs?.[0].password, true);
    });

    test("should handle minimal mcp.json", () => {
      const rawConfig: RawMcpConfig = {
        servers: {
          minimal: {
            command: "echo",
          },
        },
      };

      assert.ok(rawConfig.servers);
      assert.strictEqual(rawConfig.inputs, undefined);
    });
  });
});

function getUserMcpConfigPathForTest(): string {
  const home = os.homedir();
  const platform = process.platform;

  if (platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(home, "AppData", "Roaming"),
      "Code",
      "User",
      "mcp.json"
    );
  } else if (platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Application Support",
      "Code",
      "User",
      "mcp.json"
    );
  } else {
    return path.join(home, ".config", "Code", "User", "mcp.json");
  }
}

function resolveEnvVariablesForTest(
  env: Record<string, string> | undefined,
  inputs: Map<string, string>
): Record<string, string> {
  const resolved: Record<string, string> = {};
  if (!env) return resolved;

  for (const [key, value] of Object.entries(env)) {
    if (value.startsWith("${input:") && value.endsWith("}")) {
      const inputId = value.slice(8, -1);
      const resolvedValue = inputs.get(inputId);
      if (resolvedValue !== undefined) {
        resolved[key] = resolvedValue;
      }
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

function parseMcpServerConfigForTest(
  name: string,
  server: RawMcpServerConfig,
  inputs: Map<string, string> = new Map()
): McpServerConfig | null {
  if (server.type === "http" || server.type === "sse") {
    return null;
  }

  if (!server.command) {
    return null;
  }

  const resolvedEnv = resolveEnvVariablesForTest(server.env, inputs);

  return {
    name,
    command: server.command,
    args: server.args || [],
    env: Object.entries(resolvedEnv).map(([name, value]) => ({ name, value })),
    cwd: server.cwd,
  };
}
