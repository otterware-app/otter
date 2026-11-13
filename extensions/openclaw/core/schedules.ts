import type {
  AgentScheduledTasks,
  ChannelTarget,
  DeliveryChannel,
  ResultsTo,
  ScheduledTask,
  ScheduledTaskInput,
  TaskDelivery,
  TaskRun,
  TaskSchedule,
} from "@otter/contracts/scheduled";

/** The gateway as the scheduler sees it: what it answers, what this device may do, its agents. */
export type CronGateway = {
  request<T>(method: string, params: unknown): Promise<T>;
  scopes: string[];
  /** The Otter plugin is on the gateway, so `otter` is a channel jobs can deliver to. */
  otterChannel: boolean;
};

type Job = {
  id: string;
  name: string;
  displayName?: string | null;
  declarationKey?: string | null;
  description?: string | null;
  agentId?: string | null;
  sessionKey?: string | null;
  sessionTarget?: string;
  enabled: boolean;
  configRevision?: string;
  schedule: Record<string, unknown> & { kind: string };
  payload: Record<string, unknown> & { kind: string };
  delivery?: (Record<string, unknown> & { mode: string }) | null;
  failureAlert?: false | Record<string, unknown> | null;
  trigger?: unknown;
  state?: {
    nextRunAtMs?: number;
    runningAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: "ok" | "error" | "skipped";
    lastStatus?: "ok" | "error" | "skipped";
    lastError?: string;
    lastDiagnosticSummary?: string;
    lastDurationMs?: number;
    autoDisabled?: { reason: string; consecutiveErrors: number };
  };
  nextRunAtMs?: number;
};

type RunEntry = {
  ts: number;
  runId?: string;
  runAtMs?: number;
  status?: "ok" | "error" | "skipped";
  error?: string;
  summary?: string;
  diagnostics?: { summary?: string };
  durationMs?: number;
  model?: string;
  delivered?: boolean;
  deliveryStatus?: string;
  deliverySuppressionReason?: string;
  delivery?: {
    resolved?: { channel?: string; to?: string | null; ok?: boolean; error?: string };
  };
};

/** What the scheduler's channels are called (`channels.status`), by id. */
type ChannelLabels = Record<string, string>;

const ADMIN = "operator.admin";

/** Where a job sends its result in Otter: a new chat each time (`chat:new`) or one chat (`chat:<session key>`). */
const NEW_CHAT = "chat:new";

/** An Otter target as the gateway plugin reads it (`gateway/otter.js`): the chat it names, "new", or nothing. */
function otterTarget(to: unknown): { chat: string } | "new" | undefined {
  const target = typeof to === "string" ? to.trim().replace(/^otter:/, "") : "";
  if (target === NEW_CHAT || target === "owner") return "new";
  const sessionKey = target.startsWith("chat:") ? target.slice("chat:".length) : "";
  return sessionKey.startsWith("agent:") && sessionKey.split(":")[1]
    ? { chat: sessionKey }
    : undefined;
}

const NO_OTTER_CHAT = "It names no Otter chat to send to: choose where its results go.";

export const READ_ONLY =
  "Otter can see these but not change them: allow it full access to the gateway in Settings → Agents.";

/** OpenClaw's own jobs (`heartbeat:main`, `memory-core:…`): kept from its config, so not Otter's to edit. */
function managedBy(job: Job): string | undefined {
  const key = job.declarationKey;
  if (!key) return undefined;
  const owner = key.split(":")[0];
  return owner === "heartbeat" ? "OpenClaw's heartbeat" : `OpenClaw (${owner})`;
}

/** What a job asks, when it's a message a person wrote (not a plugin's internal marker). */
function promptOf(job: Job): string | undefined {
  const text =
    job.payload.kind === "agentTurn"
      ? job.payload.message
      : job.payload.kind === "systemEvent"
        ? job.payload.text
        : undefined;
  return typeof text === "string" && !text.startsWith("__openclaw_") ? text : undefined;
}

