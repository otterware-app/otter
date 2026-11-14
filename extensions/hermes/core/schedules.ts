/**
 * Hermes's cron jobs (/api/jobs) as scheduled tasks. Each run is a session of its own (source
 * "cron"), so its past runs and their transcripts are its cron sessions. Results come to Otter
 * through its plugin when Hermes has it (deliver "otter"); without it, a job that keeps its results
 * on Hermes (deliver "local") has Otter read them (deliveries.ts), unless Otter was told to leave
 * them there (`mutedJobs`, Otter's own setting: Hermes has no "nowhere").
 */

import { saveAgentSettings } from "@otter/core/extension-kit";
import type {
  AgentContext,
  AgentId,
  ChatSessionMessage,
  ScheduleSupport,
} from "@otter/core/extension-kit";
import type {
  DeliveryChannel,
  ScheduledTask,
  ScheduledTaskInput,
  TaskRun,
} from "@otter/contracts/scheduled";

import {
  authHeaders,
  connectedPlatforms,
  listSessions,
  requireReady,
  sessionMessages,
  toMillis,
  type RawSession,
  type Ready,
} from "./http.js";
import type { HermesSettings } from "./settings.js";

export type HermesJob = {
  id: string;
  name?: string;
  prompt?: string;
  schedule?: { kind?: string; expr?: string; minutes?: number; run_at?: string; display?: string };
  schedule_display?: string;
  timezone?: string;
  enabled?: boolean;
  state?: string;
  paused_reason?: string | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  deliver?: string;
  no_agent?: boolean;
  script?: string | null;
};

const time = (iso: string | null | undefined) => {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(at) ? undefined : at;
};

const muted = (settings: Pick<HermesSettings, "mutedJobs">) =>
  new Set((settings.mutedJobs ?? "").split(",").filter(Boolean));

/** Its results stay on Hermes, where Otter reads them. */
const keepsResults = (job: HermesJob) => (job.deliver ?? "local") === "local";

export const toOtter = (job: HermesJob, settings: Pick<HermesSettings, "mutedJobs">) =>
  keepsResults(job) && !muted(settings).has(job.id);

/** A Hermes cron job (GET /api/jobs) as a scheduled task of the agent `agent`. */
export function hermesTask(
  job: HermesJob,
  agent: AgentId,
  settings: Pick<HermesSettings, "mutedJobs"> = {},
): ScheduledTask {
  const s = job.schedule ?? {};
  const schedule: ScheduledTask["schedule"] =
    s.kind === "cron" && s.expr
      ? { kind: "cron", expr: s.expr, ...(job.timezone ? { tz: job.timezone } : {}) }
      : s.kind === "interval" && s.minutes
        ? { kind: "every", everyMs: s.minutes * 60_000 }
        : s.kind === "once" && s.run_at
          ? { kind: "at", at: s.run_at }
          : { kind: "other", text: job.schedule_display ?? s.display ?? "On its own schedule" };
  const enabled = job.enabled !== false && job.state !== "paused";
  const nextRunAt = enabled ? time(job.next_run_at) : undefined;
  const lastAt = time(job.last_run_at);
  const failed = job.last_status === "error" || job.last_status === "failed";
  return {
    provider: agent,
    id: job.id,
    name: job.name || job.id,
    ...(job.prompt && !job.no_agent ? { prompt: job.prompt } : {}),
    schedule,
    enabled,
    running: job.state === "running",
    ...(nextRunAt ? { nextRunAt } : {}),
    ...(lastAt && job.last_status
      ? {
          lastRun: {
            at: lastAt,
            status: failed ? "error" : "ok",
            ...(failed && job.last_error ? { error: job.last_error } : {}),
          },
        }
      : {}),
    delivery: deliveryOf(job, settings),
  };
}

const label = (platform: string) =>
  platform
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

