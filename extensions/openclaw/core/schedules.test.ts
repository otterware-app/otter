import { describe, expect, it } from "vite-plus/test";
import {
  READ_ONLY,
  channelTargets,
  deliveryChannels,
  cronError,
  listTasks,
  removeTask,
  runRows,
  saveTask,
  taskModels,
  taskOf,
  taskRuns,
  type CronGateway,
} from "./schedules.js";

// Shaped like a 2026.11 gateway's answers.
const brief = {
  id: "brief",
  name: "Morning brief",
  description: "Weekday inbox summary",
  enabled: true,
  createdAtMs: 1,
  updatedAtMs: 1,
  configRevision: "sha256:rev",
  schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
  sessionTarget: "isolated",
  wakeMode: "now",
  payload: { kind: "agentTurn", message: "Summarise my inbox", toolsAllow: ["*"] },
  delivery: { mode: "announce", channel: "otter", to: "chat:new" },
  state: { nextRunAtMs: 2000 },
};
const heartbeat = {
  id: "hb",
  name: "heartbeat-dev",
  displayName: "Heartbeat (dev)",
  declarationKey: "heartbeat:dev",
  agentId: "dev",
  enabled: true,
  schedule: { kind: "every", everyMs: 1_800_000, anchorMs: 5 },
  sessionTarget: "main",
  payload: { kind: "heartbeat" },
  delivery: null,
  state: { nextRunAtMs: 3000 },
};
const dreaming = {
  id: "dream",
  name: "Memory Dreaming Promotion",
  declarationKey: "memory-core:memory-dreaming-promotion",
  description: "[managed-by=memory-core.short-term-promotion] Promote recalls into MEMORY.md.",
  enabled: true,
  schedule: { kind: "cron", expr: "0 3 * * *" },
  payload: { kind: "agentTurn", message: "__openclaw_memory_core_short_term_promotion_dream__" },
  delivery: { mode: "none" },
  state: {},
};

function fakeGateway(
  answer: (method: string, params: Record<string, unknown>) => unknown,
  scopes = ["operator.read", "operator.admin"],
) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const g: CronGateway = {
    scopes,
    otterChannel: true,
    async request<T>(method: string, params: unknown) {
      const p = params as Record<string, unknown>;
      calls.push({ method, params: p });
      const result = answer(method, p);
      if (result instanceof Error) throw result;
      return result as T;
    },
  };
  return { g, calls };
}

