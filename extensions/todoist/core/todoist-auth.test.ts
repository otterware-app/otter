import { setPlatform } from "@otter-mail/core/extension-kit";
import type { Platform } from "@otter-mail/core/extension-kit";
import { beforeEach, afterEach, it, expect, vi } from "vite-plus/test";
import { signInTodoist, todoistAccessToken, clearTodoistOAuth } from "./todoist-auth.js";
const secrets = new Map<string, string>();
const fetchMock = vi.fn<typeof fetch>();
let callbackState: "valid" | "wrong" | "denied" = "valid";
let authorization: URL;
const redirect = "https://mail.otterware.app/todoist-callback/";
beforeEach(async () => {
  secrets.clear();
  fetchMock.mockReset();
  callbackState = "valid";
  vi.stubGlobal("fetch", fetchMock);
  setPlatform({
    secrets: {
      get: async (k) => secrets.get(k) ?? null,
      set: async (k, v) => {
        secrets.set(k, v);
      },
      delete: async (k) => {
        secrets.delete(k);
      },
    },
    todoistSignIn: async (build) => {
      authorization = new URL(await build(redirect));
      return `${redirect}?${new URLSearchParams({ state: callbackState === "wrong" ? "wrong" : authorization.searchParams.get("state")!, ...(callbackState === "denied" ? { error: "access_denied" } : { code: "test-code" }) })}`;
    },
  } as Partial<Platform> as Platform);
  await clearTodoistOAuth();
});
afterEach(() => vi.unstubAllGlobals());
function ready() {
  fetchMock.mockResolvedValueOnce(Response.json({ client_id: "tdd_public" }));
  fetchMock.mockResolvedValueOnce(
    Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }),
  );
}
it("uses S256 PKCE without a client secret and keeps tokens in backend secrets", async () => {
  ready();
  await signInTodoist();
  expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
  const form = fetchMock.mock.calls[1]![1]!.body as URLSearchParams;
  const verifier = form.get("code_verifier")!;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  expect(authorization.searchParams.get("code_challenge")).toBe(
    btoa(String.fromCharCode(...digest))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, ""),
  );
  expect(form.get("client_secret")).toBeNull();
  expect(form.get("redirect_uri")).toBe(redirect);
  expect(await todoistAccessToken()).toBe("access");
  expect(fetchMock.mock.calls[0]![1]!.credentials).toBe("omit");
});
it.each(["wrong", "denied"] as const)(
  "rejects %s callbacks before exchanging tokens",
  async (value) => {
    callbackState = value;
    ready();
    await expect(signInTodoist()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(secrets.has("todoist-oauth")).toBe(false);
  },
);
it("serializes concurrent refreshes and stores the rotated refresh token", async () => {
  ready();
  await signInTodoist();
  const saved = JSON.parse(secrets.get("todoist-oauth")!);
  saved.expiresAt = 0;
  secrets.set("todoist-oauth", JSON.stringify(saved));
  fetchMock.mockResolvedValueOnce(
    Response.json({ access_token: "renewed", refresh_token: "rotated", expires_in: 3600 }),
  );
  expect(await Promise.all([todoistAccessToken(), todoistAccessToken()])).toEqual([
    "renewed",
    "renewed",
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(JSON.parse(secrets.get("todoist-oauth")!).refreshToken).toBe("rotated");
});
it("refreshes a rejected token even before its local expiry", async () => {
  ready();
  await signInTodoist();
  fetchMock.mockResolvedValueOnce(
    Response.json({ access_token: "renewed", refresh_token: "rotated", expires_in: 3600 }),
  );
  expect(await todoistAccessToken("access")).toBe("renewed");
});
it("does not reconnect after the user disconnects during consent", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ client_id: "tdd_public" }));
  fetchMock.mockImplementationOnce(async () => {
    await clearTodoistOAuth();
    return Response.json({ access_token: "access", refresh_token: "refresh" });
  });
  await expect(signInTodoist()).rejects.toThrow("connection changed");
  expect(secrets.has("todoist-oauth")).toBe(false);
});
it("discards a consumed refresh token when its replacement cannot be recovered", async () => {
  ready();
  await signInTodoist();
  fetchMock.mockResolvedValueOnce(Response.json({ access_token: "replacement", expires_in: 3600 }));
  await expect(todoistAccessToken("access")).rejects.toThrow("reconnect");
  expect(await todoistAccessToken()).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
