/**
 * The made-up agents' scheduled tasks: what each runs on its own, with a history, as a gateway
 * keeps them (OpenClaw's own jobs among them). rata's fail to load and varys's can't be changed.
 * Kept while the app runs; they start over with it.
 */
import type {
  AgentScheduledTasks,
  ScheduledTask,
  ScheduledTaskInput,
  TaskDelivery,
  TaskModels,
  TaskRun,
} from "@otter/contracts/scheduled";

import type {
  AgentSettings,
  ChatSessionMessage,
  ScheduleSupport,
} from "../services/agent/types.ts";
import { DEMO_AGENTS, PLANNING_PACK_SESSION } from "./chats.ts";

type Task = Omit<ScheduledTask, "provider">;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const toOtter: TaskDelivery = { kind: "otter", chat: "new" };
const slack = (to: string): TaskDelivery => ({
  kind: "channel",
  channel: "slack",
  label: "Slack",
  to,
});

function seed(agent: string, now: number): Task[] {
  const ok = (ago: number, durationMs: number) => ({
    at: now - ago,
    status: "ok" as const,
    durationMs,
  });
  switch (agent) {
    case DEMO_AGENTS.studio:
      return [
        {
          id: "inbox-watch",
          agent: "main",
          name: "Inbox watcher",
          prompt:
            "Every half hour, read new mail in Work and Personal. Flag what needs a reply today, archive receipts and newsletters, and tell me only when something is urgent.",
          schedule: { kind: "every", everyMs: 30 * MINUTE },
          enabled: true,
          running: false,
          nextRunAt: now + 9 * MINUTE,
          lastRun: ok(21 * MINUTE, 41_000),
          delivery: toOtter,
        },
        {
          id: "northwind",
          agent: "main",
          name: "Northwind renewal follow-up",
          prompt:
            "If Olu hasn't answered about the Northwind contract renewal, draft a friendly nudge for me to review.",
          schedule: { kind: "cron", expr: "0 9 * * 1-5", tz: "Europe/Berlin" },
          conditional: true,
          enabled: true,
          running: false,
          nextRunAt: now + 19 * HOUR,
          lastRun: {
            at: now - 5 * HOUR,
            status: "error",
            error: "The Gmail tool timed out after 60 seconds.",
            durationMs: 60_000,
          },
          delivery: toOtter,
        },
        {
          id: "competitors",
          agent: "research",
          name: "Competitor releases",
          prompt:
            "Check the changelogs of Superhuman, Spark and Mimestream. Summarize anything new in three bullets.",
          schedule: { kind: "cron", expr: "0 8 * * 1", tz: "Europe/Berlin" },
          enabled: true,
          running: false,
          nextRunAt: now + 4 * DAY,
          lastRun: ok(3 * DAY, 182_000),
          delivery: slack("#product"),
          model: "anthropic/claude-sonnet-5.5",
        },
        {
          id: "flight-checkin",
          agent: "main",
          name: "Check in for the Lisbon flight",
          prompt: "Check in for TP 1352 as soon as it opens and put the boarding pass in my Drive.",
          schedule: { kind: "at", at: new Date(now + 2 * DAY + 3 * HOUR).toISOString() },
          enabled: true,
          running: false,
          nextRunAt: now + 2 * DAY + 3 * HOUR,
          delivery: toOtter,
        },
        {
          id: "invoices",
          agent: "main",
          name: "File invoices",
          prompt:
            "Save every invoice that arrived this month to Drive › Finance and list them for me.",
          schedule: { kind: "cron", expr: "0 18 28 * *", tz: "Europe/Berlin" },
          enabled: false,
          running: false,
          lastRun: ok(22 * DAY, 74_000),
          delivery: toOtter,
        },
        {
          id: "heartbeat",
          name: "Heartbeat",
          description: "Checks its own checklist and acts only when something needs it.",
          schedule: { kind: "every", everyMs: 30 * MINUTE },
          enabled: true,
          running: false,
          nextRunAt: now + 12 * MINUTE,
          lastRun: ok(18 * MINUTE, 9_000),
          delivery: { kind: "none" },
          managedBy: "OpenClaw's heartbeat",
        },
        {
          id: "memory",
          name: "Tidy memory",
          description: "Merges and prunes what it remembers about you.",
          runs: "memory-core compact",
          schedule: { kind: "cron", expr: "0 3 * * *" },
          enabled: true,
          running: false,
          nextRunAt: now + 15 * HOUR,
          lastRun: ok(9 * HOUR, 23_000),
          delivery: { kind: "none" },
          managedBy: "OpenClaw (memory-core)",
        },
      ];
    case DEMO_AGENTS.brokk:
      return [
        {
          id: "morning-brief",
          name: "Morning brief",
          prompt:
            "Every weekday at 8, tell me what needs me today: calendar, mail waiting on me, and anything due.",
          schedule: { kind: "cron", expr: "0 8 * * 1-5" },
          enabled: true,
          running: false,
          nextRunAt: now + 21 * HOUR,
          lastRun: ok(3 * HOUR, 64_000),
          delivery: toOtter,
        },
        {
          id: "build-watch",
          name: "Nightly build watch",
          prompt:
            "If last night's Release workflow failed, find out why and open a fix as a draft PR.",
          schedule: { kind: "cron", expr: "30 6 * * *" },
          conditional: true,
          enabled: true,
          running: false,
          nextRunAt: now + 19 * HOUR,
          lastRun: {
            at: now - 2 * DAY,
            status: "error",
            error: "gh: authentication expired. Run gh auth login.",
            durationMs: 4_000,
          },
          delivery: toOtter,
        },
        {
          id: "newsletters",
          name: "Newsletter digest",
          prompt:
            "Collect this week's newsletters into one digest with a line each, and archive them.",
          schedule: { kind: "cron", expr: "0 17 * * 5" },
          enabled: false,
          running: false,
          autoPaused: "Paused by the agent after 3 failed runs in a row",
          lastRun: {
            at: now - 6 * DAY,
            status: "error",
            error: "Couldn't reach the mail server.",
            durationMs: 31_000,
          },
          delivery: { kind: "elsewhere", label: "Telegram" },
        },
        {
          id: "build-status",
          name: "Post the build status",
          prompt: "Every morning, post whether last night's builds passed to the team dashboard.",
          schedule: { kind: "cron", expr: "0 7 * * 1-5" },
          enabled: true,
          running: false,
          nextRunAt: now + 20 * HOUR,
          lastRun: ok(HOUR, 12_000),
          delivery: { kind: "webhook", url: "https://dash.acme.example/hooks/builds" },
        },
        {
          id: "hiring-pipeline",
          name: "Hiring pipeline check",
          prompt:
            "Until Thursday's planning, tell me each evening how many backend candidates are in the pipeline and who's waiting on me.",
          schedule: { kind: "cron", expr: "0 18 * * *" },
          enabled: true,
          running: false,
          nextRunAt: now + 7 * HOUR,
          delivery: { kind: "otter", chat: "one" },
          chats: [PLANNING_PACK_SESSION],
        },
      ];
    case DEMO_AGENTS.varys:
      return [
        {
          id: "dream",
          name: "Dream",
          description:
            "Goes over the day's conversations at night and keeps what's worth remembering.",
          schedule: { kind: "other", text: "Every night, when you're idle" },
          enabled: true,
          running: false,
          lastRun: ok(14 * HOUR, 312_000),
          delivery: { kind: "none" },
          managedBy: "varys",
        },
      ];
    default:
      return [];
  }
}

