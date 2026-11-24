import { beforeEach, expect, it, vi } from "vite-plus/test";

const storage = new Map<string, string>();
const invoke = vi.fn();
const on = vi.fn(() => () => {});

type Preferences = typeof import("./preferences.ts");

async function load(): Promise<Preferences> {
  vi.resetModules();
  const { setHost } = await import("./host.ts");
  setHost({
    storage: {
      get: (key) => storage.get(key) ?? null,
      set: (key, value) => void storage.set(key, value),
    },
    focused: () => true,
    onFocusChange: () => () => {},
    onLeave: () => () => {},
    notice: () => () => {},
    agentMark: () => undefined,
  });
  return import("./preferences.ts");
}

beforeEach(() => {
  storage.clear();
  invoke.mockReset();
  (globalThis as { desktopBridge?: unknown }).desktopBridge = { invoke, on };
});

function saved() {
  let resolve!: (value: Record<string, string>) => void;
  invoke.mockReturnValue(
    new Promise<Record<string, string>>((done) => {
      resolve = done;
    }),
  );
  return resolve;
}

it("waits for saved appearance before returning startup and reuses that snapshot", async () => {
  const resolve = saved();
  const { loadSyncedPreferences, onSyncedPreferenceArrival, startSyncedPreferences } = await load();
  const arrived: [string, string][] = [];
  onSyncedPreferenceArrival((key, value) => arrived.push([key, value]));
  let ready = false;
  const loading = loadSyncedPreferences(true).then(() => {
    ready = true;
  });
  await Promise.resolve();
  expect(ready).toBe(false);
  resolve({ "otter:theme-source": "dark", "otter:theme:dark": "grove" });
  await loading;
  expect(storage.get("otter:theme-source")).toBe("dark");
  expect(storage.get("otter:theme:dark")).toBe("grove");
  expect(arrived).toEqual([
    ["otter:theme-source", "dark"],
    ["otter:theme:dark", "grove"],
  ]);
  startSyncedPreferences();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("preferences:getUi", { initialize: true });
});

it("does not overwrite a choice made while the initial snapshot is loading", async () => {
  const resolve = saved();
  const { loadSyncedPreferences, setSyncedPreference } = await load();
  const loading = loadSyncedPreferences();
  setSyncedPreference("otter:theme:dark", "ocean");
  resolve({ "otter:theme:dark": "grove" });
  await loading;
  expect(storage.get("otter:theme:dark")).toBe("ocean");
});

it("tells listeners of a choice made here, in another window or on another device", async () => {
  const resolve = saved();
  const {
    loadSyncedPreferences,
    onSyncedPreferenceChange,
    setSyncedPreference,
    syncedPreferenceChanged,
  } = await load();
  const changed: string[] = [];
  onSyncedPreferenceChange((key) => changed.push(key));
  setSyncedPreference("otter:contrast", "60");
  storage.set("mail:sidebar", "{}");
  syncedPreferenceChanged("mail:sidebar");
  syncedPreferenceChanged("search:recent");
  const loading = loadSyncedPreferences();
  resolve({ "otter:reading-width": "wide", "mail:sidebar": "{}" });
  await loading;
  expect(changed).toEqual(["otter:contrast", "mail:sidebar", "otter:reading-width"]);
  expect(invoke).toHaveBeenCalledWith("preferences:setUi", { key: "otter:contrast", value: "60" });
});