describe("taskOf", () => {
  it("belongs to the chat it was made in and the chat it posts to", () => {
    const made = "agent:main:otter-mail:c-1";
    const job = (to: string) => ({
      ...brief,
      sessionKey: made,
      delivery: { mode: "announce", channel: "otter", to },
    });
    expect(taskOf(job("chat:agent:main:otter-mail:c-2") as never, "main").chats).toEqual([
      made,
      "agent:main:otter-mail:c-2",
    ]);
    expect(taskOf(job(`chat:${made}`) as never, "main").chats).toEqual([made]);
    expect(taskOf(job("chat:new") as never, "main").chats).toEqual([made]);
    expect(taskOf(job("otter:chat:agent:main:otter-mail:c-2") as never, "main").chats).toEqual([
      made,
      "agent:main:otter-mail:c-2",
    ]);
    expect(taskOf(brief as never, "main").chats).toBeUndefined();
  });

  it("reads a job the way the app shows it", () => {
    expect(taskOf(brief as never, "main")).toEqual({
      provider: "openclaw",
      id: "brief",
      agent: "main",
      name: "Morning brief",
      description: "Weekday inbox summary",
      prompt: "Summarise my inbox",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      enabled: true,
      running: false,
      nextRunAt: 2000,
      delivery: { kind: "otter", chat: "new" },
      revision: "sha256:rev",
    });
  });

  it("says the model a job runs on when it has one of its own", () => {
    const own = { ...brief, payload: { ...brief.payload, model: "openai/gpt-6.2-sol" } };
    expect(taskOf(own as never, "main").model).toBe("openai/gpt-6.2-sol");
    expect(taskOf(brief as never, "main")).not.toHaveProperty("model");
  });

  it("marks OpenClaw's own jobs, and hides their internal messages", () => {
    const hb = taskOf(heartbeat as never, "main");
    expect(hb).toMatchObject({
      name: "Heartbeat (dev)",
      agent: "dev",
      managedBy: "OpenClaw's heartbeat",
      delivery: { kind: "none" },
      schedule: { kind: "every", everyMs: 1_800_000 },
    });
    expect(hb.prompt).toBeUndefined();
    const dream = taskOf(dreaming as never, "main");
    expect(dream.managedBy).toBe("OpenClaw (memory-core)");
    expect(dream.prompt).toBeUndefined();
    expect(dream.description).toBe("Promote recalls into MEMORY.md.");
  });

  it("says where a result goes, on any channel", () => {
    const labels = { telegram: "Telegram", slack: "Slack" };
    const at = (delivery: unknown, preview?: { label?: string; detail?: string }) =>
      taskOf({ ...brief, delivery } as never, "main", preview, labels).delivery;
    expect(at({ mode: "announce", channel: "otter", to: "chat:agent:main:abc" })).toEqual({
      kind: "otter",
      chat: "one",
    });
    for (const to of ["chat:new", "otter:chat:new", "owner", "otter:owner"])
      expect(at({ mode: "announce", channel: "otter", to })).toEqual({
        kind: "otter",
        chat: "new",
      });
    expect(at({ mode: "announce", channel: "otter", to: "otter:chat:agent:main:abc" })).toEqual({
      kind: "otter",
      chat: "one",
    });
    expect(
      at({ mode: "announce", channel: "slack", to: "channel:C0123", accountId: "work" }),
    ).toEqual({
      kind: "channel",
      channel: "slack",
      label: "Slack",
      to: "channel:C0123",
      accountId: "work",
    });
    expect(at({ mode: "announce", channel: "telegram", to: "-100123", threadId: 42 })).toEqual({
      kind: "channel",
      channel: "telegram",
      label: "Telegram",
      to: "-100123",
      threadId: "42",
    });
    expect(at({ mode: "announce", channel: "matrix", to: "room:!a:b" })).toMatchObject({
      label: "Matrix",
    });
    expect(at({ mode: "announce" }, { label: "announce -> telegram:123" })).toEqual({
      kind: "channel",
      channel: "last",
      label: "The last conversation",
      to: "telegram:123",
    });
    expect(at({ mode: "webhook", to: "https://hooks.example.com/x" })).toEqual({
      kind: "webhook",
      url: "https://hooks.example.com/x",
    });
    expect(at({ mode: "none" })).toEqual({ kind: "none" });
  });

  it("says why a result won't arrive, and where failures are reported", () => {
    const task = taskOf(
      {
        ...brief,
        delivery: {
          mode: "announce",
          failureDestination: { mode: "announce", channel: "slack", to: "channel:COPS" },
        },
      } as never,
      "main",
      {
        label: "announce -> last",
        detail: "last -> no route, will be blocked: Channel is required",
      },
      { slack: "Slack" },
    );
    expect(task.deliveryProblem).toBe("Channel is required.");
    expect(
      taskOf({ ...brief, delivery: { mode: "announce" } } as never, "main", {
        label: "announce -> last",
        detail:
          "last -> no route, will be blocked: Channel is required when multiple channels are configured: telegram, otter. Pass --channel <channel> to choose one.",
      }).deliveryProblem,
    ).toMatch(/more than one channel/);
    expect(
      taskOf({ ...brief, delivery: { mode: "announce", channel: "telegram" } } as never, "main", {
        label: "announce -> telegram",
        detail:
          'Delivering to Telegram requires target <chatId> Configure a channel and delivery target, or use delivery:{mode:"none"} for no automatic delivery.',
      }).deliveryProblem,
    ).toBe("Delivering to Telegram requires target <chatId>.");
    expect(
      taskOf(
        { ...brief, delivery: { mode: "announce", channel: "telegram", to: "x" } } as never,
        "main",
        {
          label: "announce -> telegram:x",
          detail: 'Unknown target "x" for Telegram. Configure a channel and delivery target.',
        },
      ).deliveryProblem,
    ).toBe('Unknown target "x" for Telegram.');
    for (const to of [undefined, "inbox", "chat:not-a-session"]) {
      const unnamed = taskOf(
        { ...brief, delivery: { mode: "announce", channel: "otter", to } } as never,
        "main",
      );
      expect(unnamed.delivery.kind).toBe("elsewhere");
      expect(unnamed.deliveryProblem).toMatch(/no Otter chat/);
    }
    expect(task.failureAlerts).toBe("Slack channel:COPS");
    expect(
      taskOf(
        { ...brief, failureAlert: { after: 3, mode: "webhook", to: "https://h.io/x" } } as never,
        "main",
      ).failureAlerts,
    ).toBe("a webhook (h.io), after 3 failed runs in a row");
    expect(taskOf({ ...brief, failureAlert: false } as never, "main").failureAlerts).toBe("Off");
  });

  it("says what a job runs when it isn't a message, and that it can't post to a chat", () => {
    const command = taskOf(
      {
        ...brief,
        payload: { kind: "command", argv: ["npm", "test"] },
        trigger: { script: "check.sh" },
      } as never,
      "main",
    );
    expect(command).toMatchObject({
      runs: "Runs npm test",
      conditional: true,
      undeliverable: true,
    });
    expect(command.prompt).toBeUndefined();
  });

  it("reports a running job, its last failure, and a pause OpenClaw made", () => {
    const task = taskOf(
      {
        ...brief,
        enabled: false,
        state: {
          nextRunAtMs: 9,
          runningAtMs: 5,
          lastRunAtMs: 4,
          lastRunStatus: "error",
          lastError: "raw | invalid_api_key",
          lastDiagnosticSummary: "Couldn't sign in to the AI service.",
          lastDurationMs: 2144,
          autoDisabled: { reason: "consecutive-failures", atMs: 4, consecutiveErrors: 3 },
        },
      } as never,
      "main",
    );
    expect(task.running).toBe(true);
    expect(task.nextRunAt).toBeUndefined();
    expect(task.lastRun).toEqual({
      at: 4,
      status: "error",
      error: "Couldn't sign in to the AI service.",
      durationMs: 2144,
    });
    expect(task.autoPaused).toBe("Paused by OpenClaw after 3 failed runs in a row");
  });

  it("knows a task in a shared session can't send its results anywhere", () => {
    expect(taskOf({ ...brief, sessionTarget: "main" } as never, "main").undeliverable).toBe(true);
    expect(
      taskOf({ ...brief, sessionTarget: "current" } as never, "main").undeliverable,
    ).toBeUndefined();
    expect(taskOf(brief as never, "main").undeliverable).toBeUndefined();
  });

  it("describes schedules Otter can't edit", () => {
    expect(
      taskOf({ ...brief, schedule: { kind: "on-exit", command: "make" } } as never, "main")
        .schedule,
    ).toEqual({ kind: "other", text: "When make exits" });
  });
});

