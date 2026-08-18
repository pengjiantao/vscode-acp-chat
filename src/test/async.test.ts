import * as assert from "assert";
import { withTimeout } from "../utils/async";

suite("Async Utilities", () => {
  test("withTimeout resolves when promise completes before timeout", async () => {
    const fastPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("success"), 10);
    });

    const result = await withTimeout(fastPromise, 100, "Should not time out");
    assert.strictEqual(result, "success");
  });

  test("withTimeout rejects with custom message when timeout expires", async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("slow"), 100);
    });

    await assert.rejects(
      () => withTimeout(slowPromise, 10, "Operation timed out"),
      (err: Error) => {
        assert.strictEqual(err.message, "Operation timed out");
        return true;
      }
    );
  });

  test("withTimeout propagates promise rejection before timeout", async () => {
    const failingPromise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error("original error")), 10);
    });

    await assert.rejects(
      () => withTimeout(failingPromise, 100, "Should not time out"),
      (err: Error) => {
        assert.strictEqual(err.message, "original error");
        return true;
      }
    );
  });
});
