import * as vscode from "vscode";
import { validateAgents, showValidationWarnings } from "./agent-validator";
import { isCommandAvailable } from "../utils/bin-paths";

/**
 * Configuration for an agent executable.
 * Represents the structure needed to launch an AI agent via CLI.
 */
export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Agent configuration with an additional availability status.
 */
export interface AgentWithStatus extends AgentConfig {
  available: boolean;
}

export const AGENTS: AgentConfig[] = [
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    args: ["acp"],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    command: "npx",
    args: ["@zed-industries/claude-code-acp"],
  },
  {
    id: "codex",
    name: "Codex CLI",
    command: "npx",
    args: ["@zed-industries/codex-acp"],
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    command: "gemini",
    args: ["--acp"],
  },
  {
    id: "goose",
    name: "Goose",
    command: "goose",
    args: ["acp"],
  },
  {
    id: "amp",
    name: "Amp",
    command: "amp",
    args: ["acp"],
  },
  {
    id: "aider",
    name: "Aider",
    command: "aider",
    args: ["--acp"],
  },
  {
    id: "augment",
    name: "Augment Code",
    command: "augment",
    args: ["acp"],
  },
  {
    id: "kimi",
    name: "Kimi CLI",
    command: "kimi",
    args: ["--acp"],
  },
  {
    id: "mistral-vibe",
    name: "Mistral Vibe",
    command: "vibe",
    args: ["acp"],
  },
  {
    id: "openhands",
    name: "OpenHands",
    command: "openhands",
    args: ["acp"],
  },
  {
    id: "qwen-code",
    name: "Qwen Code",
    command: "qwen",
    args: ["--acp"],
  },
  {
    id: "kiro",
    name: "Kiro CLI",
    command: "kiro-cli",
    args: ["acp"],
  },
  {
    id: "cursor",
    name: "Cursor",
    command: "cursor-agent",
    args: ["acp"],
  },
];

/**
 * Retrieves custom agents from VS Code workspace configuration.
 */
function getCustomAgents(): AgentConfig[] {
  const config = vscode.workspace.getConfiguration("vscode-acp-chat");
  return config.get<AgentConfig[]>("customAgents", []);
}

/**
 * Merges built-in agents with custom agents from configuration.
 * Custom agents override built-in ones with the same id.
 */
function getMergedAgents(): AgentConfig[] {
  const customAgents = getCustomAgents();
  const builtinIds = new Set(AGENTS.map((a) => a.id));

  const merged: AgentConfig[] = AGENTS.map((builtin) => {
    const custom = customAgents.find((c) => c.id === builtin.id);
    return custom ?? builtin;
  });

  for (const custom of customAgents) {
    if (!builtinIds.has(custom.id)) {
      merged.push(custom);
    }
  }

  return merged;
}

/**
 * Gets all agents with their availability status.
 * Caches the result for performance. Filters out invalid agents and shows warnings.
 * @param forceRefresh - If true, bypasses the cache and revalidates all agents.
 */
let cachedAgentsWithStatus: AgentWithStatus[] | null = null;

/**
 * Gets all agents merged from built-in and custom configurations with availability status.
 * Results are cached. Invalid agents are filtered out and warnings are shown.
 * @param forceRefresh - If true, bypasses cache and revalidates all agents.
 */
export function getAgentsWithStatus(forceRefresh = false): AgentWithStatus[] {
  if (cachedAgentsWithStatus && !forceRefresh) {
    return cachedAgentsWithStatus;
  }

  const mergedAgents = getMergedAgents();
  const invalidAgents = validateAgents(mergedAgents);

  if (invalidAgents.length > 0) {
    showValidationWarnings(invalidAgents).catch((err) => {
      console.error("[Agents] Failed to show validation warnings:", err);
    });
  }

  const invalidAgentIds = new Set(invalidAgents.map((a) => a.agent.id));
  cachedAgentsWithStatus = mergedAgents
    .filter((agent) => !invalidAgentIds.has(agent.id))
    .map((agent) => ({
      ...agent,
      available: isCommandAvailable(agent.command),
    }));

  return cachedAgentsWithStatus;
}

/**
 * Gets the first available agent, or falls back to the default (first merged agent).
 */
export function getFirstAvailableAgent(): AgentConfig {
  const agents = getAgentsWithStatus();
  const available = agents.find((a) => a.available);
  return available ?? getMergedAgents()[0];
}

/**
 * Retrieves an agent by its id from the merged agent list.
 */
export function getAgent(id: string): AgentConfig | undefined {
  const agents = getAgentsWithStatus();
  return agents.find((a) => a.id === id);
}

/**
 * Checks if an agent is available by verifying its command exists.
 */
export function isAgentAvailable(agentId: string): boolean {
  const agents = getAgentsWithStatus();
  const agent = agents.find((a) => a.id === agentId);
  return agent?.available ?? false;
}
