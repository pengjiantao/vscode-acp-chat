import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import type {
  McpServerConfig,
  RawMcpConfig,
  RawMcpServerConfig,
} from "./types";

/**
 * Returns the path to the user-level MCP configuration file.
 *
 * The user-level mcp.json is stored in the user's VS Code settings directory
 * and applies across all workspaces (unless overridden by workspace config).
 *
 * Path varies by operating system:
 * - Windows: %APPDATA%/Code/User/mcp.json
 * - macOS: ~/Library/Application Support/Code/User/mcp.json
 * - Linux: ~/.config/Code/User/mcp.json
 */
function getUserMcpConfigPath(): string {
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

/**
 * Resolves environment variable values, handling `${input:id}` references.
 *
 * When a server's env value contains `${input:xxx}`, it references an input
 * variable defined in the `inputs` array of mcp.json. Since we cannot prompt
 * for user input in this context, unresolved inputs are logged and the
 * corresponding env var is skipped.
 *
 * @param env - Raw environment variables from mcp.json
 * @param inputs - Map of input IDs to their resolved values (currently always empty)
 * @returns Resolved environment variables with input references replaced
 */
function resolveEnvVariables(
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
      } else {
        console.warn(
          `[MCP] Input variable "${inputId}" not resolved, skipping key "${key}"`
        );
      }
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

/**
 * Reads and parses an mcp.json file from the given URI.
 *
 * @param uri - The VS Code URI pointing to the mcp.json file
 * @returns Parsed RawMcpConfig or null if the file doesn't exist
 */
async function readMcpJsonFile(uri: vscode.Uri): Promise<RawMcpConfig | null> {
  try {
    const content = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder().decode(content);
    return JSON.parse(text) as RawMcpConfig;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error as vscode.FileSystemError).code === "FileNotFound"
    ) {
      return null;
    }
    console.warn(`[MCP] Failed to read mcp.json from ${uri.fsPath}:`, error);
    return null;
  }
}

/**
 * Parses a raw server config into a normalized McpServerConfig.
 *
 * Validates the server configuration. For stdio type, command is required.
 * For http/sse types, url is required. Returns null if validation fails.
 *
 * @param name - Server name from mcp.json
 * @param server - Raw server configuration
 * @param inputs - Map of input IDs to resolved values
 * @returns Normalized config or null if the server should be skipped
 */
function parseMcpServerConfig(
  name: string,
  server: RawMcpServerConfig,
  inputs: Map<string, string>
): McpServerConfig | null {
  if (server.type === "http" || server.type === "sse") {
    if (!server.url) {
      console.warn(
        `[MCP] Server "${name}" uses ${server.type} transport but is missing "url" field, skipping.`
      );
      return null;
    }
  } else {
    if (!server.command) {
      console.warn(
        `[MCP] Server "${name}" is missing "command" field, skipping.`
      );
      return null;
    }
  }

  const resolvedEnv = resolveEnvVariables(server.env, inputs);

  return {
    name,
    command: server.command ?? "",
    args: server.args || [],
    env: Object.entries(resolvedEnv).map(([name, value]) => ({ name, value })),
    cwd: server.cwd,
    type: server.type ?? "stdio",
    url: server.url,
    headers: server.headers,
  };
}

/**
 * Loads MCP server configurations from both workspace and user-level mcp.json files.
 *
 * This function reads both the workspace's `.vscode/mcp.json` and the user-level
 * mcp.json, merging them with workspace config taking precedence. The configurations
 * are normalized and validated before being returned.
 *
 * Note: Input variables (`${input:xxx}`) cannot be resolved automatically as they
 * require user interaction. Servers that depend on unresolved inputs will have those
 * environment variables skipped.
 *
 * @returns Array of normalized MCP server configurations ready for ACP protocol
 */
export async function getMcpServerConfigs(): Promise<McpServerConfig[]> {
  const configs: McpServerConfig[] = [];
  const inputs = new Map<string, string>();

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const workspaceMcpPath = workspaceFolder
    ? path.join(workspaceFolder.uri.fsPath, ".vscode", "mcp.json")
    : null;
  const userMcpPath = getUserMcpConfigPath();

  const urisToCheck: Array<{ uri: vscode.Uri | null; label: string }> = [
    {
      uri: workspaceMcpPath ? vscode.Uri.file(workspaceMcpPath) : null,
      label: "workspace",
    },
    { uri: vscode.Uri.file(userMcpPath), label: "user" },
  ];

  for (const { uri, label } of urisToCheck) {
    if (!uri) continue;

    const rawConfig = await readMcpJsonFile(uri);
    if (!rawConfig) continue;

    if (rawConfig.inputs) {
      for (const input of rawConfig.inputs) {
        if (input.type === "promptString" && input.id) {
          console.warn(
            `[MCP] Input "${input.id}" requires user interaction (${input.description}). This cannot be resolved automatically.`
          );
        }
      }
    }

    if (rawConfig.servers) {
      for (const [name, server] of Object.entries(rawConfig.servers)) {
        const config = parseMcpServerConfig(name, server, inputs);
        if (config) {
          configs.push(config);
        }
      }
    }

    console.log(
      `[MCP] Loaded ${configs.length} server(s) from ${label} mcp.json`
    );
  }

  return configs;
}

/**
 * Returns the file paths for workspace and user-level MCP configuration files.
 *
 * This is useful for debugging or displaying configuration locations to users.
 *
 * @returns Object containing workspace and user mcp.json paths
 */
export function getMcpConfigPaths(): {
  workspace: string | null;
  user: string;
} {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const workspaceMcpPath = workspaceFolder
    ? path.join(workspaceFolder.uri.fsPath, ".vscode", "mcp.json")
    : null;
  return {
    workspace: workspaceMcpPath,
    user: getUserMcpConfigPath(),
  };
}
