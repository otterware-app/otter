import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { requestMain, saved, stateDir } = vi.hoisted(() => ({
  requestMain: vi.fn(),
  saved: [] as unknown[],
  stateDir: { path: "" },
}));

vi.mock("../main-link.ts", () => ({ requestMain }));
vi.mock("../backend-protocol.ts", () => ({ appInfo: () => ({ stateDir: stateDir.path }) }));
vi.mock("./credentials-store.ts", () => ({
  getCredentials: async () => ({ clientId: "client", clientSecret: "secret" }),
}));
vi.mock("@otter/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otter/core")>()),
  accountStore: {
    getAccount: async () => undefined,
    addAccount: async (account: unknown) => void saved.push(account),
  },
}));

import type { DemoGmailMailbox } from "@otter/contracts/demo";
import { GMAIL_ACCESS_MISSING_MESSAGE, GOOGLE_UNAVAILABLE_MESSAGE } from "@otter/core";

import { googleAuth } from "./gmail-oauth.ts";

const realFetch = globalThis.fetch;
let grantedScope = "";

beforeEach(async () => {
  stateDir.path = await fs.mkdtemp(path.join(os.tmpdir(), "gmail-oauth-"));
  saved.length = 0;
  requestMain.mockImplementation(async (kind: string, params: { url?: string; text?: string }) => {
    if (kind === "seal") return params.text;
    if (kind === "openExternal") {
      const consent = new URL(params.url!).searchParams;
      await realFetch(`${consent.get("redirect_uri")}?state=${consent.get("state")}&code=code`);
    }
  });
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        scope: grantedScope,
      });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/userinfo") {
      return Response.json({ email: "me@example.com", name: "Me" });
    }
    return realFetch(input, init);
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(stateDir.path, { recursive: true, force: true });
});

it("refuses a grant where Gmail access was unticked", async () => {
  grantedScope = "openid email profile https://www.googleapis.com/auth/calendar.readonly";
  await expect(googleAuth.addAccount("me@example.com")).rejects.toThrow(
    GMAIL_ACCESS_MISSING_MESSAGE,
  );
  expect(saved).toEqual([]);
});

it("adds a mailbox that allowed Gmail, even without the optional permissions", async () => {
  grantedScope = "openid email profile https://mail.google.com/";
  await expect(googleAuth.addAccount("me@example.com")).resolves.toMatchObject({
    id: "me@example.com",
  });
  expect(saved).toHaveLength(1);
});

describe("a refresh while Google's token endpoint is failing", () => {
  const mailbox: DemoGmailMailbox = {
    provider: "gmail",
    email: "me@example.com",
    refreshTokens: { desktop: "refresh" },
  };
  const addDemoAccount = googleAuth.addDemoAccount!;
  let failures: number;
  let tokenCalls: number;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    tokenCalls = 0;
    const fakeFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      if (String(input) !== "https://oauth2.googleapis.com/token") return fakeFetch(input, init);
      if (tokenCalls++ < failures) {
        return Response.json({ error: "internal_failure" }, { status: 500 });
      }
      return Response.json({ access_token: "access", expires_in: 3600 });
    });
  });

  afterEach(() => vi.useRealTimers());

  it("retries, and keeps the sign-in", async () => {
    failures = 2;
    const added = addDemoAccount(mailbox);
    await vi.runAllTimersAsync();
    await expect(added).resolves.toMatchObject({ id: "me@example.com" });
    expect(tokenCalls).toBe(3);
  });

  it("gives up as Google's trouble, not a lost sign-in", async () => {
    failures = Infinity;
    const added = addDemoAccount(mailbox).then(
      () => new Error("signed in"),
      (e: unknown) => e as Error,
    );
    await vi.runAllTimersAsync();
    const err = await added;
    expect(err.message).toContain(GOOGLE_UNAVAILABLE_MESSAGE);
    expect(err.message).toContain("internal_failure");
    expect(tokenCalls).toBe(3);
  });

  it("still asks to sign in again when Google revoked the grant", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return Response.json({ error: "invalid_grant", error_description: "Bad" }, { status: 400 });
    });
    await expect(addDemoAccount(mailbox)).rejects.toThrow("Google sign-in expired");
    expect(calls).toBe(1);
  });
});
