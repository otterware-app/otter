export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  results.length = items.length;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/** Lets the rest of the thread run (on the phone, the interface) between stretches of work. */
export const yieldThread = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A request's deadline, as `AbortSignal.timeout`, whose timer ends with `done`: otherwise it
 * stays for the whole timeout after the answer, and on the phone React Native checks every
 * pending timer at each frame.
 */
export function requestTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("The request timed out.", "TimeoutError")),
    ms,
  );
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}
