import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const files = new Map<string, unknown>();
const relay = vi.fn();
const state = { relaySession: "cookie" };
vi.mock("../json-file.js", () => ({
  readJson: async (name: string) => files.get(name),
  writeJson: async (name: string, value: unknown) => void files.set(name, value),
}));
vi.mock("../platform.js", () => ({
  platform: () => ({ ...state, secrets: { get: async () => null, set: async () => {} } }),
}));
vi.mock("../logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), failure: vi.fn() } }));
vi.mock("../ipc.js", () => ({ broadcast: vi.fn() }));
vi.mock("./otter-account.js", () => ({
  getOtterUser: () => ({ id: "test-user" }),
  relayRequest: (...args: unknown[]) => relay(...args),
}));
vi.mock("./agent/service.js", () => ({
  applySyncedAgentKeys: vi.fn(),
  forgetAgentKeys: vi.fn(),
  applySyncedProviderSettings: vi.fn(),
  syncedAgentKeys: async () => ({}),
  syncedProviderSettings: () => ({}),
}));
vi.mock("./keybindings-store.js", () => ({
  readKeybindings: async () => ({}),
  writeKeybindings: vi.fn(),
}));
vi.mock("./mail-sync.js", () => ({
  configureAutoSync: vi.fn(),
  followMailboxArrangement: vi.fn(),
}));
vi.mock("./account-store.js", () => ({ listAccounts: async () => [], updateAccount: vi.fn() }));
vi.mock("./settings-store.js", () => ({
  getSettings: async () => ({}),
  updateSettings: async () => ({}),
}));
vi.mock("./views-store.js", () => ({ listViews: async () => [], writeViews: vi.fn() }));

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
const { getUiPreferences } = await import("./preferences");

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