describe("listTasks", () => {
  it("asks for paused jobs too, and pages through them", async () => {
    const { g, calls } = fakeGateway((_method, params) =>
      params.offset === 0
        ? { jobs: [brief], hasMore: true, nextOffset: 1 }
        : {
            jobs: [heartbeat],
            hasMore: false,
            nextOffset: null,
            deliveryPreviews: { hb: { detail: "not requested" } },
          },
    );
    const listed = await listTasks(g, "main");
    expect(calls.filter((c) => c.method === "cron.list").map((c) => c.params)).toEqual([
      expect.objectContaining({ includeDisabled: true, offset: 0 }),
      expect.objectContaining({ includeDisabled: true, offset: 1 }),
    ]);
    expect(listed.tasks.map((t) => t.id)).toEqual(["brief", "hb"]);
    expect(listed.readOnly).toBeUndefined();
    expect(listed.can).toEqual({
      create: true,
      deliverToOtter: true,
      webhooks: true,
      history: true,
      timeZones: true,
    });
  });

  it("is read-only without operator.admin", async () => {
    const { g } = fakeGateway(() => ({ jobs: [] }), ["operator.read"]);
    const listed = await listTasks(g, "main");
    expect(listed.readOnly).toBe(READ_ONLY);
    expect(listed.can.create).toBe(false);
  });
});

