import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const logger = vi.hoisted(() => ({ info: vi.fn(), failure: vi.fn() }));
vi.mock("./logger.js", () => ({ logger }));

import { SignInCancelledError, SignInTimedOutError } from "./google.js";
import { callHandler, handle } from "./ipc.js";

describe("a handler that fails", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports a real failure", async () => {
    handle("test:broken", () => {
      throw new Error("Google OAuth authorization failed: invalid_grant");
    });
    expect(await callHandler("test:broken", undefined)).toEqual({
      error: "Google OAuth authorization failed: invalid_grant",
    });
    expect(logger.failure).toHaveBeenCalledOnce();
  });

  it("doesn't report a sign-in the user left or cancelled, and keeps its message", async () => {
    handle("test:timedOut", () => {
      throw new SignInTimedOutError("Google sign-in timed out. Try adding the account again.");
    });
    handle("test:cancelled", () => {
      throw new SignInCancelledError();
    });
    expect(await callHandler("test:timedOut", undefined)).toEqual({
      error: "Google sign-in timed out. Try adding the account again.",
    });
    expect(await callHandler("test:cancelled", undefined)).toEqual({
      error: "Sign-in was cancelled.",
    });
    expect(logger.failure).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledOnce();
  });
});
