import { describe, expect, it, vi } from "vite-plus/test";

const task = {
  provider: "openclaw",
  id: "brief",
  name: "Brief",
  schedule: { kind: "cron", expr: "0 8 * * *" },
  enabled: true,
  running: false,
  delivery: { kind: "none" },
};
const can = { create: true, deliverToOtter: true, history: true, timeZones: true };
const save = vi.fn(async () => "brief");
const kind = (name: string, provider: object, enabled = true) => ({
  kind: name,
  displayName: name,
  defaults: { enabled, model: "" },
  create: () => provider,
});
const types = new Map<string, unknown>([
  [
    "openclaw",
    kind("openclaw", { schedules: { list: async () => ({ tasks: [task], can }), save } }),
  ],
  [
    "hermes",
    kind("hermes", {
      schedules: {
        list: async () => {
          throw new Error("Can't reach Hermes.");
        },
      },
    }),
  ],
  ["unset", kind("unset", { schedules: { list: async () => null } })],
  ["off", kind("off", { schedules: { list: vi.fn() } }, false)],
  ["claude", kind("claude", {})],
]);
const entry = (id: string, kindName: string, name: string) => ({
  id,
  kind: kindName,
  name,
  settings: {},
});
vi.mock("../../extensions.js", () => ({ registeredAgents: () => types }));
vi.mock("./settings.js", () => ({
  agentSecrets: () => ({}),
  getProviderSettings: async () => ({
    selected: "home",
    agents: [
      entry("home", "openclaw", "Home"),
      entry("brokk", "hermes", "brokk"),
      entry("u", "unset", "Unset"),
      entry("o", "off", "Off"),
      entry("cc", "claude", "Claude Code"),
      entry("gone", "uninstalled", "Elsewhere"),
    ],
  }),
}));

const { listScheduledTasks, saveScheduledTask, runScheduledTask } = await import("./service.js");
const { scheduledTaskInputOf } = await import("../../handlers/agent.js");

describe("scheduled tasks across agents", () => {
  it("lists each enabled, set-up agent that schedules, and says which couldn't be read", async () => {
    expect(await listScheduledTasks()).toEqual([
      { provider: "home", tasks: [{ ...task, provider: "home" }], can },
      {
        provider: "brokk",
        tasks: [],
        error: "Can't reach Hermes.",
        channels: [],
        can: {
          create: false,
          deliverToOtter: false,
          webhooks: false,
          history: false,
          timeZones: false,
        },
      },
    ]);
  });

  it("routes a change to its agent", async () => {
    const input = { name: "Brief", prompt: "Go", schedule: { kind: "every", everyMs: 60_000 } };
    await saveScheduledTask("home", "brief", input as never);
    expect(save).toHaveBeenCalledWith({ enabled: true, model: "" }, "brief", input);
    await expect(runScheduledTask("cc", "x")).rejects.toThrow(
      "Claude Code doesn't run scheduled tasks.",
    );
    await expect(runScheduledTask("gone", "x")).rejects.toThrow("isn't on this device");
  });
});

describe("a task as the app sends it", () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();

  it("is cleaned up", () => {
    expect(
      scheduledTaskInputOf({
        name: "  Brief ",
        prompt: " Go ",
        schedule: { kind: "cron", expr: " 0 8 * * 1-5 ", tz: "Europe/Paris" },
        agent: "rowan",
        resultsTo: { kind: "new-chat" },
        extra: "ignored",
      }),
    ).toEqual({
      name: "Brief",
      prompt: "Go",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      agent: "rowan",
      resultsTo: { kind: "new-chat" },
    });
    expect(scheduledTaskInputOf({ name: "x", schedule: { kind: "at", at: future } })).toEqual({
      name: "x",
      schedule: { kind: "at", at: future },
    });
  });

  it("keeps, on an edit, a schedule the app wouldn't let you pick", () => {
    expect(
      scheduledTaskInputOf({ name: "x", schedule: { kind: "every", everyMs: 30_000 } }, true)
        .schedule,
    ).toEqual({ kind: "every", everyMs: 30_000 });
    expect(
      scheduledTaskInputOf(
        { name: "x", schedule: { kind: "at", at: "2001-01-01T00:00:00Z" } },
        true,
      ).schedule,
    ).toEqual({ kind: "at", at: "2001-01-01T00:00:00.000Z" });
  });

  it("says where results go only when that's complete", () => {
    const base = { name: "x", schedule: { kind: "every", everyMs: 60_000 } };
    expect(
      scheduledTaskInputOf({
        ...base,
        resultsTo: { kind: "channel", channel: " slack ", to: " channel:C1 ", accountId: "work" },
      }).resultsTo,
    ).toEqual({ kind: "channel", channel: "slack", to: "channel:C1", accountId: "work" });
    expect(
      scheduledTaskInputOf({ ...base, resultsTo: { kind: "webhook", url: "https://h.io/x" } })
        .resultsTo,
    ).toEqual({ kind: "webhook", url: "https://h.io/x" });
    expect(() =>
      scheduledTaskInputOf({ ...base, resultsTo: { kind: "channel", channel: "slack", to: "" } }),
    ).toThrow(/who on it/);
    expect(() =>
      scheduledTaskInputOf({ ...base, resultsTo: { kind: "webhook", url: "ftp://h.io" } }),
    ).toThrow(/http/);
    expect(() => scheduledTaskInputOf({ ...base, resultsTo: "off" })).toThrow(/where its results/);
  });

  it("is refused when it can't run", () => {
    const at =
      (schedule: unknown, extra: Record<string, unknown> = {}) =>
      () =>
        scheduledTaskInputOf({ name: "x", prompt: "y", schedule, ...extra });
    expect(at({ kind: "cron", expr: "0 8 *" })).toThrow(/incomplete/);
    expect(at({ kind: "every", everyMs: 1000 })).toThrow(/when it runs/);
    expect(at({ kind: "at", at: "2001-01-01T00:00:00Z" })).toThrow(/future/);
    expect(at({ kind: "other", text: "x" })).toThrow(/when it runs/);
    expect(at({ kind: "cron", expr: "0 8 * * *" }, { name: " " })).toThrow(/name/);
    expect(at({ kind: "cron", expr: "0 8 * * *" }, { prompt: "  " })).toThrow(/should do/);
  });
});
