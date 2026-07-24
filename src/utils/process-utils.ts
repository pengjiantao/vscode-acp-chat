import { ChildProcess, spawn } from "child_process";

/**
 * Default environment variables injected when executing `npx` commands
 * to prevent indefinite network hanging and reduce unnecessary update checks.
 */
export const DEFAULT_NPX_ENV: Record<string, string> = {
  NPM_CONFIG_FETCH_TIMEOUT: "10000",
  NPM_CONFIG_FETCH_RETRY_MAINTIMEOUT: "5000",
  NPM_CONFIG_FETCH_RETRIES: "1",
  NO_UPDATE_NOTIFIER: "1",
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
};

/**
 * Forcefully kills a process and its entire child process tree.
 * On Windows: Uses `taskkill /pid <PID> /t /f` to recursively terminate the process tree.
 * On POSIX: Sends signal to the process group (`-pid`) if detached, falling back to `proc.kill(signal)`.
 */
export function killProcessTree(
  proc: ChildProcess | ReturnType<typeof spawn>,
  signal: NodeJS.Signals = "SIGKILL"
): void {
  const pid = proc.pid;
  if (pid === undefined) {
    try {
      proc.kill(signal);
    } catch {}
    return;
  }

  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => {
        try {
          proc.kill(signal);
        } catch {}
      });
    } catch {
      try {
        proc.kill(signal);
      } catch {}
    }
    return;
  }

  // POSIX: try killing the detached process group (-pid)
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      proc.kill(signal);
    } catch {}
  }
}