export function scheduleOf(schedule: Job["schedule"]): TaskSchedule {
  if (schedule.kind === "cron" && typeof schedule.expr === "string")
    return {
      kind: "cron",
      expr: schedule.expr,
      ...(typeof schedule.tz === "string" ? { tz: schedule.tz } : {}),
    };
  if (schedule.kind === "every" && typeof schedule.everyMs === "number")
    return { kind: "every", everyMs: schedule.everyMs };
  if (schedule.kind === "at" && typeof schedule.at === "string")
    return { kind: "at", at: schedule.at };
  if (schedule.kind === "on-exit")
    return { kind: "other", text: `When ${String(schedule.command)} exits` };
  if (schedule.kind === "stream")
    return { kind: "other", text: "When a command it watches prints" };
  if (schedule.kind === "event") return { kind: "other", text: "When an event it waits for comes" };
  return { kind: "other", text: schedule.kind };
}

const channelName = (channel: string) => channel.charAt(0).toUpperCase() + channel.slice(1);
const str = (value: unknown) =>
  typeof value === "string" && value
    ? value
    : typeof value === "number"
      ? String(value)
      : undefined;

/** The gateway's description of where a result would go: "announce -> telegram:123". */
type Preview = { label?: string; detail?: string };

export function deliveryOf(job: Job, labels: ChannelLabels = {}, preview?: Preview): TaskDelivery {
  const delivery = job.delivery;
  if (job.payload.kind === "heartbeat" || !delivery || delivery.mode === "none")
    return { kind: "none" };
  if (delivery.mode === "webhook") return { kind: "webhook", url: str(delivery.to) ?? "" };
  const channel = str(delivery.channel) ?? "last";
  if (channel === "otter") {
    const target = otterTarget(delivery.to);
    return target
      ? { kind: "otter", chat: target === "new" ? "new" : "one" }
      : { kind: "elsewhere", label: "Otter, with no chat named" };
  }
  // Where "last" goes now, as the gateway resolves it.
  const resolved =
    channel === "last" ? /^announce -> (?!last\b)(.+)$/.exec(preview?.label ?? "")?.[1] : undefined;
  const to = str(delivery.to) ?? resolved;
  const accountId = str(delivery.accountId);
  const threadId = str(delivery.threadId);
  return {
    kind: "channel",
    channel,
    label: channel === "last" ? "The last conversation" : (labels[channel] ?? channelName(channel)),
    ...(to ? { to } : {}),
    ...(accountId ? { accountId } : {}),
    ...(threadId ? { threadId } : {}),
  };
}

/** Why the gateway says a result won't arrive, if it does. */
function deliveryProblem(preview?: Preview): string | undefined {
  const detail = preview?.detail;
  const failed =
    /will be blocked|requires review|unavailable|unresolved|Unknown target|Configure a channel and delivery target/;
  if (!detail || !failed.test(detail)) return undefined;
  if (/multiple channels are configured/.test(detail))
    return "OpenClaw has more than one channel, so it can't tell where to send these: choose one.";
  // The gateway's own advice ("Configure a channel… or use delivery:{mode:"none"}") is for its CLI.
  const reason = detail
    .replace(/^.*?will be blocked:\s*/, "")
    .split(/\s*Configure a channel and delivery target/)[0]
    .trim();
  const first = /^[^.]*\.?/.exec(reason)?.[0] ?? reason;
  return first.endsWith(".") ? first : `${first}.`;
}

/** A route as people say it: "Slack channel:C0123", "a webhook (hooks.example.com)". */
function routeText(route: Record<string, unknown>, labels: ChannelLabels): string {
  const to = str(route.to);
  if (route.mode === "webhook") {
    const host = to && URL.canParse(to) ? new URL(to).host : to;
    return host ? `a webhook (${host})` : "a webhook";
  }
  const channel = str(route.channel) ?? "last";
  if (channel === "otter") return "Otter";
  const name =
    channel === "last" ? "the last conversation" : (labels[channel] ?? channelName(channel));
  return to ? `${name} ${to}` : name;
}

/** Where failures are reported, when that's set apart from where results go. */
function failureAlertsOf(job: Job, labels: ChannelLabels): string | undefined {
  const alert = job.failureAlert;
  if (alert === false) return "Off";
  const route =
    alert && (alert.channel || alert.to)
      ? alert
      : job.delivery?.failureDestination && typeof job.delivery.failureDestination === "object"
        ? (job.delivery.failureDestination as Record<string, unknown>)
        : undefined;
  if (!route) return undefined;
  const after = alert && typeof alert.after === "number" ? alert.after : undefined;
  return `${routeText(route, labels)}${after ? `, after ${after} failed runs in a row` : ""}`;
}