describe("saveTask", () => {
  it("adds an isolated agent turn, delivered to a new Otter chat", async () => {
    const { g, calls } = fakeGateway(() => ({ id: "new" }));
    await saveTask(g, null, {
      name: "Brief",
      prompt: "Summarise",
      agent: "rowan",
      schedule: { kind: "cron", expr: "0 8 * * *", tz: "Europe/London" },
      resultsTo: { kind: "new-chat" },
    });
    expect(calls).toEqual([
      {
        method: "cron.add",
        params: {
          name: "Brief",
          agentId: "rowan",
          sessionTarget: "isolated",
          wakeMode: "now",
          schedule: { kind: "cron", expr: "0 8 * * *", tz: "Europe/London" },
          payload: { kind: "agentTurn", message: "Summarise" },
          delivery: { mode: "announce", channel: "otter", to: "chat:new" },
        },
      },
    ]);
  });

  it("keeps a one-off's result nowhere but the gateway unless asked, and removes it after it runs", async () => {
    const { g, calls } = fakeGateway(() => ({}));
    await saveTask(g, null, {
      name: "Once",
      prompt: "Do it",
      schedule: { kind: "at", at: "2026-12-01T09:00:00.000Z" },
    });
    expect(calls[0].params).toMatchObject({
      schedule: { kind: "at", at: "2026-12-01T09:00:00.000Z" },
      deleteAfterRun: true,
      delivery: { mode: "none" },
    });
  });

  it("patches only what changed, against the version it read", async () => {
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? brief : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      prompt: "Summarise my inbox and calendar",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      resultsTo: { kind: "off" },
    });
    expect(calls[1]).toEqual({
      method: "cron.update",
      params: {
        id: "brief",
        patch: {
          payload: {
            kind: "agentTurn",
            message: "Summarise my inbox and calendar",
            toolsAllow: ["*"],
          },
          delivery: {
            mode: "none",
            channel: null,
            to: null,
            accountId: null,
            threadId: null,
            completionDestination: null,
          },
        },
        expectedConfigRevision: "sha256:rev",
      },
    });
  });

  it("won't overwrite a change made on the gateway since the editor opened", async () => {
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? brief : {}));
    await expect(
      saveTask(g, "brief", {
        name: "Renamed",
        schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
        revision: "sha256:older",
      }),
    ).rejects.toThrow(/changed on the gateway/);
    await saveTask(g, "brief", {
      name: "Renamed",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      revision: "sha256:rev",
    });
    expect(calls.at(-1)?.params).toMatchObject({
      patch: { name: "Renamed" },
      expectedConfigRevision: "sha256:rev",
    });
  });

  it("keeps a one-off removing itself after it runs, and a repeating task staying", async () => {
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? brief : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      schedule: { kind: "at", at: "2026-12-01T09:00:00.000Z" },
    });
    expect(calls[1].params.patch).toMatchObject({ deleteAfterRun: true });
    const once = { ...brief, schedule: { kind: "at", at: "2026-12-01T09:00:00.000Z" } };
    const later = fakeGateway((method) => (method === "cron.get" ? once : {}));
    await saveTask(later.g, "brief", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 9 * * *" },
    });
    expect(later.calls[1].params.patch).toMatchObject({ deleteAfterRun: false });
  });

  it("keeps a chat's own delivery unless asked to change it", async () => {
    const inChat = {
      ...brief,
      sessionTarget: "current",
      sessionKey: "agent:main:abc",
      delivery: { mode: "announce", channel: "otter", to: "chat:agent:main:abc" },
    };
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? inChat : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
    });
    expect(calls.map((c) => c.method)).toEqual(["cron.get"]);
    await saveTask(g, "brief", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      resultsTo: { kind: "new-chat" },
    });
    expect(calls.at(-1)?.params.patch).toMatchObject({
      delivery: { channel: "otter", to: "chat:new" },
    });
  });

  it("keeps a stagger of zero", async () => {
    const exact = { ...brief, schedule: { ...brief.schedule, staggerMs: 0 } };
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? exact : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 7 * * 1-5", tz: "Europe/Paris" },
    });
    expect(calls[1].params.patch).toMatchObject({ schedule: { staggerMs: 0 } });
  });

  it("keeps a cron job's stagger when its time changes", async () => {
    const staggered = { ...brief, schedule: { ...brief.schedule, staggerMs: 30_000 } };
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? staggered : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 7 * * 1-5", tz: "Europe/Paris" },
    });
    expect(calls[1].params.patch).toEqual({
      schedule: { kind: "cron", expr: "0 7 * * 1-5", tz: "Europe/Paris", staggerMs: 30_000 },
    });
  });

  it("moves results to another target, dropping only what pointed at the old one", async () => {
    const telegram = {
      ...brief,
      delivery: {
        mode: "announce",
        channel: "telegram",
        to: "123",
        threadId: 7,
        failureDestination: { channel: "telegram", to: "123" },
      },
    };
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? telegram : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      resultsTo: { kind: "new-chat" },
    });
    expect(calls[1].params.patch).toEqual({
      delivery: {
        mode: "announce",
        channel: "otter",
        to: "chat:new",
        accountId: null,
        threadId: null,
      },
    });
    await saveTask(g, "brief", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      resultsTo: { kind: "channel", channel: "slack", to: "channel:C0123", accountId: "work" },
    });
    expect(calls.at(-1)?.params.patch).toEqual({
      delivery: {
        mode: "announce",
        channel: "slack",
        to: "channel:C0123",
        accountId: "work",
        threadId: null,
      },
    });
    await saveTask(g, "brief", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      resultsTo: { kind: "webhook", url: "https://hooks.example.com/x" },
    });
    expect(calls.at(-1)?.params.patch).toEqual({
      delivery: {
        mode: "webhook",
        to: "https://hooks.example.com/x",
        channel: null,
        accountId: null,
        threadId: null,
        completionDestination: null,
      },
    });
  });

  it("keeps a forum topic when only the account changes", async () => {
    const topic = {
      ...brief,
      delivery: {
        mode: "announce",
        channel: "telegram",
        to: "-100123",
        threadId: 7,
        accountId: "a",
      },
    };
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? topic : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      resultsTo: { kind: "channel", channel: "telegram", to: "-100123", accountId: "b" },
    });
    expect(calls[1].params.patch).toEqual({
      delivery: { mode: "announce", channel: "telegram", to: "-100123", accountId: "b" },
    });
  });

  it("leaves results alone when they already go there", async () => {
    const slack = {
      ...brief,
      delivery: { mode: "announce", channel: "slack", to: "channel:C0123", accountId: "work" },
    };
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? slack : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      resultsTo: { kind: "channel", channel: "slack", to: "channel:C0123", accountId: "work" },
    });
    expect(calls.map((c) => c.method)).toEqual(["cron.get"]);
  });

  it("creates a job posting to a channel", async () => {
    const { g, calls } = fakeGateway(() => ({ id: "new" }));
    await saveTask(g, null, {
      name: "Brief",
      prompt: "Go",
      schedule: { kind: "every", everyMs: 3_600_000 },
      resultsTo: { kind: "channel", channel: "telegram", to: "@me" },
    });
    expect(calls[0].params.delivery).toEqual({ mode: "announce", channel: "telegram", to: "@me" });
  });

  it("says the id of what it saved", async () => {
    const { g } = fakeGateway((method) => (method === "cron.add" ? { id: "made" } : brief));
    expect(
      await saveTask(g, null, {
        name: "x",
        prompt: "y",
        schedule: { kind: "every", everyMs: 60_000 },
      }),
    ).toBe("made");
    expect(
      await saveTask(g, "brief", {
        name: "Morning brief",
        schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      }),
    ).toBe("brief");
  });

  it("sends nothing when nothing changed", async () => {
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? brief : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      prompt: "Summarise my inbox",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Paris" },
      resultsTo: { kind: "new-chat" },
    });
    expect(calls.map((c) => c.method)).toEqual(["cron.get"]);
  });

  it("changes the schedule when only its time zone changed", async () => {
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? brief : {}));
    await saveTask(g, "brief", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "America/New_York" },
    });
    expect(calls[1].params.patch).toEqual({
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "America/New_York" },
    });
  });

  it("gives a new job a model of its own", async () => {
    const { g, calls } = fakeGateway(() => ({ id: "new" }));
    await saveTask(g, null, {
      name: "Brief",
      prompt: "Summarise",
      schedule: { kind: "every", everyMs: 3_600_000 },
      model: "openai/gpt-6.2-sol",
    });
    expect(calls[0].params.payload).toEqual({
      kind: "agentTurn",
      message: "Summarise",
      model: "openai/gpt-6.2-sol",
    });
  });

  it("changes a job's model, or puts it back on its agent's", async () => {
    const own = { ...brief, payload: { ...brief.payload, model: "openai/gpt-6.2-sol" } };
    const edit = { name: "Morning brief", schedule: brief.schedule as never };
    let job: object = brief;
    const { g, calls } = fakeGateway((method) => (method === "cron.get" ? job : {}));
    await saveTask(g, "brief", { ...edit, model: "openai/gpt-6.2-sol" });
    expect(calls[1].params.patch).toEqual({ payload: own.payload });
    job = own;
    await saveTask(g, "brief", { ...edit, model: null });
    expect(calls[3].params.patch).toEqual({ payload: { ...own.payload, model: null } });
    await saveTask(g, "brief", { ...edit, model: "openai/gpt-6.2-sol" });
    await saveTask(g, "brief", edit);
    expect(calls.slice(4).map((c) => c.method)).toEqual(["cron.get", "cron.get"]);
  });

  it("won't change or delete OpenClaw's own jobs", async () => {
    const { g, calls } = fakeGateway(() => heartbeat);
    await expect(
      saveTask(g, "hb", { name: "x", schedule: { kind: "every", everyMs: 60_000 } }),
    ).rejects.toThrow(/paused or run/);
    await expect(removeTask(g, "hb")).rejects.toThrow(/pause it instead/);
    expect(calls.every((c) => c.method === "cron.get")).toBe(true);
  });
});

