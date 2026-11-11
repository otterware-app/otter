import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const storage = new Map<string, string>();
const invoke = vi.fn();
const setThemeSource = vi.fn();
const on = vi.fn(() => () => {});

beforeEach(() => {
  vi.resetModules();
  storage.clear();
  invoke.mockReset();
  setThemeSource.mockReset();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  };
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal(
    "StorageEvent",
    class extends Event {
      constructor(
        type: string,
        public init: unknown,
      ) {
        super(type);
      }
    },
  );
  vi.stubGlobal("window", {
    desktopBridge: { invoke, on, nativeTheme: { setThemeSource } },
    dispatchEvent: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("waits for saved appearance before returning startup and reuses that snapshot", async () => {
  let resolve!: (value: Record<string, string>) => void;
  const saved = {
    promise: new Promise<Record<string, string>>((done) => {
      resolve = done;
    }),
  };
  invoke.mockReturnValue(saved.promise);
  const { loadSyncedPreferences, startSyncedPreferences } = await import("./synced-preferences");
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
  expect(setThemeSource).toHaveBeenCalledWith("dark");
  startSyncedPreferences();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("preferences:getUi", { initialize: true });
});

it("does not overwrite a choice made while the initial snapshot is loading", async () => {
  let resolve!: (value: Record<string, string>) => void;
  const saved = {
    promise: new Promise<Record<string, string>>((done) => {
      resolve = done;
    }),
  };
  invoke.mockReturnValue(saved.promise);
  const { loadSyncedPreferences, setSyncedPreference } = await import("./synced-preferences");
  const loading = loadSyncedPreferences();
  setSyncedPreference("otter:theme:dark", "ocean");
  resolve({ "otter:theme:dark": "grove" });
  await loading;
  expect(storage.get("otter:theme:dark")).toBe("ocean");
});
