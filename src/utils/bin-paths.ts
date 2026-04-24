import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

/**
 * Returns an array of global bin directory paths where CLI tools may be installed.
 * Results are cached after first calculation.
 *
 * Scans for bin paths in the following order:
 * 1. pnpm global bin directories (via `pnpm config get global-bin-dir` or `pnpm bin -g`)
 * 2. npm global bin directory (via `npm config get prefix`)
 * 3. Common fallback paths based on OS (pnpm, npm-global, ~/.local/bin, /usr/local/bin)
 */
let cachedGlobalBinPaths: string[] | null = null;

/**
 * Computes and caches global bin directory paths by querying pnpm/npm configs
 * and adding OS-specific fallback directories.
 */
export function getGlobalBinPaths(): string[] {
  // Return cached result if already computed
  if (cachedGlobalBinPaths !== null) {
    return cachedGlobalBinPaths;
  }

  cachedGlobalBinPaths = [];

  // Step 1: Query pnpm global bin directory
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

  // Step 2: Query npm global bin directory
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

  // Step 3: Add OS-specific fallback paths
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
 * Checks if a command is available on the system.
 * First checks PATH via `which`/`where`, then falls back to global bin directories.
 * Special handling for npx (can install on demand) and absolute paths.
 * @param command - The command name or absolute path to check.
 */
export function isCommandAvailable(command: string): boolean {
  // npx can install packages on demand, assume available if node/npm is installed
  if (command === "npx") {
    try {
      execSync(process.platform === "win32" ? "where npx" : "which npx", {
        stdio: "ignore",
      });
      return true;
    } catch {
      try {
        execSync(process.platform === "win32" ? "where npm" : "which npm", {
          stdio: "ignore",
        });
        return true;
      } catch {}
    }
  }

  // Absolute paths - just check if file exists
  if (path.isAbsolute(command)) {
    return fs.existsSync(command);
  }

  // Check standard PATH using which/where
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    execSync(`${whichCmd} ${command}`, { stdio: "ignore" });
    return true;
  } catch {}

  // Check in known global bin directories
  const binPaths = getGlobalBinPaths();
  for (const binPath of binPaths) {
    try {
      const isWindows = process.platform === "win32";
      // Try with .cmd extension on Windows (npm/npx wrapper scripts)
      const fullPath = path.join(
        binPath,
        isWindows ? `${command}.cmd` : command
      );
      if (fs.existsSync(fullPath)) return true;

      // On Windows, also check .exe and .bat extensions
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
