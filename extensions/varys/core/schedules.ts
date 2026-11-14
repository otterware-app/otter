/**
 * varys's routines as Otter's scheduled tasks: work it does on a schedule (or when new mail
 * arrives, which Otter shows but can't edit), each run in a thread of its own or written into
 * one of the routine's. Their runs come to Otter as chats (deliveries.ts); a routine whose
 * results you turn off here stays in varys (`mutedRoutines`, Otter's own setting: varys always
 * reports to you).
 */

import type { Routine, RoutineRunPage } from "@generalpursuit/varys";
import type {
  ScheduledTask,
  ScheduledTaskInput,
  TaskRun,
  TaskRunStatus,
  TaskSchedule,
} from "@otter/contracts/scheduled";
import { saveAgentSettings, type AgentId, type ScheduleSupport } from "@otter/core/extension-kit";

import { answered, type VarysConnection } from "./client.js";
import type { VarysSettings } from "./settings.js";
import { messagesOf } from "./turns.js";

type Trigger = Routine["trigger"];
type Run = RoutineRunPage["runs"][number];

const minutes = (ms: number) => Math.round(ms / 60_000);

export function scheduleOf(trigger: Trigger): TaskSchedule {
  if (trigger.type === "new_mail") return { kind: "other", text: "When new mail arrives" };
  const { schedule } = trigger;
  return schedule.type === "cron"
    ? { kind: "cron", expr: schedule.cron, tz: schedule.zone }
    : { kind: "every", everyMs: schedule.everyMs };
}

/** How a routine's chat names when it runs. */
export function scheduleText(trigger: Trigger): string | undefined {
  const schedule = scheduleOf(trigger);
  switch (schedule.kind) {
    case "cron":
      return `${schedule.expr} (${schedule.tz})`;
    case "every":
      return `Every ${minutes(schedule.everyMs)} min`;
    case "other":
      return schedule.text;
    default:
      return undefined;
  }
}

function statusOf(run: Run): TaskRunStatus {
  if (run.outcome === "skipped") return "skipped";
  return run.outcome === "succeeded" || run.outcome === "nothing_new" ? "ok" : "error";
}

const muted = (settings: Pick<VarysSettings, "mutedRoutines">) =>
  new Set((settings.mutedRoutines ?? "").split(",").filter(Boolean));

const durationOf = (run: Run) =>
  run.endedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : undefined;

export function taskRun(run: Run): TaskRun {
  const status = statusOf(run);
  const durationMs = durationOf(run);
  const error = status === "error" ? (run.missing ?? run.detail) : undefined;
  return {
    id: run.id,
    at: Date.parse(run.startedAt),
    status,
    ...(durationMs !== undefined && { durationMs }),
    ...(error && { error }),
    ...(run.report && { summary: run.report }),
    ...(run.outcome === "nothing_new" && { silent: true as const }),
  };
}

export function routineTask(
  agent: AgentId,
  routine: Routine,
  settings: Pick<VarysSettings, "mutedRoutines"> = {},
): ScheduledTask {
  const run = routine.lastRun;
  const ended = run?.state === "ended" ? taskRun(run) : undefined;
  const intoThread = routine.delivery === "into_thread";
  const thread = routine.threadId ?? run?.threadId;
  return {
    provider: agent,
    id: routine.id,
    name: routine.title,
    prompt: routine.instructions,
    schedule: scheduleOf(routine.trigger),
    enabled: !routine.paused,
    running: Boolean(run && run.state !== "ended"),
    ...(routine.nextRunAt && { nextRunAt: Date.parse(routine.nextRunAt) }),
    ...(ended && {
      lastRun: {
        at: ended.at,
        status: ended.status,
        ...(ended.error && { error: ended.error }),
        ...(ended.durationMs !== undefined && { durationMs: ended.durationMs }),
      },
    }),
    delivery: muted(settings).has(routine.id)
      ? { kind: "none" }
      : { kind: "otter", chat: intoThread ? "one" : "new" },
    // A built-in routine (Dream) keeps its name, and is paused rather than deleted.
    ...(routine.builtIn && { managedBy: "varys" }),
    ...(intoThread && thread && { chats: [thread] }),
  };
}

