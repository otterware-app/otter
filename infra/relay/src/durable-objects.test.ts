import { describe, expect, it, vi } from "vite-plus/test";
import { retryingReset } from "./durable-objects.ts";

const inactive = () =>
  Object.assign(
    new Error(
      "Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.",
    ),
    { retryable: true },
  );

describe("calling a Durable Object", () => {
  it("tries a fresh stub once when the object was restarted under the first", async () => {
    const stub = vi.fn((n: number) => n);
    let n = 0;
    const call = vi.fn(async (s: number) => {
      if (s === 1) throw inactive();
      return "ok";
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(retryingReset(() => stub(++n), call)).resolves.toBe("ok");
    expect(call.mock.calls).toEqual([[1], [2]]);
    warn.mockRestore();
  });
  it("fails when the fresh stub fails too", async () => {
    const call = vi.fn().mockRejectedValue(inactive());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(retryingReset(() => ({}), call)).rejects.toThrow("no longer active");
    expect(call).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
  it("doesn't retry an overloaded object or any other error", async () => {
    for (const error of [
      Object.assign(new Error("Durable Object is overloaded."), {
        retryable: true,
        overloaded: true,
      }),
      new Error("bug"),
    ]) {
      const call = vi.fn().mockRejectedValue(error);
      await expect(retryingReset(() => ({}), call)).rejects.toBe(error);
      expect(call).toHaveBeenCalledOnce();
    }
  });
});