/** What a job runs when it isn't a message to its agent. */
function runsOf(job: Job): string | undefined {
  const payload = job.payload;
  if (payload.kind === "command" && Array.isArray(payload.argv))
    return `Runs ${payload.argv.map(String).join(" ")}`;
  if (payload.kind === "script") return "Runs a script";
  return undefined;
}

function autoPaused(job: Job): string | undefined {
  const auto = job.state?.autoDisabled;
  if (!auto || job.enabled) return undefined;
  return auto.reason === "consecutive-failures"
    ? `Paused by OpenClaw after ${auto.consecutiveErrors} failed runs in a row`
    : "Paused by OpenClaw: its schedule kept failing";
}

/** The Otter chats a job belongs to: the session it was made in, and the chat it posts to. */
function chatsOf(job: Job): string[] {
  const target = job.delivery?.channel === "otter" ? otterTarget(job.delivery.to) : undefined;
  const posts = typeof target === "object" ? target.chat : undefined;
  return [...new Set([job.sessionKey, posts].filter((key): key is string => !!key))];
}

export function taskOf(
  job: Job,
  defaultAgent: string,
  preview?: Preview,
  labels: ChannelLabels = {},
): ScheduledTask {
  const state = job.state ?? {};
  const lastStatus = state.lastRunStatus ?? state.lastStatus;
  const agent = job.agentId ?? job.sessionKey?.split(":")[1] ?? defaultAgent;
  const description = job.description?.replace(/^\[managed-by=[^\]]*\]\s*/, "").trim();
  const prompt = promptOf(job);
  const runs = runsOf(job);
  const delivery = deliveryOf(job, labels, preview);
  const problem = delivery.kind === "elsewhere" ? NO_OTTER_CHAT : deliveryProblem(preview);
  const failureAlerts = failureAlertsOf(job, labels);
  const managed = managedBy(job);
  const paused = autoPaused(job);
  const nextRunAt = job.enabled ? (state.nextRunAtMs ?? job.nextRunAtMs) : undefined;
  const chats = chatsOf(job);
  return {
    provider: "openclaw",
    id: job.id,
    agent,
    name: job.displayName || job.name,
    ...(description ? { description } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(runs ? { runs } : {}),
    schedule: scheduleOf(job.schedule),
    ...(job.trigger ? { conditional: true as const } : {}),
    enabled: job.enabled,
    running: typeof state.runningAtMs === "number",
    ...(nextRunAt ? { nextRunAt } : {}),
    ...(state.lastRunAtMs && lastStatus
      ? {
          lastRun: {
            at: state.lastRunAtMs,
            status: lastStatus,
            ...(lastStatus === "error"
              ? { error: state.lastDiagnosticSummary ?? state.lastError }
              : {}),
            ...(state.lastDurationMs !== undefined ? { durationMs: state.lastDurationMs } : {}),
          },
        }
      : {}),
    delivery,
    ...(problem ? { deliveryProblem: problem } : {}),
    ...(failureAlerts ? { failureAlerts } : {}),
    ...(managed ? { managedBy: managed } : {}),
    ...(paused ? { autoPaused: paused } : {}),
    ...(job.configRevision ? { revision: job.configRevision } : {}),
    ...(chats.length > 0 ? { chats } : {}),
    // Only an agent turn in a session of its own reports to a chat.
    ...(job.sessionTarget === "main" || job.payload.kind !== "agentTurn"
      ? { undeliverable: true as const }
      : {}),
  };
}

const CHANGED = "It changed on the gateway while you were editing it. Look again and save.";

/** A gateway's refusal, said for people. */
export function cronError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { details?: { code?: string } } | null)?.details?.code;
  if (/missing scope|operator\.admin/i.test(message)) return new Error(READ_ONLY);
  if (code === "CRON_JOB_NOT_FOUND" || message.startsWith("Automation not found"))
    return new Error("That task is gone from the gateway.");
  if (code === "CRON_JOB_CHANGED") return new Error(CHANGED);
  if (/not a known channel: otter/.test(message))
    return new Error(
      "The gateway can't send to Otter yet: set up Messages from your agents in Settings → Agents.",
    );
  return new Error(message.replace(/^invalid cron\.\w+ params: /, ""));
}

