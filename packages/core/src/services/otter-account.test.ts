import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const secrets = new Map<string, string>();
vi.mock("../platform.js", () => ({
  platform: () => ({
    relayUrl: "https://relay.test",
    relaySession: "bearer",
    secrets: {
      get: async (name: string) => secrets.get(name) ?? null,
      set: async (name: string, value: string) => void secrets.set(name, value),
      delete: async (name: string) => void secrets.delete(name),
    },
  }),
}));
vi.mock("../logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), failure: vi.fn() } }));

const USER = { id: "u1", email: "you@example.com", name: null, picture: null };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetModules();
  secrets.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const load = async () => {
  const account = await import("./otter-account");
  await account.loadOtterAccount();
  return account;
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const meCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/me"));

it("keeps a session saved as JSON", async () => {
  secrets.set("otter-session", JSON.stringify({ token: "t", user: USER }));
  const account = await load();
  expect(account.getOtterUser()).toEqual(USER);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("adopts the Swift app's bare token through /v1/me", async () => {
  secrets.set("otter-session", "swift-token");
  fetchMock.mockResolvedValue(json({ user: USER, pushTopic: "topic" }));
  const account = await load();
  expect(account.getOtterUser()).toEqual(USER);
  expect(account.getSessionToken()).toBe("swift-token");
  const [, init] = meCalls()[0]!;
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer swift-token");
  expect(JSON.parse(secrets.get("otter-session")!)).toEqual({ token: "swift-token", user: USER });
});

it("forgets a bare token the relay ended", async () => {
  secrets.set("otter-session", "swift-token");
  fetchMock.mockResolvedValue(json({ error: "Unauthorized" }, 401));
  const account = await load();
  expect(account.getOtterUser()).toBeNull();
  expect(secrets.has("otter-session")).toBe(false);
});

it("keeps a bare token while offline and adopts it later", async () => {
  secrets.set("otter-session", "swift-token");
  fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
  const account = await load();
  expect(account.getOtterUser()).toBeNull();
  expect(secrets.get("otter-session")).toBe("swift-token");

  fetchMock.mockResolvedValue(json({ user: USER, pushTopic: "topic" }));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(account.getOtterUser()).toEqual(USER);
  expect(JSON.parse(secrets.get("otter-session")!)).toEqual({ token: "swift-token", user: USER });
});

it("finishes the Swift app's pending sign-outs, keeping the ones that fail", async () => {
  secrets.set(
    "otter-pending-sign-outs",
    JSON.stringify([
      { token: "a", origin: "https://relay.test" },
      { token: "b", origin: "https://relay.test/" },
      { token: "c", origin: "https://relay.test" },
    ]),
  );
  fetchMock.mockImplementation(async (_url, init) => {
    const auth = new Headers(init?.headers).get("Authorization");
    if (auth === "Bearer a") return new Response(null, { status: 200 });
    if (auth === "Bearer b") return new Response(null, { status: 401 });
    throw new TypeError("fetch failed");
  });
  await load();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  for (const [url, init] of fetchMock.mock.calls) {
    expect(url).toBe("https://relay.test/v1/auth/sign-out");
    expect(init?.method).toBe("POST");
  }
  await vi.waitFor(() =>
    expect(JSON.parse(secrets.get("otter-pending-sign-outs")!)).toEqual([
      { token: "c", origin: "https://relay.test" },
    ]),
  );

  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  await load();
  await vi.waitFor(() => expect(secrets.has("otter-pending-sign-outs")).toBe(false));
});
