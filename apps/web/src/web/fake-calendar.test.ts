import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { Platform, SqlDatabase } from "@otter/core";
import { DEMO_ACCOUNTS } from "@otter/shared/demo-mailboxes";

const EMAIL = DEMO_ACCOUNTS[0]!.email;
const EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

afterEach(() => vi.unstubAllGlobals());

function memoryFiles(): Platform["files"] {
  const files = new Map<string, Uint8Array>();
  return {
    read: async (path) => files.get(path) ?? null,
    write: async (path, data) => {
      files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
    },
    remove: async (path) => {
      files.delete(path);
    },
    list: async () => [],
  };
}

async function until(check: () => boolean | Promise<boolean>, what: string) {
  for (let i = 0; i < 1000; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function boot() {
  vi.resetModules();
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
  const fake = await import("@otter/core/fake");
  const core = await import("@otter/core");
  const sqlite = "node:sqlite";
  const { DatabaseSync } = (await import(/* @vite-ignore */ sqlite)) as {
    DatabaseSync: new (path: string) => SqlDatabase;
  };
  const database = new DatabaseSync(":memory:");
  const unused = () => {
    throw new Error("Not in this test.");
  };
  const platform = await fake.withFakeServices({
    kind: "web",
    appVersion: "test",
    log: () => {},
    database: () => database,
    files: memoryFiles(),
    secrets: { get: async () => null, set: async () => {}, delete: async () => {} },
    userFiles: { open: unused, save: unused, pick: unused },
    google: {} as Platform["google"],
    microsoft: {} as Platform["microsoft"],
    connect: unused,
    relayUrl: "",
    relaySession: "cookie",
    broadcast: () => {},
    notify: () => {},
    setUnreadCount: () => {},
    onResume: () => () => {},
    asyncContext: () => {
      let current: unknown;
      return {
        run: (value, fn) => {
          const before = current;
          current = value;
          try {
            return fn();
          } finally {
            current = before;
          }
        },
        get: () => current as never,
      };
    },
    offlineDownloads: false,
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { webExtensions } = await import("./extensions");
  await core.startCore(platform, webExtensions);
  const invoke = <T>(channel: string, params?: unknown) =>
    core.registeredHandlers().get(channel)!(params) as Promise<T>;
  // Another device's change, straight to the made-up Google Calendar.
  const google = (path: string, init: RequestInit = {}) =>
    fetch(`${EVENTS}${path}`, {
      ...init,
      headers: { Authorization: `Bearer demo:${EMAIL}`, "Content-Type": "application/json" },
    });
  return { invoke, google };
}

type Event = { id: string; title: string };
type Range = { events?: Event[]; error?: string };

describe("the calendars, synced into core", { timeout: 30_000 }, () => {
  it("draws from its copy, writes through it, and picks up changes made elsewhere", async () => {
    const { invoke, google } = await boot();
    const from = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const shown = async () => {
      const [range] = await invoke<Range[]>("calendar:listEvents", {
        calendars: [{ accountId: EMAIL, calendarId: "primary" }],
        from,
        to,
      });
      expect(range?.error).toBeUndefined();
      return range!.events!;
    };
    const titles = async () => (await shown()).map((e) => e.title);

    const [mine, theirs, gone, refused] = await shown();
    expect(refused).toBeDefined();

    expect(
      (await google(`/${theirs!.id}`, { method: "PATCH", body: '{"summary":"Moved elsewhere"}' }))
        .status,
    ).toBe(200);
    expect((await google(`/${gone!.id}`, { method: "DELETE" })).status).toBe(204);

    const saved = invoke<Event>("calendar:updateEvent", {
      accountId: EMAIL,
      calendarId: "primary",
      eventId: mine!.id,
      patch: { title: "Mine" },
    });
    expect(await titles()).toContain("Mine");
    expect((await saved).title).toBe("Mine");

    await until(async () => {
      const events = await shown();
      return (
        events.some((e) => e.title === "Moved elsewhere") && !events.some((e) => e.id === gone!.id)
      );
    }, "the changes made elsewhere");

    await google(`/${refused!.id}`, { method: "DELETE" });
    await expect(
      invoke("calendar:updateEvent", {
        accountId: EMAIL,
        calendarId: "primary",
        eventId: refused!.id,
        patch: { title: "Never saved" },
      }),
    ).rejects.toThrow(/404/);
    expect(await titles()).not.toContain("Never saved");
    await until(async () => !(await shown()).some((e) => e.id === refused!.id), "the deletion");
  });
});
