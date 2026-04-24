import * as vscode from "vscode";
import type { AgentConfig } from "./agents";

/**
 * Result of agent configuration validation.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Represents an agent with its validation error.
 */
export interface InvalidAgent {
  agent: AgentConfig;
  error: string;
}

/**
 * Validates a single agent configuration.
 * Checks that all required fields are present and have correct types.
 */
export function validateAgent(agent: AgentConfig): ValidationResult {
  if (!agent.id || typeof agent.id !== "string") {
    return { valid: false, error: "Agent id is required and must be a string" };
  }

  if (!agent.name || typeof agent.name !== "string") {
    return {
      valid: false,
      error: "Agent name is required and must be a string",
    };
  }

  if (!agent.command || typeof agent.command !== "string") {
    return {
      valid: false,
      error: "Agent command is required and must be a string",
    };
  }

  if (!Array.isArray(agent.args)) {
    return { valid: false, error: "Agent args must be an array" };
  }

  for (const arg of agent.args) {
    if (typeof arg !== "string") {
      return { valid: false, error: "Agent args must be strings" };
    }
  }

  if (
    agent.env !== undefined &&
    (typeof agent.env !== "object" || agent.env === null)
  ) {
    return { valid: false, error: "Agent env must be an object or undefined" };
  }

  if (agent.env) {
    for (const [key, value] of Object.entries(agent.env)) {
      if (typeof key !== "string" || typeof value !== "string") {
        return {
          valid: false,
          error: "Agent env keys and values must be strings",
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Validates multiple agents and returns a list of invalid ones.
 */
export function validateAgents(agents: AgentConfig[]): InvalidAgent[] {
  const invalidAgents: InvalidAgent[] = [];

  for (const agent of agents) {
    const result = validateAgent(agent);
    if (!result.valid) {
      invalidAgents.push({ agent, error: result.error || "Unknown error" });
    }
  }

  return invalidAgents;
}

/**
 * Shows a VS Code warning message listing all invalid agent configurations.
 */
export async function showValidationWarnings(
  invalidAgents: InvalidAgent[]
): Promise<void> {
  if (invalidAgents.length === 0) {
    return;
  }

  const messages = invalidAgents.map(
    (item) => `• ${item.agent.name || item.agent.id}: ${item.error}`
  );

  const fullMessage =
    messages.length === 1
      ? `Invalid custom agent configuration:\n${messages[0]}`
      : `Invalid custom agent configurations (${invalidAgents.length}):\n${messages.join("\n")}`;

  await vscode.window.showWarningMessage(fullMessage);
}
