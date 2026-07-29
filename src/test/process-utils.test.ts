import * as assert from "assert";
import { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { killProcessTree, DEFAULT_NPX_ENV } from "../utils/process-utils";

suite("process-utils", () => {
  suite("DEFAULT_NPX_ENV", () => {
    test("should define network timeout and update notifier suppression", () => {
      assert.strictEqual(DEFAULT_NPX_ENV.NPM_CONFIG_FETCH_TIMEOUT, "10000");
      assert.strictEqual(DEFAULT_NPX_ENV.NPM_CONFIG_FETCH_RETRIES, "1");
      assert.strictEqual(DEFAULT_NPX_ENV.NO_UPDATE_NOTIFIER, "1");
      assert.strictEqual(DEFAULT_NPX_ENV.NPM_CONFIG_UPDATE_NOTIFIER, "false");
    });
  });

  suite("killProcessTree", () => {
    test("should handle process with undefined pid without crashing", () => {
      let killed = false;
      const mockProc = new EventEmitter() as unknown as ChildProcess;
      mockProc.kill = () => {
        killed = true;
        return true;
      };

      killProcessTree(mockProc);
      assert.strictEqual(killed, true);
    });

    test("should handle mock process with dummy pid without crashing", () => {
      if (process.platform === "win32") {
        const mockProc = new EventEmitter() as unknown as ChildProcess;
        (mockProc as any).pid = 99999999;
        mockProc.kill = () => {
          throw new Error("proc.kill should not be called on win32");
        };
        assert.doesNotThrow(() => killProcessTree(mockProc));
        return;
      }

      let killed = false;
      const mockProc = new EventEmitter() as unknown as ChildProcess;
      (mockProc as any).pid = 99999999;
      mockProc.kill = () => {
        killed = true;
        return true;
      };

      killProcessTree(mockProc);
      assert.strictEqual(killed, true);
    });
  });
});