function deliveryOf(
  job: HermesJob,
  settings: Pick<HermesSettings, "mutedJobs">,
): ScheduledTask["delivery"] {
  const deliver = job.deliver ?? "local";
  if (deliver === "local")
    return toOtter(job, settings) ? { kind: "otter", chat: "new" } : { kind: "none" };
  if (deliver === "otter") return { kind: "otter", chat: "new" };
  if (deliver.startsWith("otter:")) return { kind: "otter", chat: "one" };
  const [platform, to] = deliver.split(/:(.*)/s);
  if (to && !deliver.includes(","))
    return { kind: "channel", channel: platform, label: label(platform), to };
  return {
    kind: "elsewhere",
    label: deliver === "origin" ? "where it was set up" : deliver.split(",").map(label).join(", "),
  };
}

/** Its own API server and Otter aside, the platforms results can go to. */
function channelsOf(platforms: string[]): DeliveryChannel[] {
  return platforms
    .filter((p) => p !== "api_server" && p !== "otter")
    .map((id) => ({ id, label: label(id), accounts: [] }));
}

/** A schedule in words Hermes parses (`hermes cron`'s): a cron expression, `every 90m`, an ISO time. */
export function hermesSchedule(schedule: ScheduledTaskInput["schedule"]): string {
  if (schedule.kind === "cron") return schedule.expr;
  if (schedule.kind === "every")
    return `every ${Math.max(1, Math.round(schedule.everyMs / 60_000))}m`;
  return schedule.at;
}

const JOBS_TIMEOUT_MS = 10_000;

