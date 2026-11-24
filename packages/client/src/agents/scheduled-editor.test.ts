import { describe, expect, it } from "vite-plus/test";
import type { AgentScheduledTasks, ScheduledTask, TaskRun } from "@otter/contracts/scheduled";
import {
  runDelivery,
  scheduledEmpty,
  taskCallout,
  taskProblem,
  taskSections,
  taskWhen,
} from "./agent-scheduled.ts";
import type { ProviderSnapshot } from "./api.ts";
import {
  modelOptions,
  pickDestination,
  resultsOptions,
  taskOwners,
  zoneOptions,
} from "./scheduled-editor.ts";

const NOW = Date.UTC(2026, 10, 24, 12);

const task = (id: string, over: Partial<ScheduledTask> = {}): ScheduledTask => ({
  provider: "oc",
  id,
  name: id,
  schedule: { kind: "every", everyMs: 3_600_000 },
  enabled: true,
  running: false,
  delivery: { kind: "none" },
  ...over,
});

const agent = (over: Partial<AgentScheduledTasks> = {}): AgentScheduledTasks => ({
  provider: "oc",
  tasks: [],
  channels: [
    { id: "slack", label: "Slack", accounts: ["work", "home"], defaultAccount: "home" },
    { id: "telegram", label: "Telegram", accounts: ["default"] },
  ],
  can: { create: true, deliverToOtter: true, webhooks: true, history: true, timeZones: true },
  ...over,
});

describe("the list", () => {
  it("sorts what's broken first, then what runs next, then what's off by name", () => {
    const { attention, active, paused, ordered } = taskSections([
      task("later", { nextRunAt: NOW + 2 }),
      task("off-b", { enabled: false }),
      task("broken", { lastRun: { at: NOW, status: "error" } }),
      task("sooner", { nextRunAt: NOW + 1 }),
      task("off-a", { enabled: false }),
      task("undeliverable", { deliveryProblem: "No chat" }),
    ]);
    expect(attention.map((t) => t.id)).toEqual(["broken", "undeliverable"]);
    expect(active.map((t) => t.id)).toEqual(["sooner", "later"]);
    expect(paused.map((t) => t.id)).toEqual(["off-a", "off-b"]);
    expect(ordered).toHaveLength(6);
  });

  it("says what shows instead of tasks", () => {
    const idle = { isLoading: false, isError: false };
    expect(scheduledEmpty({ isLoading: true, isError: false }, [], [])).toBe("loading");
    expect(scheduledEmpty({ isLoading: false, isError: true }, [], [])).toBe("error");
    expect(scheduledEmpty(idle, [], [])).toBe("no-agents");
    expect(scheduledEmpty(idle, [agent()], [])).toBe("nothing");
    expect(scheduledEmpty(idle, [agent({ error: "Offline" })], [])).toBe("no-match");
    expect(scheduledEmpty(idle, [agent({ tasks: [task("a")] })], [])).toBe("no-match");
    expect(scheduledEmpty(idle, [agent({ tasks: [task("a")] })], [task("a")])).toBeNull();
  });

  it("says first that it runs, then that the agent paused it, it failed, it's off, or when", () => {
    const failed = { at: NOW - 60_000, status: "error" } as const;
    expect(taskWhen(task("a", { running: true, autoPaused: "x" }), NOW)?.kind).toBe("running");
    expect(taskWhen(task("a", { autoPaused: "x", lastRun: failed }), NOW)?.kind).toBe(
      "auto-paused",
    );
    expect(taskWhen(task("a", { enabled: false, lastRun: failed }), NOW)?.kind).toBe("failed");
    expect(taskWhen(task("a", { enabled: false }), NOW)).toEqual({
      kind: "paused",
      text: "Paused",
    });
    expect(taskWhen(task("a"), NOW)).toBeNull();
    expect(taskWhen(task("a", { nextRunAt: NOW + 3_600_000 }), NOW)?.kind).toBe("next");
  });

  it("names what isn't working", () => {
    expect(taskProblem(task("a"))).toBeNull();
    expect(taskProblem(task("a", { autoPaused: "Too many failures", deliveryProblem: "x" }))).toBe(
      "Too many failures",
    );
    expect(taskProblem(task("a", { lastRun: { at: 0, status: "error", error: "Timeout" } }))).toBe(
      "The last run failed: Timeout",
    );
  });

  it("warns of a failed run only while it isn't running again", () => {
    const failed = task("a", { lastRun: { at: NOW - 60_000, status: "error", error: "Timeout" } });
    expect(taskCallout(failed, NOW)).toMatch(/^The last run failed .*: Timeout$/);
    expect(taskCallout({ ...failed, running: true }, NOW)).toBeNull();
    expect(taskCallout(task("a", { autoPaused: "It failed 3 times" }), NOW)).toBe(
      "It failed 3 times. Resume it once what failed is fixed.",
    );
  });
});