/** What the studio's (OpenClaw's) tasks can run on, as its gateway would say. */
const STUDIO_MODELS: TaskModels = {
  agentModel: "anthropic/claude-opus-5.5",
  models: [
    { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5" },
    { id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
    { id: "openai/gpt-6.2-sol", name: "GPT-6.2 Sol" },
  ],
};

const nextOf = (schedule: ScheduledTaskInput["schedule"], now: number) =>
  schedule.kind === "every"
    ? now + schedule.everyMs
    : schedule.kind === "at"
      ? Date.parse(schedule.at)
      : now + DAY;

export function scriptedSchedules(agent: string): ScheduleSupport<AgentSettings> {
  const tasks = seed(agent, Date.now());
  const find = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new Error("That task is gone.");
    return task;
  };
  const history = (task: Task): TaskRun[] => {
    if (!task.lastRun) return [];
    const every = task.schedule.kind === "every" ? task.schedule.everyMs : DAY;
    return Array.from({ length: 8 }, (_, i): TaskRun => {
      const failed = i === 0 && task.lastRun!.status === "error";
      return {
        id: `${task.id}-${i}`,
        at: task.lastRun!.at - i * every,
        status: failed ? "error" : i === 5 ? "skipped" : "ok",
        durationMs: task.lastRun!.durationMs,
        ...(failed ? { error: task.lastRun!.error } : {}),
        ...(i === 5 ? { silent: true as const } : {}),
        summary: failed
          ? undefined
          : i === 5
            ? "Nothing new: nothing sent."
            : "Two threads need you today; the rest is archived.",
        delivered: !failed && i !== 5 && task.delivery.kind !== "none",
        model: "claude-opus-5.5",
      };
    });
  };
  return {
    async list(): Promise<Omit<AgentScheduledTasks, "provider">> {
      if (agent === DEMO_AGENTS.rata)
        throw new Error("rata didn't answer: the request timed out after 30 seconds.");
      return {
        ...(agent === DEMO_AGENTS.varys
          ? { readOnly: "varys shares its jobs with Otter but doesn't let it change them." }
          : {}),
        tasks: tasks.map((task) => ({ ...task, provider: agent })),
        channels: [{ id: "slack", label: "Slack", accounts: ["acme"] }],
        can: { create: true, deliverToOtter: true, webhooks: true, history: true, timeZones: true },
      };
    },
    async save(_settings, id, input) {
      const now = Date.now();
      const delivery: TaskDelivery =
        input.resultsTo?.kind === "off"
          ? { kind: "none" }
          : input.resultsTo?.kind === "channel"
            ? slack(input.resultsTo.to)
            : input.resultsTo?.kind === "webhook"
              ? { kind: "webhook", url: input.resultsTo.url }
              : toOtter;
      if (id) {
        Object.assign(find(id), {
          name: input.name,
          prompt: input.prompt,
          schedule: input.schedule,
          nextRunAt: nextOf(input.schedule, now),
          ...(input.resultsTo ? { delivery } : {}),
          ...(input.model !== undefined ? { model: input.model ?? undefined } : {}),
        });
        return id;
      }
      const task: Task = {
        id: `task-${now.toString(36)}`,
        agent: input.agent,
        name: input.name,
        prompt: input.prompt,
        schedule: input.schedule,
        enabled: true,
        running: false,
        nextRunAt: nextOf(input.schedule, now),
        delivery,
        ...(input.model ? { model: input.model } : {}),
      };
      tasks.push(task);
      return task.id;
    },
    async setEnabled(_settings, id, enabled) {
      const task = find(id);
      task.enabled = enabled;
      task.autoPaused = undefined;
    },
    async runNow(_settings, id) {
      const task = find(id);
      task.running = true;
      setTimeout(() => {
        task.running = false;
        task.lastRun = { at: Date.now(), status: "ok", durationMs: 6_000 };
      }, 6_000);
    },
    async remove(_settings, id) {
      const at = tasks.findIndex((t) => t.id === id);
      if (at >= 0) tasks.splice(at, 1);
    },
    runs: async (_settings, id, limit) => history(find(id)).slice(0, limit),
    async runTranscript(_settings, id, runId): Promise<ChatSessionMessage[]> {
      const run = history(find(id)).find((r) => r.id === runId);
      return [
        { role: "user", text: find(id).prompt ?? find(id).description ?? find(id).name },
        {
          role: "assistant",
          text: run?.error
            ? `I couldn't finish: ${run.error}`
            : "Two threads need you today:\n\n- **Priya** asked you to own the hiring plan for Thursday\n- **Olu** is waiting on the Northwind renewal\n\nI archived 6 newsletters and 2 receipts.",
        },
      ];
    },
    ...(agent === DEMO_AGENTS.studio ? { models: async () => STUDIO_MODELS } : {}),
    targets: async () => [
      { target: "#product", label: "#product" },
      { target: "#general", label: "#general" },
      { target: "@priya", label: "Priya Natarajan" },
    ],
  };
}
