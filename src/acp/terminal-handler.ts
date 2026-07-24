import * as vscode from "vscode";
import { spawn } from "child_process";
import { killProcessTree } from "../utils/process-utils";
import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
} from "@agentclientprotocol/sdk";

const FORCE_KILL_DELAY_MS = 1000;

interface ManagedTerminal {
  id: string;
  proc: ReturnType<typeof spawn> | null;
  output: string;
  outputByteLimit: number | null;
  truncated: boolean;
  // Keep completion separate from exitCode because signal termination reports a null code.
  hasExited: boolean;
  exitCode: number | null;
  signal: string | null;
  forceKillTimer: NodeJS.Timeout | null;
  exitPromise: Promise<void>;
  exitResolve: () => void;
}

export class TerminalHandler {
  private terminals: Map<string, ManagedTerminal> = new Map();
  private terminalCounter = 0;

  async handleCreateTerminal(
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse> {
    const terminalId = `term-${++this.terminalCounter}-${Date.now()}`;

    let exitResolve: () => void = () => {};
    const exitPromise = new Promise<void>((resolve) => {
      exitResolve = resolve;
    });

    const managedTerminal: ManagedTerminal = {
      id: terminalId,
      proc: null,
      output: "",
      outputByteLimit: params.outputByteLimit ?? null,
      truncated: false,
      hasExited: false,
      exitCode: null,
      signal: null,
      forceKillTimer: null,
      exitPromise,
      exitResolve,
    };

    const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const cwd =
      params.cwd && params.cwd.trim() !== ""
        ? params.cwd
        : workspaceCwd ||
          process.env.HOME ||
          process.env.USERPROFILE ||
          process.cwd();

    const proc = spawn(params.command, params.args || [], {
      cwd,
      env: {
        ...process.env,
        ...(params.env?.reduce(
          (acc, e) => ({ ...acc, [e.name]: e.value }),
          {}
        ) || {}),
      },
      shell: true,
      // On POSIX this creates a process group, so shell-wrapped commands and
      // their children can be terminated together via a negative PID.
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    managedTerminal.proc = proc;

    proc.stdout?.on("data", (data: Buffer) => {
      this.appendTerminalOutput(managedTerminal, data.toString());
    });

    proc.stderr?.on("data", (data: Buffer) => {
      this.appendTerminalOutput(managedTerminal, data.toString());
    });

    proc.on("close", (code: number | null, signal: string | null) => {
      managedTerminal.hasExited = true;
      managedTerminal.exitCode = code;
      managedTerminal.signal = signal;
      this.clearForceKillTimer(managedTerminal);
      managedTerminal.exitResolve();
    });

    proc.on("error", (err: Error) => {
      this.appendTerminalOutput(managedTerminal, `Error: ${err.message}\n`);
      managedTerminal.hasExited = true;
      managedTerminal.exitCode = 1;
      this.clearForceKillTimer(managedTerminal);
      managedTerminal.exitResolve();
    });

    this.terminals.set(terminalId, managedTerminal);

    return { terminalId };
  }

  async handleTerminalOutput(
    params: TerminalOutputRequest
  ): Promise<TerminalOutputResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    const exitStatus = terminal.hasExited
      ? {
          exitCode: terminal.exitCode,
          ...(terminal.signal !== null && { signal: terminal.signal }),
        }
      : null;

    return {
      output: terminal.output,
      truncated: terminal.truncated,
      exitStatus,
    };
  }

  async handleWaitForTerminalExit(
    params: WaitForTerminalExitRequest
  ): Promise<WaitForTerminalExitResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    await terminal.exitPromise;

    return {
      exitCode: terminal.exitCode,
      ...(terminal.signal !== null && { signal: terminal.signal }),
    };
  }

  async handleKillTerminalCommand(
    params: KillTerminalRequest
  ): Promise<KillTerminalResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    this.killTerminalProcess(terminal);
    return {};
  }

  async handleReleaseTerminal(
    params: ReleaseTerminalRequest
  ): Promise<ReleaseTerminalResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) {
      return {};
    }

    this.killTerminalProcess(terminal);
    this.terminals.delete(params.terminalId);
    return {};
  }

  dispose(): void {
    for (const terminal of this.terminals.values()) {
      this.killTerminalProcess(terminal);
    }
    this.terminals.clear();
  }

  private appendTerminalOutput(terminal: ManagedTerminal, text: string): void {
    terminal.output += text;
    if (terminal.outputByteLimit !== null) {
      const byteLength = Buffer.byteLength(terminal.output, "utf8");
      if (byteLength > terminal.outputByteLimit) {
        const encoded = Buffer.from(terminal.output, "utf8");
        const sliced = encoded.slice(-terminal.outputByteLimit);
        terminal.output = sliced.toString("utf8");
        terminal.truncated = true;
      }
    }
  }

  private killTerminalProcess(terminal: ManagedTerminal): void {
    if (terminal.hasExited || !terminal.proc?.pid) {
      return;
    }

    // Ask the process tree to exit cleanly first, then escalate if close never fires.
    this.sendSignalToTerminalProcess(terminal.proc, "SIGTERM");

    if (terminal.forceKillTimer === null) {
      terminal.forceKillTimer = setTimeout(() => {
        terminal.forceKillTimer = null;
        if (!terminal.hasExited && terminal.proc?.pid) {
          this.sendSignalToTerminalProcess(terminal.proc, "SIGKILL");
        }
      }, FORCE_KILL_DELAY_MS);
      terminal.forceKillTimer.unref?.();
    }
  }

  private sendSignalToTerminalProcess(
    proc: ReturnType<typeof spawn>,
    signal: NodeJS.Signals
  ): void {
    killProcessTree(proc, signal);
  }

  private clearForceKillTimer(terminal: ManagedTerminal): void {
    if (terminal.forceKillTimer !== null) {
      clearTimeout(terminal.forceKillTimer);
      terminal.forceKillTimer = null;
    }
  }
}