async function call<T>(g: CronGateway, method: string, params: unknown): Promise<T> {
  try {
    return await g.request<T>(method, params);
  } catch (error) {
    throw cronError(error);
  }
}

const PAGE = 200;

export async function listTasks(
  g: CronGateway,
  defaultAgent: string,
): Promise<Omit<AgentScheduledTasks, "provider">> {
  const jobs: Job[] = [];
  const previews: Record<string, Preview> = {};
  for (let offset = 0; ;) {
    const page = await call<{
      jobs: Job[];
      hasMore?: boolean;
      nextOffset?: number | null;
      deliveryPreviews?: Record<string, Preview>;
    }>(g, "cron.list", {
      includeDisabled: true,
      sortBy: "nextRunAtMs",
      sortDir: "asc",
      limit: PAGE,
      offset,
      includeDeliveryPreviews: true,
    });
    jobs.push(...page.jobs);
    Object.assign(previews, page.deliveryPreviews);
    if (!page.hasMore || typeof page.nextOffset !== "number" || page.nextOffset <= offset) break;
    offset = page.nextOffset;
  }
  const admin = g.scopes.includes(ADMIN);
  const { channels, labels } = await deliveryChannels(g);
  return {
    tasks: jobs.map((job) => taskOf(job, defaultAgent, previews[job.id], labels)),
    ...(admin ? {} : { readOnly: READ_ONLY }),
    channels,
    can: {
      create: admin,
      deliverToOtter: g.otterChannel,
      webhooks: true,
      history: true,
      timeZones: true,
    },
  };
}

type ChannelsStatus = {
  channelOrder?: string[];
  channelLabels?: Record<string, string>;
  channelMeta?: { id: string; label: string }[];
  channelAccounts?: Record<
    string,
    { accountId: string; enabled?: boolean; configured?: boolean }[]
  >;
  channelDefaultAccountId?: Record<string, string>;
};

/** The chat apps the gateway has set up (not Otter, offered on its own), from its snapshot: no probe. */
export async function deliveryChannels(
  g: CronGateway,
): Promise<{ channels: DeliveryChannel[]; labels: ChannelLabels }> {
  const status = await g
    .request<ChannelsStatus>("channels.status", {})
    .catch((): ChannelsStatus => ({}));
  const labels: ChannelLabels = { ...status.channelLabels };
  for (const meta of status.channelMeta ?? []) labels[meta.id] = meta.label;
  const ids = status.channelMeta?.map((meta) => meta.id) ?? status.channelOrder ?? [];
  const channels = ids.flatMap((id): DeliveryChannel[] => {
    if (id === "otter") return [];
    const accounts = (status.channelAccounts?.[id] ?? [])
      .filter((a) => a.enabled !== false && a.configured !== false)
      .map((a) => a.accountId);
    if (accounts.length === 0) return [];
    const defaultAccount = status.channelDefaultAccountId?.[id];
    return [
      {
        id,
        label: labels[id] ?? channelName(id),
        accounts,
        ...(defaultAccount ? { defaultAccount } : {}),
      },
    ];
  });
  return { channels, labels };
}

/** Who results could go to on a channel: its directory and the conversations the agent has had there. */
export async function channelTargets(
  g: CronGateway,
  agentId: string,
  channel: string,
): Promise<ChannelTarget[]> {
  const result = await g
    .request<{
      conversations?: { target?: string; label?: string; accountId?: string }[];
    }>("conversations.list", { agentId, channel, limit: 100 })
    .catch(() => ({ conversations: [] }));
  const seen = new Set<string>();
  return (result.conversations ?? []).flatMap((row) => {
    if (!row.target || seen.has(`${row.accountId}|${row.target}`)) return [];
    seen.add(`${row.accountId}|${row.target}`);
    return [
      {
        target: row.target,
        ...(row.label ? { label: row.label } : {}),
        ...(row.accountId ? { accountId: row.accountId } : {}),
      },
    ];
  });
}

function cronSchedule(schedule: ScheduledTaskInput["schedule"]): Record<string, unknown> {
  if (schedule.kind === "cron")
    return { kind: "cron", expr: schedule.expr, ...(schedule.tz ? { tz: schedule.tz } : {}) };
  if (schedule.kind === "every") return { kind: "every", everyMs: schedule.everyMs };
  return { kind: "at", at: schedule.at };
}

