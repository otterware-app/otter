import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";

vi.mock("../services/realtime.js", () => ({
  getRealtimeState: () => "off",
  startRealtime: vi.fn(),
  stopRealtime: vi.fn(),
}));
vi.mock("../services/linked-accounts.js", () => ({
  clearLinkedSnapshot: vi.fn(),
  linkedAccountIds: () => new Set(),
  reconcileAccounts: vi.fn(),
}));
vi.mock("../services/preferences.js", () => ({
  forgetSyncedPreferences: vi.fn(async () => {}),
  pullPreferences: vi.fn(async () => {}),
}));

import { callHandler } from "../ipc.js";
import { setPlatform, type Platform } from "../platform.js";
import { clearOtterSession, getOtterUser } from "../services/otter-account.js";
import { registerOtterAccountHandlers } from "./otter-account.js";

const saved = new Map<string, string>();
const getIdToken = vi.fn(async (accountId: string) => `id-token-of-${accountId}`);
const signInForIdToken = vi.fn(async () => "id-token-from-consent");

beforeAll(() => {
  setPlatform({
    relayUrl: "https://relay.mail.test",
    relaySession: "bearer",
    broadcast: () => {},
    log: () => {},
    secrets: {
      get: async (name: string) => saved.get(name) ?? null,
      set: async (name: string, value: string) => void saved.set(name, value),
      delete: async (name: string) => void saved.delete(name),
    },
    google: { getIdToken, signInForIdToken },
  } as unknown as Platform);
  relayAccepting();
  registerOtterAccountHandlers();
});

afterEach(async () => {
  await clearOtterSession();
  vi.clearAllMocks();
  idTokens.length = 0;
});

// better-auth's client keeps the fetch it was made with, so one stub serves every test.
const idTokens: string[] = [];
function relayAccepting(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.endsWith("/v1/auth/sign-in/social")) return Response.json({});
      const body = JSON.parse(String(init?.body ?? (input as Request).body)) as {
        idToken: { token: string };
      };
      idTokens.push(body.idToken.token);
      return Response.json(
        {
          redirect: false,
          token: "session-token",
          user: { id: "u1", email: "me@gmail.com", name: "Me", image: null },
        },
        { headers: { "set-auth-token": "session-token" } },
      );
    }),
  );
}

it("signs in with a mailbox's ID token, with no second consent", async () => {
  const result = await callHandler("otter:signIn", { accountId: "me@gmail.com" });
  expect(result).toMatchObject({ result: { user: { email: "me@gmail.com" } } });
  expect(getIdToken).toHaveBeenCalledWith("me@gmail.com");
  expect(signInForIdToken).not.toHaveBeenCalled();
  expect(idTokens).toEqual(["id-token-of-me@gmail.com"]);
  expect(getOtterUser()?.id).toBe("u1");
});

it("asks for consent without one", async () => {
  expect(await callHandler("otter:signIn", undefined)).toMatchObject({ result: { user: {} } });
  expect(idTokens).toEqual(["id-token-from-consent"]);
});