describe("a run's result", () => {
  const run = (over: Partial<TaskRun>): TaskRun => ({ id: "r", at: 0, status: "ok", ...over });

  it("says where it went, or why not", () => {
    expect(runDelivery(run({ silent: true, deliveryError: "x" }), agent())?.text).toBe(
      "It chose to send nothing this time.",
    );
    expect(
      runDelivery(
        run({ sentTo: { channel: "slack", to: "#ops" }, deliveryError: "No access" }),
        agent(),
      ),
    ).toEqual({ tone: "warning", text: "Couldn't send it to Slack #ops: No access" });
    expect(runDelivery(run({ delivered: false }), agent())?.text).toBe(
      "Its result wasn't delivered.",
    );
    expect(
      runDelivery(
        run({ delivered: true, sentTo: { channel: "hook", to: "https://example.com/x" } }),
        agent(),
      )?.text,
    ).toBe("Sent to hook example.com.");
    expect(runDelivery(run({ delivered: true, sentTo: { channel: "otter" } }), agent())?.text).toBe(
      "Sent to Otter.",
    );
    expect(runDelivery(run({}), agent())).toBeNull();
  });
});

describe("the editor", () => {
  const providers = [
    {
      id: "oc",
      kind: "openclaw",
      name: "Gateway",
      settings: {},
      models: [
        { slug: "main", name: "Main" },
        { slug: "ops", name: "Ops" },
      ],
    },
    { id: "hm", kind: "hermes", name: "Hermes", settings: {}, models: [{ slug: "m", name: "M" }] },
  ] as ProviderSnapshot[];

  it("offers each of a gateway's agents, and other agents whole", () => {
    const owners = taskOwners(
      [agent(), agent({ provider: "hm" }), agent({ provider: "ro", readOnly: "No access" })],
      providers,
      (kind) => kind === "openclaw",
    );
    expect(owners).toEqual([
      { provider: "oc", agent: "main", label: "Main · Gateway" },
      { provider: "oc", agent: "ops", label: "Ops · Gateway" },
      { provider: "hm", label: "Hermes" },
    ]);
  });

  it("leaves out a gateway's agents that are turned off, and the gateway when all are", () => {
    const off = (disabledAgents: string[]): ProviderSnapshot[] => [
      { ...providers[0]!, settings: { ...providers[0]!.settings, disabledAgents } },
      providers[1]!,
    ];
    const owners = (disabled: string[]) =>
      taskOwners([agent(), agent({ provider: "hm" })], off(disabled), (k) => k === "openclaw");
    expect(owners(["ops"])).toEqual([
      { provider: "oc", agent: "main", label: "Main · Gateway" },
      { provider: "hm", label: "Hermes" },
    ]);
    expect(owners(["main", "ops"])).toEqual([{ provider: "hm", label: "Hermes" }]);
  });

  it("offers where results can go, keeping where they go now when it can't say it", () => {
    const values = (t: ScheduledTask | null, a = agent()) =>
      resultsOptions(t, a).map((o) => o.value);
    expect(values(null)).toEqual([
      "new-chat",
      "channel:slack",
      "channel:telegram",
      "webhook",
      "off",
    ]);
    expect(values(task("a", { delivery: { kind: "otter", chat: "one" } }))).toEqual([
      "keep",
      "new-chat",
      "channel:slack",
      "channel:telegram",
      "webhook",
      "off",
    ]);
    expect(
      values(
        task("a", { undeliverable: true }),
        agent({ can: { ...agent().can, webhooks: false } }),
      ),
    ).toEqual(["off"]);
  });

  it("starts a channel with the task's recipient when it's the one it posts to, else its default account", () => {
    const posting = task("a", {
      delivery: {
        kind: "channel",
        channel: "slack",
        label: "Slack",
        to: "#ops",
        accountId: "work",
      },
    });
    const empty = { pick: "off", to: "", account: "", url: "" };
    expect(pickDestination(empty, "channel:slack", posting, agent())).toMatchObject({
      to: "#ops",
      account: "work",
    });
    expect(pickDestination(empty, "channel:slack", null, agent())).toMatchObject({
      to: "",
      account: "home",
    });
    expect(pickDestination(empty, "channel:telegram", null, agent())).toMatchObject({
      account: "",
    });
  });

  it("keeps a model or time zone it doesn't know listed", () => {
    expect(modelOptions({ agentModel: "a", models: [{ id: "a", name: "Alpha" }] }, "gone")).toEqual(
      [
        { value: "agent", label: "The agent's (Alpha)" },
        { value: "gone", label: "gone" },
        { value: "a", label: "Alpha" },
      ],
    );
    expect(zoneOptions("Mars/Base", ["Europe/Paris"]).map((o) => o.value)).toEqual([
      "agent",
      "Mars/Base",
      "Europe/Paris",
    ]);
    expect(zoneOptions("", ["America/New_York"])[1]).toEqual({
      value: "America/New_York",
      label: "America/New York",
    });
  });
});
