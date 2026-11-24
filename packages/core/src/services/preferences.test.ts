import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const files = new Map<string, unknown>();
const relay = vi.fn();
const state = { relaySession: "cookie" };
vi.mock("../json-file.ts", () => ({
  readJson: async (name: string) => files.get(name),
  writeJson: async (name: string, value: unknown) => void files.set(name, value),
}));
vi.mock("../platform.ts", () => ({
  platform: () => ({ ...state, secrets: { get: async () => null, set: async () => {} } }),
}));
vi.mock("../logger.ts", () => ({ logger: { info: vi.fn(), warn: vi.fn(), failure: vi.fn() } }));
vi.mock("../ipc.ts", () => ({ broadcast: vi.fn() }));
vi.mock("./otter-account.ts", () => ({
  getOtterUser: () => ({ id: "test-user" }),
  relayRequest: (...args: unknown[]) => relay(...args),
}));
vi.mock("./keybindings-store.ts", () => ({
  readKeybindings: async () => ({}),
  writeKeybindings: vi.fn(),
}));
vi.mock("./mail-sync.ts", () => ({
  configureAutoSync: vi.fn(),
  followMailboxArrangement: vi.fn(),
}));
vi.mock("./account-store.ts", () => ({ listAccounts: async () => [], updateAccount: vi.fn() }));
vi.mock("./settings-store.ts", () => ({
  getSettings: async () => ({}),
  updateSettings: async () => ({}),
}));
const writeViews = vi.fn();
vi.mock("./views-store.ts", () => ({
  listViews: async () => [{ id: "mine" }],
  writeViews: (value: unknown) => writeViews(value),
}));

beforeEach(() => {
  files.clear();
  relay.mockReset();
  state.relaySession = "cookie";
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const { forgetSyncedPreferences, getUiPreferences, preferenceChanged, pullPreferences } =
  await import("./preferences");

it("waits for a new browser's account appearance before returning it", async () => {
  let resolve!: (value: unknown) => void;
  const response = {
    promise: new Promise<unknown>((done) => {
      resolve = done;
    }),
  };
  relay.mockReturnValue(response.promise);
  let ready = false;
  const loading = getUiPreferences(true).then((ui) => {
    ready = true;
    return ui;
  });
  await Promise.resolve();
  expect(ready).toBe(false);
  resolve({
    preferences: { ui: { "otter:theme-source": "dark", "otter:theme:dark": "grove" } },
  });
  expect(await loading).toEqual({ "otter:theme-source": "dark", "otter:theme:dark": "grove" });
});

it("uses cached appearance without waiting for the network", async () => {
  files.set("ui-preferences.json", { "otter:theme:dark": "ocean" });
  expect(await getUiPreferences(true)).toEqual({ "otter:theme:dark": "ocean" });
  expect(relay).not.toHaveBeenCalled();
});

it("keeps native startup local", async () => {
  state.relaySession = "bearer";
  expect(await getUiPreferences(true)).toEqual({});
  expect(relay).not.toHaveBeenCalled();
});

it("falls back to local defaults if the relay is unavailable", async () => {
  relay.mockRejectedValue(new Error("offline"));
  expect(await getUiPreferences(true)).toEqual({});
});

it("keeps a change made here until the relay has it", async () => {
  forgetSyncedPreferences();
  preferenceChanged("views");
  relay.mockResolvedValueOnce({ preferences: { views: [{ id: "older" }] } });
  await pullPreferences();

  let resolve!: (value: unknown) => void;
  relay.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  const pulling = pullPreferences();
  preferenceChanged("views");
  resolve({ preferences: { views: [{ id: "older" }] } });
  await pulling;
  expect(writeViews).not.toHaveBeenCalled();

  relay.mockResolvedValue(undefined);
  await vi.advanceTimersByTimeAsync(600);
  expect(relay).toHaveBeenLastCalledWith(
    "PUT",
    "/v1/preferences",
    expect.objectContaining({
      preferences: expect.objectContaining({ views: [{ id: "mine" }] }),
    }),
  );
  relay.mockResolvedValueOnce({ preferences: { views: [{ id: "theirs" }] } });
  await pullPreferences();
  expect(writeViews).toHaveBeenCalledWith([{ id: "theirs" }]);
});
