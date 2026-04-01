import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
}

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
    args: ["--experimental-acp"],
  },
  {
    id: "kiro",
    name: "Kiro CLI",
    command: "kiro-cli",
    args: ["acp"],
  },
];

export function getAgent(id: string): AgentConfig | undefined {
  return AGENTS.find((a) => a.id === id);
}

export function getDefaultAgent(): AgentConfig {
  return AGENTS[0];
}

/**
 * Get common global bin paths where agents might be installed.
 */
let cachedGlobalBinPaths: string[] | null = null;

export function getGlobalBinPaths(): string[] {
  if (cachedGlobalBinPaths !== null) {
    return cachedGlobalBinPaths;
  }

  cachedGlobalBinPaths = [];

  // 1. Try to get from pnpm config or bin command
  const pnpmCommands = ["pnpm config get global-bin-dir", "pnpm bin -g"];
  for (const cmd of pnpmCommands) {
    try {
      const pnpmBin = execSync(cmd, {
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
      }).trim();
      if (pnpmBin && pnpmBin !== "undefined" && fs.existsSync(pnpmBin)) {
        if (!cachedGlobalBinPaths.includes(pnpmBin)) {
          cachedGlobalBinPaths.push(pnpmBin);
        }
      }
    } catch {}
  }

  // 2. Try to get from npm config
  try {
    const npmPrefix = execSync("npm config get prefix", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (npmPrefix && npmPrefix !== "undefined") {
      const npmBin =
        process.platform === "win32" ? npmPrefix : path.join(npmPrefix, "bin");
      if (fs.existsSync(npmBin) && !cachedGlobalBinPaths.includes(npmBin)) {
        cachedGlobalBinPaths.push(npmBin);
      }
    }
  } catch {}

  // 3. Add common fallbacks based on OS
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    const fallbacks =
      process.platform === "win32"
        ? [path.join(process.env.LOCALAPPDATA || "", "pnpm")]
        : [
            path.join(home, ".local/share/pnpm"),
            path.join(home, ".pnpm-global/bin"),
            path.join(home, ".npm-global/bin"),
            path.join(home, ".local/bin"),
            "/usr/local/bin",
          ];

    for (const p of fallbacks) {
      if (fs.existsSync(p) && !cachedGlobalBinPaths.includes(p)) {
        cachedGlobalBinPaths.push(p);
      }
    }
  }

  return cachedGlobalBinPaths;
}

/**
 * Check if a command exists on the system PATH or in common global bin directories.
 * For npx commands, we assume they're available since npx can install on demand.
 */
function isCommandAvailable(command: string): boolean {
  if (command === "npx") {
    // npx can install packages on demand, assume available if node/npm is installed
    try {
      execSync(process.platform === "win32" ? "where npx" : "which npx", {
        stdio: "ignore",
      });
      return true;
    } catch {
      // Fallback: check if npm is available
      try {
        execSync(process.platform === "win32" ? "where npm" : "which npm", {
          stdio: "ignore",
        });
        return true;
      } catch {}
    }
  }

  // 1. Try standard which/where
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    execSync(`${whichCmd} ${command}`, { stdio: "ignore" });
    return true;
  } catch {}

  // 2. Check global bin paths
  const binPaths = getGlobalBinPaths();
  for (const binPath of binPaths) {
    try {
      const isWindows = process.platform === "win32";
      const fullPath = path.join(
        binPath,
        isWindows ? `${command}.cmd` : command
      );
      if (fs.existsSync(fullPath)) return true;

      if (isWindows) {
        if (
          fs.existsSync(path.join(binPath, `${command}.exe`)) ||
          fs.existsSync(path.join(binPath, `${command}.bat`))
        ) {
          return true;
        }
      }
    } catch {}
  }

  return false;
}

/**
 * Get all agents with their availability status.
 * Caches the result for performance.
 */
let cachedAgentsWithStatus: AgentWithStatus[] | null = null;

export function getAgentsWithStatus(forceRefresh = false): AgentWithStatus[] {
  if (cachedAgentsWithStatus && !forceRefresh) {
    return cachedAgentsWithStatus;
  }

  cachedAgentsWithStatus = AGENTS.map((agent) => ({
    ...agent,
    available: isCommandAvailable(agent.command),
  }));

  return cachedAgentsWithStatus;
}

/**
 * Get the first available agent, or fall back to the default.
 */
export function getFirstAvailableAgent(): AgentConfig {
  const agents = getAgentsWithStatus();
  const available = agents.find((a) => a.available);
  return available ?? AGENTS[0];
}

export function isAgentAvailable(agentId: string): boolean {
  const agents = getAgentsWithStatus();
  const agent = agents.find((a) => a.id === agentId);
  return agent?.available ?? false;
}
