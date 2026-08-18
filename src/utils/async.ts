/**
 * Generic asynchronous utility functions.
 */

/**
 * Wraps a promise with a timeout in milliseconds.
 * If the promise does not resolve/reject within `ms`, rejects with an Error containing `timeoutMsg`.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMsg: string
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMsg));
    }, ms);
  });

  return Promise.race([
    promise.then((res) => {
      if (timer) clearTimeout(timer);
      return res;
    }),
    timeoutPromise,
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