export async function jobsRequest<T>(
  ready: Ready,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${ready.root}/api/jobs${path}`, {
    signal: AbortSignal.timeout(JOBS_TIMEOUT_MS),
    method: init.method ?? "GET",
    headers: authHeaders(ready.key, init.body !== undefined),
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string | { message?: string };
    } | null;
    const message = typeof body?.error === "string" ? body.error : body?.error?.message;
    if (response.status === 404 && path.startsWith("/"))
      throw new Error("That task is gone from Hermes.");
    if (response.status === 404 || response.status === 501)
      throw new Error("This Hermes doesn't run scheduled tasks. Update it to manage them here.");
    throw new Error(message ?? `Hermes answered ${response.status}.`);
  }
  return (await response.json().catch(() => ({}))) as T;
}

const jobPath = (id: string) => `/${encodeURIComponent(id)}`;

async function setMuted(
  agent: AgentId,
  settings: HermesSettings,
  id: string,
  on: boolean,
): Promise<void> {
  const ids = muted(settings);
  if (ids.has(id) === on) return;
  if (on) ids.add(id);
  else ids.delete(id);
  settings.mutedJobs = [...ids].join(",");
  await saveAgentSettings(agent, { mutedJobs: settings.mutedJobs });
}

/** Where results go, as Hermes takes it (straight to Otter when it has Otter's plugin); undefined leaves it. */
function deliverFor(input: ScheduledTaskInput, platforms: string[]): string | undefined {
  const to = input.resultsTo;
  if (!to) return undefined;
  if (to.kind === "new-chat") return platforms.includes("otter") ? "otter" : "local";
  if (to.kind === "off") return "local";
  if (to.kind === "channel") return `${to.channel}:${to.to}`;
  throw new Error("Hermes can't post results to a webhook.");
}

/** The job a cron session is a run of: by its id (`cron_<job>_<time>`), else its title (`<name> · <time>`). */
export function jobOf(session: RawSession, jobs: HermesJob[]): HermesJob | undefined {
  const id = String(session.id ?? "");
  const byId = jobs.find((j) => id.startsWith(`cron_${j.id}_`));
  if (byId) return byId;
  const title = String(session.title ?? "");
  return jobs.find((j) => {
    const name = (j.name ?? "").split(/\s+/).join(" ").slice(0, 60).trim();
    return name && title.startsWith(`${name} · `);
  });
}

export const SILENT = "[SILENT]";

/** What the run wrote you: its replies, without the prompt Hermes sent it. */
export function runReply(messages: ChatSessionMessage[]): ChatSessionMessage[] {
  return messages.filter((m) => m.role !== "user" && m.role !== "system");
}

/** Its final reply, which is what Hermes delivers. */
export const finalReply = (reply: ChatSessionMessage[]) =>
  reply.findLast((m) => m.role === "assistant" && m.text.trim())?.text.trim() ?? "";

function taskRun(session: RawSession): TaskRun {
  const at = toMillis(session.started_at);
  const ended = toMillis(session.ended_at);
  const failed = session.end_reason === "cron_incomplete_no_output";
  return {
    id: String(session.id),
    at,
    status: failed ? "error" : "ok",
    ...(ended > at ? { durationMs: ended - at } : {}),
    ...(failed ? { error: "It finished without a result." } : {}),
    ...(session.model ? { model: session.model } : {}),
  };
}

export function hermesSchedules({
  id: agent,
  secrets,
}: AgentContext): ScheduleSupport<HermesSettings> {
  const connected = (settings: HermesSettings) =>
    requireReady(settings, secrets).catch(() => {
      throw new Error("Connect it in Settings → Agents.");
    });
  return {
    async list(settings) {
      const ready = await requireReady(settings, secrets).catch(() => null);
      if (!ready) return null;
      const [{ jobs }, platforms] = await Promise.all([
        jobsRequest<{ jobs: HermesJob[] }>(ready, "?include_disabled=true"),
        connectedPlatforms(ready),
      ]);
      return {
        tasks: jobs.map((job) => hermesTask(job, agent, settings)),
        channels: channelsOf(platforms),
        can: {
          create: true,
          deliverToOtter: true,
          webhooks: false,
          history: true,
          timeZones: false,
        },
      };
    },
    async save(settings, id, input) {
      const ready = await connected(settings);
      const platforms = input.resultsTo?.kind === "new-chat" ? await connectedPlatforms(ready) : [];
      const deliver = deliverFor(input, platforms);
      const body = {
        name: input.name,
        schedule: hermesSchedule(input.schedule),
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(deliver ? { deliver } : {}),
      };
      let saved = id;
      if (id) {
        // Hermes works out the next run again whenever it's sent a schedule: only a new one.
        const { job } = await jobsRequest<{ job: HermesJob }>(ready, jobPath(id));
        const current = hermesTask(job, agent).schedule;
        const same = current.kind !== "other" && hermesSchedule(current) === body.schedule;
        const { schedule: _schedule, ...rest } = body;
        await jobsRequest(ready, jobPath(id), { method: "PATCH", body: same ? rest : body });
      } else {
        const made = await jobsRequest<{ job?: { id?: string } }>(ready, "", {
          method: "POST",
          body: { ...body, deliver: deliver ?? "local" },
        });
        saved = made.job?.id ?? "";
      }
      if (saved && input.resultsTo)
        await setMuted(agent, settings, saved, input.resultsTo.kind === "off");
      return saved ?? "";
    },
    async setEnabled(settings, id, enabled) {
      await jobsRequest(
        await connected(settings),
        `${jobPath(id)}/${enabled ? "resume" : "pause"}`,
        {
          method: "POST",
        },
      );
    },
    async runNow(settings, id) {
      await jobsRequest(await connected(settings), `${jobPath(id)}/run`, { method: "POST" });
    },
    async remove(settings, id) {
      await jobsRequest(await connected(settings), jobPath(id), { method: "DELETE" });
      await setMuted(agent, settings, id, false);
    },
    async runs(settings, id, limit) {
      const ready = await requireReady(settings, secrets);
      const [sessions, { job }] = await Promise.all([
        listSessions(ready, 200, "cron"),
        jobsRequest<{ job: HermesJob }>(ready, jobPath(id)),
      ]);
      return sessions
        .filter((s) => s.ended_at && jobOf(s, [job]))
        .slice(0, limit)
        .map(taskRun);
    },
    async runTranscript(settings, _id, runId) {
      return runReply(await sessionMessages(await requireReady(settings, secrets), runId));
    },
  };
}