const sameSchedule = (job: Job["schedule"], wanted: Record<string, unknown>) =>
  Object.keys(wanted).every((key) => job[key] === wanted[key]) &&
  (wanted.kind !== "cron" || (job.tz ?? undefined) === wanted.tz);

/** A job's delivery for where results should go. */
function deliveryFor(to: ResultsTo): Record<string, unknown> {
  if (to.kind === "new-chat") return { mode: "announce", channel: "otter", to: NEW_CHAT };
  if (to.kind === "channel")
    return {
      mode: "announce",
      channel: to.channel,
      to: to.to,
      ...(to.accountId ? { accountId: to.accountId } : {}),
    };
  if (to.kind === "webhook") return { mode: "webhook", to: to.url };
  return { mode: "none" };
}

/**
 * The patch that sends results there, or null when they already go there. The gateway merges a
 * delivery patch, so what pointed at the old target (its account, topic) is cleared; where
 * failures are reported is a setting of its own and stays.
 */
export function deliveryPatch(
  current: Job["delivery"],
  to: ResultsTo,
): Record<string, unknown> | null {
  const wanted = deliveryFor(to);
  const now = current ?? { mode: "none" };
  const same =
    now.mode === wanted.mode &&
    (wanted.mode === "none" ||
      ((str(now.channel) ?? null) === (str(wanted.channel) ?? null) &&
        str(now.to) === str(wanted.to) &&
        (wanted.mode !== "announce" ||
          (str(now.accountId) ?? null) === (str(wanted.accountId) ?? null))));
  if (same) return null;
  // A topic belongs to its chat: it goes with a new chat, not with a new account.
  const sameChat =
    now.mode === wanted.mode &&
    str(now.channel) === str(wanted.channel) &&
    str(now.to) === str(wanted.to);
  return {
    channel: null,
    to: null,
    accountId: null,
    ...(sameChat ? {} : { threadId: null }),
    ...(wanted.mode === "announce" ? {} : { completionDestination: null }),
    ...wanted,
  };
}

/** Saves the task; its id. */
export async function saveTask(
  g: CronGateway,
  id: string | null,
  input: ScheduledTaskInput,
): Promise<string> {
  const schedule = cronSchedule(input.schedule);
  if (!id) {
    if (input.prompt === undefined) throw new Error("Say what the agent should do.");
    const added = await call<{ id?: string; job?: { id?: string } }>(g, "cron.add", {
      name: input.name,
      ...(input.agent ? { agentId: input.agent } : {}),
      sessionTarget: "isolated",
      wakeMode: "now",
      schedule,
      ...(input.schedule.kind === "at" ? { deleteAfterRun: true } : {}),
      payload: { kind: "agentTurn", message: input.prompt },
      delivery: deliveryFor(input.resultsTo ?? { kind: "off" }),
    });
    return added.id ?? added.job?.id ?? "";
  }
  const job = await call<Job>(g, "cron.get", { id });
  if (job.declarationKey)
    throw new Error("OpenClaw keeps this one itself: it can be paused or run, not changed.");
  const revision = input.revision ?? job.configRevision;
  if (input.revision && job.configRevision && input.revision !== job.configRevision)
    throw new Error(CHANGED);
  const patch: Record<string, unknown> = {};
  if (input.name !== (job.displayName || job.name)) {
    patch.name = input.name;
    if (job.displayName) patch.displayName = null;
  }
  if (!sameSchedule(job.schedule, schedule)) {
    patch.schedule =
      schedule.kind === "cron" &&
      job.schedule.kind === "cron" &&
      typeof job.schedule.staggerMs === "number"
        ? { ...schedule, staggerMs: job.schedule.staggerMs }
        : schedule;
    // A one-off goes once it has run; a repeating task stays.
    if ((schedule.kind === "at") !== (job.schedule.kind === "at"))
      patch.deleteAfterRun = schedule.kind === "at";
  }
  const prompt = promptOf(job);
  if (input.prompt !== undefined && prompt !== undefined && input.prompt !== prompt)
    patch.payload =
      job.payload.kind === "agentTurn"
        ? { ...job.payload, message: input.prompt }
        : { ...job.payload, text: input.prompt };
  if (input.agent && input.agent !== job.agentId && !job.sessionKey) patch.agentId = input.agent;
  const delivery = input.resultsTo && deliveryPatch(job.delivery, input.resultsTo);
  if (delivery) patch.delivery = delivery;
  if (Object.keys(patch).length > 0)
    await call(g, "cron.update", {
      id,
      patch,
      ...(revision ? { expectedConfigRevision: revision } : {}),
    });
  return id;
}