describe("runs", () => {
  it("lists a job's runs, newest first, with why one failed", async () => {
    const { g, calls } = fakeGateway(() => ({
      entries: [
        {
          ts: 10,
          jobId: "brief",
          action: "finished",
          status: "error",
          error: "raw | invalid_api_key",
          diagnostics: { summary: "Couldn't sign in to the AI service." },
          runId: "cron-request.1",
          runAtMs: 8,
          durationMs: 2144,
          model: "gpt-6-astra",
          deliveryStatus: "not-delivered",
          delivery: {
            resolved: { channel: "slack", to: "channel:C0123", ok: false, error: "not_in_channel" },
          },
        },
        {
          ts: 5,
          jobId: "brief",
          action: "finished",
          status: "ok",
          summary: "All quiet",
          deliveryStatus: "unknown",
        },
        {
          ts: 4,
          jobId: "brief",
          action: "finished",
          status: "ok",
          delivery: { resolved: { channel: "telegram", to: "@me", ok: true } },
        },
        {
          ts: 3,
          jobId: "brief",
          action: "finished",
          status: "ok",
          deliveryStatus: "not-delivered",
          deliverySuppressionReason: "silent",
        },
      ],
    }));
    expect(await taskRuns(g, "brief", 20)).toEqual([
      {
        id: "cron-request.1",
        at: 8,
        status: "error",
        durationMs: 2144,
        error: "Couldn't sign in to the AI service.",
        model: "gpt-6-astra",
        sentTo: { channel: "slack", to: "channel:C0123" },
        deliveryError: "not_in_channel",
        delivered: false,
      },
      { id: "at:5", at: 5, status: "ok", summary: "All quiet" },
      {
        id: "at:4",
        at: 4,
        status: "ok",
        sentTo: { channel: "telegram", to: "@me" },
        delivered: true,
      },
      { id: "at:3", at: 3, status: "ok", silent: true },
    ]);
    expect(calls[0].params).toEqual({ id: "brief", limit: 20, sortDir: "desc" });
  });

  it("shows a run's job message as what was asked, without the scheduler's preamble", async () => {
    const { g, calls } = fakeGateway(() => ({
      messages: [
        {
          role: "assistant",
          content:
            "Summarise my inbox\nCurrent time: Sunday\n\nThis is an unattended scheduled run.",
          provenance: { kind: "internal_system", sourceTool: "cron" },
        },
        { role: "assistant", content: [{ type: "text", text: "Done" }] },
      ],
    }));
    const rows = await runRows(g, "brief", "at:5");
    expect(calls[0].params).toEqual({ id: "brief", runAtMs: 5, limit: 200 });
    expect(rows[0]).toMatchObject({ role: "user", content: "Summarise my inbox" });
    expect(rows[0]).not.toHaveProperty("provenance");
    expect(rows[1].role).toBe("assistant");
  });

  it("reads a long run's every page", async () => {
    const { g, calls } = fakeGateway((_method, params) =>
      params.cursor
        ? { messages: [{ role: "assistant", content: "two" }] }
        : { messages: [{ role: "assistant", content: "one" }], nextCursor: "c2" },
    );
    const rows = await runRows(g, "brief", "cron-request.1");
    expect(rows.map((r) => r.content)).toEqual(["one", "two"]);
    expect(calls[1].params).toMatchObject({ runId: "cron-request.1", cursor: "c2" });
  });

  // OTTER-MAIL-DESKTOP-N: what a 2026.11 gateway answers for a heartbeat's run.
  it("has no rows for a run without a recorded transcript", async () => {
    const { g } = fakeGateway(
      () =>
        new Error("The recorded cron transcript is unavailable. Refresh the run and try again."),
    );
    await expect(runRows(g, "brief", "at:5")).resolves.toEqual([]);
  });

  it("still fails when the gateway can't answer", async () => {
    const { g } = fakeGateway(() => new Error("cron.history unavailable during gateway restart"));
    await expect(runRows(g, "brief", "at:5")).rejects.toThrow("during gateway restart");
  });
});

