import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { requestTimeout } from "./pool.ts";

afterEach(() => vi.useRealTimers());

describe("requestTimeout", () => {
  it("aborts as a timeout once its time is up", () => {
    vi.useFakeTimers();
    const { signal } = requestTimeout(1000);
    vi.advanceTimersByTime(999);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).name).toBe("TimeoutError");
  });

  it("leaves no timer once the request is done", () => {
    vi.useFakeTimers();
    const { signal, done } = requestTimeout(1000);
    done();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(signal.aborted).toBe(false);
  });
});