export async function setTaskEnabled(g: CronGateway, id: string, enabled: boolean) {
  await call(g, "cron.update", { id, patch: { enabled } });
}

export async function runTask(g: CronGateway, id: string) {
  await call(g, "cron.run", { id, mode: "force" });
}

export async function removeTask(g: CronGateway, id: string) {
  const job = await call<Job>(g, "cron.get", { id });
  if (job.declarationKey)
    throw new Error("OpenClaw keeps this one itself: pause it instead of deleting it.");
  await call(g, "cron.remove", { id });
}

const HISTORY_PAGES = 5;

/** A run's id for Otter: the gateway's run id, or when it ran for runs logged without one. */
const runKey = (entry: RunEntry) => entry.runId ?? `at:${entry.runAtMs ?? entry.ts}`;

export async function taskRuns(g: CronGateway, id: string, limit: number): Promise<TaskRun[]> {
  const { entries } = await call<{ entries: RunEntry[] }>(g, "cron.runs", {
    id,
    limit,
    sortDir: "desc",
  });
  return entries.map((entry) => ({
    id: runKey(entry),
    at: entry.runAtMs ?? entry.ts,
    status: entry.status ?? "ok",
    ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
    ...(entry.status === "error"
      ? { error: entry.diagnostics?.summary ?? entry.error ?? "It failed." }
      : {}),
    ...(entry.summary ? { summary: entry.summary } : {}),
    ...(entry.model ? { model: entry.model } : {}),
    ...(entry.delivery?.resolved?.channel
      ? {
          sentTo: {
            channel: entry.delivery.resolved.channel,
            ...(entry.delivery.resolved.to ? { to: entry.delivery.resolved.to } : {}),
          },
        }
      : {}),
    ...(entry.delivery?.resolved?.ok === false && entry.delivery.resolved.error
      ? { deliveryError: entry.delivery.resolved.error }
      : {}),
    // "silent": the agent chose to send nothing, not a failure.
    ...(entry.deliverySuppressionReason === "silent"
      ? { silent: true as const }
      : entry.deliveryStatus === "delivered" || entry.deliveryStatus === "not-delivered"
        ? { delivered: entry.deliveryStatus === "delivered" }
        : typeof entry.delivery?.resolved?.ok === "boolean"
          ? { delivered: entry.delivery.resolved.ok }
          : {}),
  }));
}

const transcriptGone = (error: unknown) =>
  error instanceof Error && error.message.startsWith("The recorded cron transcript is unavailable");

/**
 * The rows of one run (`cron.history`). The scheduler writes the job's message, with its own
 * preamble for unattended runs, as the run's first row: that's shown as what was asked.
 */
export async function runRows(
  g: CronGateway,
  id: string,
  runId: string,
): Promise<Record<string, unknown>[]> {
  const at = /^at:(\d+)$/.exec(runId)?.[1];
  const messages: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < HISTORY_PAGES; page++) {
    const params = {
      id,
      ...(at ? { runAtMs: Number(at) } : { runId }),
      limit: 200,
      ...(cursor ? { cursor } : {}),
    };
    let result: { messages: Record<string, unknown>[]; nextCursor?: string };
    try {
      result = await g.request("cron.history", params);
    } catch (error) {
      // A run the gateway kept no transcript for (a heartbeat, a pruned session): its summary
      // stands in for it.
      if (page === 0 && transcriptGone(error)) return [];
      throw cronError(error);
    }
    messages.push(...result.messages);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return messages.map((row) => {
    const provenance = row.provenance as { kind?: string; sourceTool?: string } | undefined;
    if (provenance?.kind !== "internal_system" || provenance.sourceTool !== "cron") return row;
    const text = typeof row.content === "string" ? row.content : "";
    return { ...row, role: "user", content: text.split(/\nCurrent time: /)[0] };
  });
}