describe("channels", () => {
  it("offers each set-up chat app and the accounts it sends from, Otter apart", async () => {
    const { g } = fakeGateway(() => ({
      channelOrder: ["otter", "slack", "telegram", "discord"],
      channelLabels: { slack: "Slack", telegram: "Telegram" },
      channelMeta: [
        { id: "otter", label: "Otter", detailLabel: "Otter" },
        { id: "slack", label: "Slack", detailLabel: "Slack" },
        { id: "telegram", label: "Telegram", detailLabel: "Telegram Bot" },
        { id: "discord", label: "Discord", detailLabel: "Discord" },
      ],
      channelAccounts: {
        otter: [{ accountId: "default", enabled: true, configured: true }],
        slack: [
          { accountId: "work", enabled: true, configured: true },
          { accountId: "home", enabled: true, configured: true },
          { accountId: "old", enabled: false, configured: true },
        ],
        telegram: [{ accountId: "default", enabled: true, configured: true }],
        discord: [{ accountId: "default", enabled: true, configured: false }],
      },
      channelDefaultAccountId: { slack: "work", telegram: "default" },
    }));
    const { channels, labels } = await deliveryChannels(g);
    expect(channels).toEqual([
      { id: "slack", label: "Slack", accounts: ["work", "home"], defaultAccount: "work" },
      { id: "telegram", label: "Telegram", accounts: ["default"], defaultAccount: "default" },
    ]);
    expect(labels.discord).toBe("Discord");
  });

  it("has none when the gateway won't say", async () => {
    const { g } = fakeGateway(() => new Error("unknown method"));
    expect((await deliveryChannels(g)).channels).toEqual([]);
  });

  it("suggests who on a channel results could go to", async () => {
    const { g, calls } = fakeGateway(() => ({
      conversations: [
        { target: "channel:C1", label: "#ops", accountId: "work" },
        { target: "channel:C1", label: "#ops", accountId: "work" },
        { target: "user:U2", accountId: "home" },
        { label: "no target" },
      ],
    }));
    expect(await channelTargets(g, "rowan", "slack")).toEqual([
      { target: "channel:C1", label: "#ops", accountId: "work" },
      { target: "user:U2", accountId: "home" },
    ]);
    expect(calls[0]).toEqual({
      method: "conversations.list",
      params: { agentId: "rowan", channel: "slack", limit: 100 },
    });
  });
});

