"use client";

/**
 * Tie a SHARED promise (in-flight dedupe maps, resolution caches) to one
 * caller's abort signal without killing the underlying work for everyone
 * else. Critical under React strict mode: the mount/remount cycle aborts
 * the first effect's call, and the second run must not inherit a doomed
 * promise from a dedupe map.
 */
export function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