function triggerOf(input: ScheduledTaskInput, current?: Routine): Trigger {
  const { schedule } = input;
  if (schedule.kind === "cron")
    return {
      type: "schedule",
      schedule: {
        type: "cron",
        cron: schedule.expr,
        zone: schedule.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };
  if (schedule.kind === "every") {
    const was = current?.trigger.type === "schedule" ? current.trigger.schedule : undefined;
    // The same interval keeps the times it runs at.
    const anchor =
      was?.type === "interval" && was.everyMs === schedule.everyMs
        ? was.anchor
        : new Date().toISOString();
    return { type: "schedule", schedule: { type: "interval", everyMs: schedule.everyMs, anchor } };
  }
  throw new Error("varys's routines repeat: choose a schedule that does.");
}

async function setMuted(
  agent: AgentId,
  settings: VarysSettings,
  id: string,
  off: boolean,
): Promise<void> {
  const ids = muted(settings);
  if (off === ids.has(id)) return;
  if (off) ids.add(id);
  else ids.delete(id);
  settings.mutedRoutines = [...ids].join(",");
  await saveAgentSettings(agent, { mutedRoutines: settings.mutedRoutines });
}

export function varysSchedules(
  agent: AgentId,
  connection: VarysConnection,
): ScheduleSupport<VarysSettings> {
  async function client(settings: VarysSettings) {
    const varys = await connection.client(settings);
    if (!varys) throw new Error("Connect varys in Settings first.");
    return varys;
  }

  return {
    async list(settings) {
      const varys = await connection.client(settings);
      if (!varys) return null;
      const { routines } = await answered(varys.routines.list());
      return {
        tasks: routines.map((routine) => routineTask(agent, routine, settings)),
        channels: [],
        can: {
          create: true,
          deliverToOtter: true,
          webhooks: false,
          history: true,
          timeZones: true,
        },
      };
    },

    async save(settings, id, input) {
      const varys = await client(settings);
      const current = id ? (await answered(varys.routines.read(id))).routine : undefined;
      const trigger = triggerOf(input, current);
      const instructions = input.prompt?.trim() || input.name;
      const to = input.resultsTo?.kind;
      // A new chat each time: a routine that writes into one thread of its own stops doing that.
      const delivery =
        to === "new-chat" && (!current || current.delivery === "into_thread")
          ? ("each_run" as const)
          : undefined;
      const receipt = current
        ? await answered(
            varys.routines.edit(current.id, {
              title: input.name,
              instructions,
              trigger,
              ...(delivery && { delivery }),
            }),
          )
        : await answered(
            varys.routines.create({
              title: input.name,
              instructions,
              trigger,
              delivery: "each_run",
            }),
          );
      const saved = receipt.result.routineId;
      if (to) await setMuted(agent, settings, saved, to === "off");
      return saved;
    },

    async setEnabled(settings, id, enabled) {
      await answered((await client(settings)).routines.pause(id, !enabled));
    },

    async runNow(settings, id) {
      await answered((await client(settings)).routines.runNow(id));
    },

    async remove(settings, id) {
      await answered((await client(settings)).routines.delete(id));
    },

    async runs(settings, id, limit) {
      const page = await answered((await client(settings)).routines.runs(id, { limit }));
      return page.runs.filter((run) => run.state === "ended").map(taskRun);
    },

    async runTranscript(settings, id, runId) {
      const varys = await client(settings);
      const { runs } = await answered(varys.routines.read(id));
      const run =
        runs.find((r) => r.id === runId) ??
        (await answered(varys.routines.runs(id, { limit: 100 }))).runs.find((r) => r.id === runId);
      if (!run?.threadId) return [];
      return messagesOf((await answered(varys.threads.read(run.threadId))).conversation.items);
    },
  };
}