describe("taskModels", () => {
  it("offers the models the gateway has for the agent, and says which it runs on", async () => {
    const { g, calls } = fakeGateway((method) =>
      method === "models.list"
        ? {
            models: [
              { id: "gpt-6.1-sol", name: "GPT-6.1-Sol", provider: "openai" },
              { id: "kimi-k2", name: "Kimi K2", provider: "openrouter", available: true },
              { id: "opus", name: "Opus", provider: "anthropic", available: false },
            ],
          }
        : { agents: [{ id: "main", model: { primary: "openai/gpt-6.1-sol" } }, { id: "rowan" }] },
    );
    expect(await taskModels(g, "main")).toEqual({
      agentModel: "openai/gpt-6.1-sol",
      models: [
        { id: "openai/gpt-6.1-sol", name: "GPT-6.1-Sol" },
        { id: "openrouter/kimi-k2", name: "Kimi K2" },
      ],
    });
    expect(calls[0]).toEqual({
      method: "models.list",
      params: { agentId: "main", view: "default" },
    });
    expect(await taskModels(g, "rowan")).not.toHaveProperty("agentModel");
  });
});

describe("cronError", () => {
  const gatewayError = (message: string, code?: string) =>
    Object.assign(new Error(message), code ? { details: { code } } : {});

  it("says each refusal for people", () => {
    expect(cronError(gatewayError("missing scope: operator.admin")).message).toBe(READ_ONLY);
    expect(cronError(gatewayError("Automation not found: x.", "CRON_JOB_NOT_FOUND")).message).toBe(
      "That task is gone from the gateway.",
    );
    expect(cronError(gatewayError("no longer matches", "CRON_JOB_CHANGED")).message).toMatch(
      /changed on the gateway/,
    );
    expect(
      cronError(
        gatewayError("invalid cron.add params: delivery.channel is not a known channel: otter"),
      ).message,
    ).toMatch(/Messages from your agents/);
    expect(cronError(gatewayError("invalid cron.add params: bad expr")).message).toBe("bad expr");
  });
});
