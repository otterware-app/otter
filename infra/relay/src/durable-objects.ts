/**
 * Runs a call on a Durable Object, and once more on a fresh stub when Cloudflare marks the failure
 * retryable (the object was restarted under the stub, as when new code rolls out), as Cloudflare
 * advises. An overloaded object, or one that fails again, still fails.
 */
export async function retryingReset<S, T>(
  stub: () => S,
  call: (stub: S) => Promise<T>,
): Promise<T> {
  try {
    return await call(stub());
  } catch (error) {
    const flags = error as { retryable?: unknown; overloaded?: unknown };
    if (!(error instanceof Error) || flags.retryable !== true || flags.overloaded === true)
      throw error;
    console.warn("Durable Object call retried", { message: error.message });
    return await call(stub());
  }
}
