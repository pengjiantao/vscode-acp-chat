import type { McpServer, EnvVariable } from "@agentclientprotocol/sdk";

/**
 * Normalized MCP server configuration used by the ACP client.
 *
 * This represents a stdio-based MCP server that will be passed to agents
 * via the ACP `mcpServers` parameter in `newSession`/`loadSession` requests.
 */
export interface McpServerConfig {
  /** Human-readable name identifying this MCP server. */
  name: string;
  /** Path to the MCP server executable. */
  command: string;
  /** Command-line arguments to pass to the MCP server. */
  args: string[];
  /** Environment variables to set when launching the MCP server. */
  env: EnvVariable[];
  /** Optional working directory for the MCP server process. */
  cwd?: string;
}

/**
 * Raw MCP server configuration as parsed from mcp.json.
 *
 * This mirrors the structure defined in VS Code's MCP configuration schema,
 * supporting both stdio and HTTP/SSE transport types.
 */
export interface RawMcpServerConfig {
  /** Transport type. Defaults to "stdio" if omitted. */
  type?: "stdio" | "http" | "sse";
  /** Path to the MCP server executable (for stdio type). */
  command?: string;
  /** Command-line arguments (for stdio type). */
  args?: string[];
  /** Environment variables as key-value pairs. */
  env?: Record<string, string>;
  /** Working directory (for stdio type). */
  cwd?: string;
  /** URL to the MCP server (for http/sse types). */
  url?: string;
  /** HTTP headers (for http/sse types). */
  headers?: Record<string, string>;
}

/**
 * Input variable definition from mcp.json.
 *
 * Input variables allow users to define secrets or configuration values
 * that are prompted for when connecting to MCP servers. They are referenced
 * in server env values using `${input:id}` syntax.
 *
 * @example
 * ```json
 * {
 *   "inputs": [
 *     { "type": "promptString", "id": "api-key", "description": "Enter API Key", "password": true }
 *   ],
 *   "servers": {
 *     "myServer": {
 *       "command": "npx",
 *       "args": ["-y", "server"],
 *       "env": { "API_KEY": "${input:api-key}" }
 *     }
 *   }
 * }
 * ```
 */
export interface RawMcpInput {
  /** Input type. Currently only "promptString" is supported. */
  type: "promptString";
  /** Unique identifier for referencing this input via `${input:id}`. */
  id: string;
  /** User-friendly description shown when prompting for input. */
  description: string;
  /** If true, the input should be treated as a secret (e.g., password field). */
  password?: boolean;
}

/**
 * Raw MCP configuration as parsed from mcp.json.
 *
 * This is the top-level structure defined in VS Code's MCP configuration file.
 */
export interface RawMcpConfig {
  /** Map of server name to server configuration. */
  servers?: Record<string, RawMcpServerConfig>;
  /** Array of input variable definitions for prompting user values. */
  inputs?: RawMcpInput[];
}

/**
 * Converts a normalized McpServerConfig to the ACP protocol McpServer type.
 *
 * This is used when passing MCP server configurations to agents via the
 * ACP `newSession` or `loadSession` requests.
 *
 * @param config - The normalized MCP server configuration
 * @returns McpServer object compatible with ACP protocol
 */
export function toMcpServerStdio(config: McpServerConfig): McpServer {
  return {
    name: config.name,
    command: config.command,
    args: config.args,
    env: config.env,
  };
}
