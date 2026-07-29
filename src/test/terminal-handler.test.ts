import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TerminalHandler } from "../acp/terminal-handler";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  condition: () => boolean,
  timeoutMs: number
): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await delay(25);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const SID = "test-session";

suite("TerminalHandler", () => {
  let handler: TerminalHandler;

  setup(() => {
    handler = new TerminalHandler();
  });

  teardown(() => {
    handler.dispose();
  });

  suite("handleCreateTerminal", () => {
    test("should return a terminalId", async () => {
      const result = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "echo",
        args: ["hello"],
      });
      assert.ok(result.terminalId.startsWith("term-"));
    });

    test("should execute command and capture stdout", async () => {
      const { terminalId } = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "echo hello",
      });
      await handler.handleWaitForTerminalExit({ sessionId: SID, terminalId });
      const { output } = await handler.handleTerminalOutput({
        sessionId: SID,
        terminalId,
      });
      assert.ok(output.includes("hello"));
    });

    test("should capture stderr", async () => {
      const { terminalId } = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "echo error >&2",
      });
      await handler.handleWaitForTerminalExit({ sessionId: SID, terminalId });
      const { output } = await handler.handleTerminalOutput({
        sessionId: SID,
        terminalId,
      });
      assert.ok(output.includes("error"));
    });

    test("should use provided cwd", async function () {
      if (process.platform === "win32") {
        this.skip();
        return;
      }
      const { terminalId } = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "pwd",
        cwd: "/tmp",
      });
      await handler.handleWaitForTerminalExit({ sessionId: SID, terminalId });
      const { output } = await handler.handleTerminalOutput({
        sessionId: SID,
        terminalId,
      });
      assert.ok(output.includes("/tmp"));
    });

    test("should pass env variables", async function () {
      if (process.platform === "win32") {
        this.skip();
        return;
      }
      const { terminalId } = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "echo $MY_TEST_VAR",
        env: [{ name: "MY_TEST_VAR", value: "test_value_123" }],
      });
      await handler.handleWaitForTerminalExit({ sessionId: SID, terminalId });
      const { output } = await handler.handleTerminalOutput({
        sessionId: SID,
        terminalId,
      });
      assert.ok(output.includes("test_value_123"));
    });
  });

  suite("handleTerminalOutput", () => {
    test("should return exitStatus after command finishes", async () => {
      const { terminalId } = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "exit 0",
      });
      await handler.handleWaitForTerminalExit({ sessionId: SID, terminalId });
      const { exitStatus } = await handler.handleTerminalOutput({
        sessionId: SID,
        terminalId,
      });
      assert.deepStrictEqual(exitStatus, { exitCode: 0 });
    });

    test("should return non-zero exitStatus on failure", async () => {
      const { terminalId } = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "exit 42",
      });
      await handler.handleWaitForTerminalExit({ sessionId: SID, terminalId });
      const { exitStatus } = await handler.handleTerminalOutput({
        sessionId: SID,
        terminalId,
      });
      assert.deepStrictEqual(exitStatus, { exitCode: 42 });
    });

    test("should return null exitStatus while command is still running", async () => {
      const { terminalId } = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "sleep 10",
      });
      const { exitStatus } = await handler.handleTerminalOutput({
        sessionId: SID,
        terminalId,
      });
      assert.strictEqual(exitStatus, null);
      await handler.handleKillTerminalCommand({ sessionId: SID, terminalId });
    });

    test("should throw for unknown terminalId", async () => {
      await assert.rejects(
        () =>
          handler.handleTerminalOutput({ sessionId: SID, terminalId: "none" }),
        /Terminal not found: none/
      );
    });

    test("should respect outputByteLimit", async () => {
      const { terminalId } = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "python3 -c \"print('x' * 1000)\"",
        outputByteLimit: 100,
      });
      await handler.handleWaitForTerminalExit({ sessionId: SID, terminalId });
      const { output, truncated } = await handler.handleTerminalOutput({
        sessionId: SID,
        terminalId,
      });
      assert.strictEqual(truncated, true);
      assert.ok(Buffer.byteLength(output, "utf8") <= 100);
    });
  });

  suite("handleWaitForTerminalExit", () => {
    test("should resolve with exitCode 0 on success", async () => {
      const { terminalId } = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "exit 0",
      });
      const result = await handler.handleWaitForTerminalExit({
        sessionId: SID,
        terminalId,
      });
      assert.strictEqual(result.exitCode, 0);
    });

    test("should resolve with non-zero exitCode on failure", async () => {
      const { terminalId } = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "exit 7",
      });
      const result = await handler.handleWaitForTerminalExit({
        sessionId: SID,
        terminalId,
      });
      assert.strictEqual(result.exitCode, 7);
    });

    test("should throw for unknown terminalId", async () => {
      await assert.rejects(
        () =>
          handler.handleWaitForTerminalExit({
            sessionId: SID,
            terminalId: "bad-id",
          }),
        /Terminal not found: bad-id/
      );
    });
  });

  suite("handleKillTerminalCommand", () => {
    test("should kill a running process", async () => {
      const { terminalId } = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "sleep 30",
      });
      await delay(50);
      await handler.handleKillTerminalCommand({ sessionId: SID, terminalId });
      const result = await handler.handleWaitForTerminalExit({
        sessionId: SID,
        terminalId,
      });
      assert.notStrictEqual(result.exitCode, 0);
    });

    test("should kill child processes spawned by the terminal command", async function () {
      if (process.platform === "win32") {
        this.skip();
      }

      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "vscode-acp-terminal-")
      );
      const childPidFile = path.join(tmpDir, "child.pid");
      const heartbeatFile = path.join(tmpDir, "heartbeat");
      let childPid: number | undefined;

      try {
        const childScript = [
          `const fs = require("fs");`,
          `const heartbeatFile = ${JSON.stringify(heartbeatFile)};`,
          `setInterval(() => fs.appendFileSync(heartbeatFile, "."), 50);`,
        ].join("");
        const parentScript = [
          `const cp = require("child_process");`,
          `const fs = require("fs");`,
          `const child = cp.spawn(process.execPath, ["-e", ${JSON.stringify(
            childScript
          )}], { stdio: "ignore" });`,
          `fs.writeFileSync(${JSON.stringify(childPidFile)}, String(child.pid));`,
          `setInterval(() => {}, 1000);`,
        ].join("");
        const command = `${shellQuote(process.execPath)} -e ${shellQuote(
          parentScript
        )}`;
        const { terminalId } = await handler.handleCreateTerminal({
          sessionId: SID,
          command,
        });

        await waitFor(
          () => fs.existsSync(childPidFile) && fileSize(heartbeatFile) > 0,
          2000
        );
        childPid = Number(fs.readFileSync(childPidFile, "utf8"));

        await handler.handleKillTerminalCommand({ sessionId: SID, terminalId });
        await handler.handleWaitForTerminalExit({ sessionId: SID, terminalId });

        const sizeAfterKill = fileSize(heartbeatFile);
        await delay(300);
        assert.strictEqual(fileSize(heartbeatFile), sizeAfterKill);
      } finally {
        if (childPid !== undefined && isProcessAlive(childPid)) {
          process.kill(childPid, "SIGKILL");
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("should throw for unknown terminalId", async () => {
      await assert.rejects(
        () =>
          handler.handleKillTerminalCommand({
            sessionId: SID,
            terminalId: "missing",
          }),
        /Terminal not found: missing/
      );
    });
  });

  suite("handleReleaseTerminal", () => {
    test("should release a terminal and clean up", async () => {
      const { terminalId } = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "sleep 30",
      });
      await delay(50);
      await handler.handleReleaseTerminal({ sessionId: SID, terminalId });
      await assert.rejects(
        () => handler.handleTerminalOutput({ sessionId: SID, terminalId }),
        /Terminal not found/
      );
    });

    test("should be a no-op for unknown terminalId", async () => {
      const result = await handler.handleReleaseTerminal({
        sessionId: SID,
        terminalId: "ghost",
      });
      assert.deepStrictEqual(result, {});
    });
  });

  suite("dispose", () => {
    test("should clean up all terminals", async () => {
      const { terminalId: id1 } = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "sleep 30",
      });
      const { terminalId: id2 } = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "sleep 30",
      });
      await delay(50);
      handler.dispose();
      await assert.rejects(
        () => handler.handleTerminalOutput({ sessionId: SID, terminalId: id1 }),
        /Terminal not found/
      );
      await assert.rejects(
        () => handler.handleTerminalOutput({ sessionId: SID, terminalId: id2 }),
        /Terminal not found/
      );
    });
  });

  suite("concurrent terminals", () => {
    test("should handle multiple simultaneous terminals", async () => {
      const t1 = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "echo one",
      });
      const t2 = await handler.handleCreateTerminal({
        sessionId: SID,
        command: "echo two",
      });
      await handler.handleWaitForTerminalExit({
        sessionId: SID,
        terminalId: t1.terminalId,
      });
      await handler.handleWaitForTerminalExit({
        sessionId: SID,
        terminalId: t2.terminalId,
      });
      const o1 = await handler.handleTerminalOutput({
        sessionId: SID,
        terminalId: t1.terminalId,
      });
      const o2 = await handler.handleTerminalOutput({
        sessionId: SID,
        terminalId: t2.terminalId,
      });
      assert.ok(o1.output.includes("one"));
      assert.ok(o2.output.includes("two"));
    });
  });
});
