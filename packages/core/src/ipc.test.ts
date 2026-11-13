import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const logger = vi.hoisted(() => ({ info: vi.fn(), failure: vi.fn() }));
vi.mock("./logger.js", () => ({ logger }));
vi.mock("./services/account-store.js", () => {
  const accounts: Record<string, { provider: string; host?: string }> = {
    "me@gmail.com": { provider: "gmail" },
    "me@icloud.com": { provider: "imap", host: "imap.mail.me.com" },
    "me@smith-family.com": { provider: "imap", host: "mail.smith-family.com" },
  };
  return {
    isAccountId: (id: string) => id in accounts,
    providerKindOf: (id: string) => accounts[id]?.provider ?? "gmail",
    imapHostOf: (id: string) => accounts[id]?.host ?? null,
  };
});

import { SignInCancelledError, SignInTimedOutError } from "./google.js";
import { callHandler, handle } from "./ipc.js";
import { ImapError } from "./protocols/imap/client.js";
import { NeedsPassword } from "./providers/imap/sign-in-failure.js";

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

  it("says what kind of mailbox it failed in, never which server a custom domain uses", async () => {
    handle("test:mailbox", () => {
      throw new Error("Only your own folders can be renamed.");
    });
    const tagsFor = async (params: unknown) => {
      logger.failure.mockClear();
      await callHandler("test:mailbox", params);
      return logger.failure.mock.calls[0]![3];
    };
    expect(await tagsFor({ accountId: "me@gmail.com" })).toEqual({ provider: "gmail" });
    expect(await tagsFor({ accountId: "me@icloud.com" })).toEqual({
      provider: "imap",
      server: "imap.mail.me.com",
    });
    expect(await tagsFor({ accountId: "me@smith-family.com" })).toEqual({
      provider: "imap",
      server: "other",
    });
    expect(await tagsFor({ accountId: "someone@else.com" })).toBeUndefined();
    expect(await tagsFor(undefined)).toBeUndefined();
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

  // OTTER-MAIL-DESKTOP-X and -Y: the mailbox asks for its password, and adding one says why.
  it("doesn't report an IMAP password that's missing or refused, and keeps its message", async () => {
    handle("test:noPassword", () => {
      throw new NeedsPassword("me@icloud.com");
    });
    handle("test:refused", () => {
      throw new Error(
        "imap.mail.me.com didn't accept the password for me. It needs an app password.",
        {
          cause: new ImapError("AUTHENTICATE failed: Authentication failed.", "auth"),
        },
      );
    });
    expect(await callHandler("test:noPassword", undefined)).toEqual({
      error: "Enter the password for me@icloud.com to sync it.",
    });
    expect(await callHandler("test:refused", undefined)).toEqual({
      error: "imap.mail.me.com didn't accept the password for me. It needs an app password.",
    });
    expect(logger.failure).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it("still reports an IMAP server that fails for its own reasons", async () => {
    handle("test:unwell", () => {
      throw new Error("imap.example.com (port 993): LOGIN failed", {
        cause: new ImapError("LOGIN failed: [UNAVAILABLE] Try later", "server"),
      });
    });
    await callHandler("test:unwell", undefined);
    expect(logger.failure).toHaveBeenCalledOnce();
  });
});
