import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const error = vi.hoisted(() => vi.fn());
let signedIn = true;

vi.mock("../logger.ts", () => ({ logger: { error } }));
vi.mock("../providers/index.ts", () => ({
  findProvider: () => ({
    errorKind: (err: Error) => (err.message === "offline" ? "network" : null),
  }),
  isSignedIn: () => signedIn,
}));
vi.mock("./account-store.ts", () => ({
  providerKindOf: (id: string) => (id.endsWith("@icloud.com") ? "imap" : "gmail"),
  imapHostOf: () => "imap.mail.me.com",
}));

import { forgetSyncHealth, STALE_MS, syncFailed, syncSucceeded } from "./sync-health.ts";

const MINUTE = 60_000;

/** Fails every 10 minutes (the longest backoff) for `ms`. */
function failFor(
  accountId: string,
  ms: number,
  err = new Error("boom"),
  lane: "mail" | "calendar" = "mail",
) {
  for (let t = 0; t <= ms; t += 10 * MINUTE) {
    syncFailed(lane, accountId, err);
    vi.advanceTimersByTime(10 * MINUTE);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  error.mockClear();
  signedIn = true;
});
afterEach(() => vi.useRealTimers());

describe("a mailbox that keeps failing to sync", () => {
  it("is reported once, after six hours awake, with its provider", () => {
    failFor("a@gmail.com", STALE_MS - 20 * MINUTE);
    expect(error).not.toHaveBeenCalled();
    failFor("a@gmail.com", 20 * MINUTE);
    expect(error).toHaveBeenCalledOnce();
    const [scope, message, data] = error.mock.calls[0]!;
    expect(scope).toBe("sync-health");
    expect(message).toBe("Mail hasn't synced in 6 hours: a@gmail.com");
    expect(data.error.cause.message).toBe("boom");
    expect(data.tags).toEqual({ provider: "gmail", reason: "error" });

    failFor("a@gmail.com", STALE_MS);
    expect(error).toHaveBeenCalledOnce();
  });

  it("tags an IMAP mailbox's server", () => {
    failFor("b@icloud.com", STALE_MS, new Error("boom"), "calendar");
    expect(error.mock.calls[0]![1]).toBe("Calendar hasn't synced in 6 hours: b@icloud.com");
    expect(error.mock.calls[0]![2].tags).toEqual({
      provider: "imap",
      server: "imap.mail.me.com",
      reason: "error",
    });
  });

  it("starts over after a success", () => {
    failFor("c@gmail.com", STALE_MS - 20 * MINUTE);
    syncSucceeded("mail", "c@gmail.com");
    failFor("c@gmail.com", STALE_MS - 20 * MINUTE);
    forgetSyncHealth("c@gmail.com");
    failFor("c@gmail.com", STALE_MS - 20 * MINUTE);
    expect(error).not.toHaveBeenCalled();
  });

  it("doesn't count sleep, being offline or signed out", () => {
    syncFailed("mail", "d@gmail.com", new Error("boom"));
    vi.advanceTimersByTime(12 * 60 * MINUTE);
    failFor("d@gmail.com", STALE_MS - 60 * MINUTE);
    failFor("d@gmail.com", STALE_MS, new Error("offline"));
    signedIn = false;
    failFor("d@gmail.com", STALE_MS);
    expect(error).not.toHaveBeenCalled();
  });

  it("doesn't count the time before a failure that's offline", () => {
    failFor("e@gmail.com", STALE_MS - 10 * MINUTE);
    syncFailed("mail", "e@gmail.com", new Error("offline"));
    vi.advanceTimersByTime(10 * MINUTE);
    syncFailed("mail", "e@gmail.com", new Error("boom"));
    expect(error).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10 * MINUTE);
    syncFailed("mail", "e@gmail.com", new Error("boom"));
    expect(error).toHaveBeenCalledOnce();
  });
});
