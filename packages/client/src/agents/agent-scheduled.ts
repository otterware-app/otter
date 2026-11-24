import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentScheduledTasks,
  ResultsTo,
  ScheduledTask,
  TaskDelivery,
  TaskModels,
  TaskRun,
} from "@otter/contracts/scheduled";
import { readableError } from "../errors.ts";
import { host } from "../host.ts";
import { useAgentProviders } from "./agent-providers.ts";
import { agentApi } from "./api.ts";
import type { Conversation } from "./chat-store.ts";
import { agoText, dayTimeText, durationText, untilText } from "./scheduled-text.ts";

export const SCHEDULED_TASKS_KEY = ["agent-scheduled"] as const;
const IDLE_REFRESH_MS = 20_000;
export const BUSY_REFRESH_MS = 3_000;

/** Every agent's tasks; `live` keeps them current while they're on screen, asking the agents again. */
export function useScheduledTasks(live = false) {
  return useQuery({
    queryKey: SCHEDULED_TASKS_KEY,
    queryFn: () => agentApi.scheduledTasks(),
    staleTime: live ? 5_000 : 5 * 60_000,
    refetchInterval: (query) =>
      !live
        ? false
        : query.state.data?.some((agent) => agent.tasks.some((t) => t.running))
          ? BUSY_REFRESH_MS
          : IDLE_REFRESH_MS,
  });
}

export const keyOf = (task: Pick<ScheduledTask, "provider" | "id">) =>
  `${task.provider}:${task.id}`;

export function useAgentName() {
  const providers = useAgentProviders().data?.providers ?? [];
  return (provider: string, agent?: string) => {
    const snapshot = providers.find((p) => p.id === provider);
    const model = agent ? snapshot?.models.find((m) => m.slug === agent) : undefined;
    return model?.name ?? snapshot?.name ?? "Removed agent";
  };
}

export const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host : url);

/** What one agent's tasks can run on; none for an agent that doesn't say. */
export function useTaskModels(provider: string, agent: string, enabled = true) {
  return useQuery({
    queryKey: ["agent-scheduled-models", provider, agent],
    queryFn: () => agentApi.scheduledModels(provider, agent),
    enabled: enabled && Boolean(provider),
    staleTime: 60_000,
  });
}

export const modelName = (models: TaskModels | undefined, id: string) =>
  models?.models.find((m) => m.id === id)?.name ?? id;

export function deliveryText(delivery: TaskDelivery): string {
  if (delivery.kind === "otter")
    return delivery.chat === "new" ? "A new chat in Otter each time" : "Its chat in Otter";
  if (delivery.kind === "none") return "Kept on the agent: not sent anywhere";
  if (delivery.kind === "webhook") return `Posted to a webhook (${hostOf(delivery.url)})`;
  if (delivery.kind === "elsewhere") return `Sent to ${delivery.label}`;
  return [
    delivery.label,
    delivery.to,
    delivery.threadId ? `topic ${delivery.threadId}` : null,
    delivery.accountId && delivery.accountId !== "default" ? `as ${delivery.accountId}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export type TaskFilter = {
  agent: string | null;
  status: "all" | "active" | "paused" | "attention";
};
export const NO_FILTER: TaskFilter = { agent: null, status: "all" };

export const TASK_STATUSES: { value: TaskFilter["status"]; label: string }[] = [
  { value: "all", label: "Any status" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "attention", label: "Needs attention" },
];

export const isFiltering = (filter: TaskFilter) => filter.agent !== null || filter.status !== "all";

/** The agents tasks run on, each with one of its tasks (for its name) and how many, most first. */
export function taskAgents(
  tasks: ScheduledTask[],
): [string, { task: ScheduledTask; count: number }][] {
  const agents = new Map<string, { task: ScheduledTask; count: number }>();
  for (const task of tasks) {
    const seen = agents.get(agentKey(task));
    agents.set(agentKey(task), { task: seen?.task ?? task, count: (seen?.count ?? 0) + 1 });
  }
  return [...agents].sort((a, b) => b[1].count - a[1].count);
}
export const agentKey = (task: ScheduledTask) => `${task.provider}|${task.agent ?? ""}`;
export const needsAttention = (task: ScheduledTask) =>
  task.lastRun?.status === "error" || Boolean(task.autoPaused || task.deliveryProblem);

export function matches(task: ScheduledTask, filter: TaskFilter): boolean {
  if (filter.agent && agentKey(task) !== filter.agent) return false;
  if (filter.status === "active") return task.enabled;
  if (filter.status === "paused") return !task.enabled;
  if (filter.status === "attention") return needsAttention(task);
  return true;
}

/**
 * Where results go, as the editor holds it: `pick` is "keep" (as they go now: this chat, the last
 * conversation), "new-chat", "off", "webhook", or "channel:<id>".
 */
export type Destination = { pick: string; to: string; account: string; url: string };

export function destinationOf(
  task: ScheduledTask | null,
  agent?: AgentScheduledTasks,
): Destination {
  const none = { to: "", account: "", url: "" };
  if (!task) return { ...none, pick: agent?.can.deliverToOtter ? "new-chat" : "off" };
  const d = task.delivery;
  // A chat it can't post to (or Otter's, gone from the gateway) stays as it is: "keep".
  const chats = !task.undeliverable;
  if (d.kind === "none") return { ...none, pick: "off" };
  if (d.kind === "otter" && d.chat === "new" && chats && agent?.can.deliverToOtter)
    return { ...none, pick: "new-chat" };
  if (d.kind === "webhook" && agent?.can.webhooks) return { ...none, pick: "webhook", url: d.url };
  // A channel left to resolve its own recipient keeps going there until you name one.
  if (d.kind === "channel" && d.to && chats && agent?.channels.some((c) => c.id === d.channel))
    return { ...none, pick: `channel:${d.channel}`, to: d.to, account: d.accountId ?? "" };
  return { ...none, pick: "keep" };
}

/** What to save for where results go; a problem to show instead when it isn't complete. */
export function resultsToOf(dest: Destination): ResultsTo | undefined | { problem: string } {
  if (dest.pick === "keep") return undefined;
  if (dest.pick === "new-chat" || dest.pick === "off") return { kind: dest.pick };
  if (dest.pick === "webhook")
    return /^https?:\/\/\S+$/i.test(dest.url.trim())
      ? { kind: "webhook", url: dest.url.trim() }
      : { problem: "A webhook needs an http(s) address." };
  const channel = dest.pick.slice("channel:".length);
  if (!dest.to.trim()) return { problem: "Say who on it gets the results." };
  return {
    kind: "channel",
    channel,
    to: dest.to.trim(),
    ...(dest.account ? { accountId: dest.account } : {}),
  };
}

export const ownerKey = (o: { provider: string; agent?: string }) =>
  `${o.provider}|${o.agent ?? ""}`;

/** What Scheduled's row says: how many tasks are on, and whether one isn't working. */
export function scheduledSummary(agents: AgentScheduledTasks[]) {
  const tasks = agents.flatMap((a) => a.tasks);
  return {
    active: tasks.filter((t) => t.enabled).length,
    failing:
      tasks.some((t) => t.enabled && t.lastRun?.status === "error") || agents.some((a) => a.error),
  };
}

/** What to do, what to say if it fails, and how the task looks meanwhile. */
export type TaskAction = {
  run: () => Promise<unknown>;
  failed: string;
  shows?: { key: string; patch: Partial<ScheduledTask> };
};

/** Does something to a task, showing it done at once (`shows`) and saying so when it fails. */
export function useTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ run }: TaskAction) => run(),
    onMutate: async ({ shows }) => {
      if (!shows) return undefined;
      await qc.cancelQueries({ queryKey: SCHEDULED_TASKS_KEY });
      const before = qc.getQueryData<AgentScheduledTasks[]>(SCHEDULED_TASKS_KEY);
      qc.setQueryData<AgentScheduledTasks[]>(SCHEDULED_TASKS_KEY, (agents) =>
        agents?.map((a) => ({
          ...a,
          tasks: a.tasks.map((t) => (keyOf(t) === shows.key ? { ...t, ...shows.patch } : t)),
        })),
      );
      return { before };
    },
    onError: (error, { failed }, context) => {
      if (context?.before) qc.setQueryData(SCHEDULED_TASKS_KEY, context.before);
      host().notice({ tone: "error", title: failed, body: readableError(error) });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SCHEDULED_TASKS_KEY }),
  });
}

/** Runs it now, saying so once it's started. */
export const runTaskNow = (task: ScheduledTask): TaskAction => ({
  run: async () => {
    await agentApi.runScheduledTask(task.provider, task.id);
    host().notice({ tone: "success", title: `${task.name} is running` });
  },
  failed: "Couldn't start it",
});

export const enableTask = (task: ScheduledTask, enabled: boolean): TaskAction => ({
  run: () => agentApi.setScheduledTaskEnabled(task.provider, task.id, enabled),
  failed: enabled ? "Couldn't resume it" : "Couldn't pause it",
  shows: { key: keyOf(task), patch: { enabled } },
});

export const deleteTask = (task: ScheduledTask): TaskAction => ({
  run: () => agentApi.deleteScheduledTask(task.provider, task.id),
  failed: "Couldn't delete it",
});

const byNext = (a: ScheduledTask, b: ScheduledTask) =>
  (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name);

/**
 * The list's sections, by what you'd do about them: what's broken, what runs next, what's off.
 * An agent's own tasks (its config's, a plugin's) sit with the rest: they're as much yours to watch.
 */
export function taskSections(tasks: ScheduledTask[]) {
  const attention = tasks.filter(needsAttention).sort(byNext);
  const active = tasks.filter((t) => t.enabled && !needsAttention(t)).sort(byNext);
  const paused = tasks
    .filter((t) => !t.enabled && !needsAttention(t))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { attention, active, paused, ordered: [...attention, ...active, ...paused] };
}

/** What Scheduled shows instead of its sections, when not them. */
export function scheduledEmpty(
  query: { isLoading: boolean; isError: boolean },
  agents: AgentScheduledTasks[],
  shown: ScheduledTask[],
): "loading" | "error" | "no-agents" | "nothing" | "no-match" | null {
  if (query.isLoading) return "loading";
  if (query.isError) return "error";
  if (agents.length === 0) return "no-agents";
  if (agents.every((a) => a.tasks.length === 0) && agents.every((a) => !a.error)) return "nothing";
  return shown.length === 0 ? "no-match" : null;
}

/** Tasks can be made on one of the agents. */
export const canCreateTasks = (agents: AgentScheduledTasks[]) =>
  agents.some((a) => a.can.create && !a.readOnly);

/** What a task's row says at its end: it runs, the agent paused it, it failed, it's off, or when next. */
export function taskWhen(
  task: ScheduledTask,
  now: number,
): { kind: "running" | "auto-paused" | "failed" | "paused" | "next"; text: string } | null {
  if (task.running) return { kind: "running", text: "Running" };
  if (task.autoPaused) return { kind: "auto-paused", text: "Paused by agent" };
  if (task.lastRun?.status === "error")
    return { kind: "failed", text: `Failed ${agoText(task.lastRun.at, now)}` };
  if (!task.enabled) return { kind: "paused", text: "Paused" };
  return task.nextRunAt ? { kind: "next", text: untilText(task.nextRunAt, now) } : null;
}

/** What isn't working with a task, when something isn't. */
export function taskProblem(task: ScheduledTask): string | null {
  if (task.lastRun?.status !== "error" && !task.autoPaused && !task.deliveryProblem) return null;
  return task.autoPaused ?? task.deliveryProblem ?? `The last run failed: ${task.lastRun?.error}`;
}

export const managedNote = (managedBy: string) =>
  `${managedBy} keeps this one: run or pause it here, change it there.`;

/** Otter can change it: its agent lets it, nothing else keeps it, and its schedule is one Otter knows. */
export const taskEditable = (task: ScheduledTask, agent: AgentScheduledTasks) =>
  !agent.readOnly && !task.managedBy && task.schedule.kind !== "other";

/** A task page's line under its name: it runs now, or when it runs next. */
export function taskNext(task: ScheduledTask, now: number): string | null {
  if (task.running) return "Running now";
  return task.enabled && task.nextRunAt ? `Next run: ${dayTimeText(task.nextRunAt, now)}` : null;
}

/** What a task page warns of: the agent paused it, or its last run failed. */
export function taskCallout(task: ScheduledTask, now: number): string | null {
  if (task.autoPaused) return `${task.autoPaused}. Resume it once what failed is fixed.`;
  if (task.lastRun?.status === "error" && !task.running)
    return `The last run failed ${agoText(task.lastRun.at, now)}${task.lastRun.error ? `: ${task.lastRun.error}` : "."}`;
  return null;
}

/** The chats a task's results came to in Otter, latest first (five at most). */
export function taskResults(conversations: Conversation[], task: ScheduledTask): Conversation[] {
  return conversations
    .filter(
      (c) =>
        c.provider === task.provider &&
        c.turns.some(
          (t) =>
            t.delivered?.kind === "automation" &&
            (t.delivered.jobId ? t.delivered.jobId === task.id : t.delivered.name === task.name),
        ),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);
}

/** A task's past runs, latest first, kept current while it runs. */
export function useTaskRuns(task: ScheduledTask) {
  return useQuery({
    queryKey: ["agent-scheduled-runs", task.provider, task.id, task.lastRun?.at ?? 0],
    queryFn: () => agentApi.scheduledTaskRuns(task.provider, task.id, 20),
    refetchInterval: task.running ? BUSY_REFRESH_MS : false,
  });
}

/** What a run wrote. */
export function useRunTranscript(task: ScheduledTask, run: TaskRun) {
  const transcript = useQuery({
    queryKey: ["agent-scheduled-run", task.provider, task.id, run.id],
    queryFn: () => agentApi.scheduledRunTranscript(task.provider, task.id, run.id),
    staleTime: Infinity,
  });
  const replies = (transcript.data ?? []).filter((m) => m.role === "assistant" && m.text.trim());
  return { transcript, text: replies.map((m) => m.text).join("\n\n") };
}

export const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const runStatusLabel = (run: TaskRun) =>
  run.status === "error" ? "Failed" : run.status === "skipped" ? "Skipped" : "Done";

/** A run's row: when, and how long it took on which model. */
export const runWhen = (run: TaskRun, now: number) => capitalized(dayTimeText(run.at, now));

export const runMeta = (run: TaskRun) =>
  [run.durationMs !== undefined ? durationText(run.durationMs) : null, run.model]
    .filter(Boolean)
    .join(" · ");

/** Where a run's result was sent: Otter, or a channel and who on it. */
export function runSentTo(run: TaskRun, agent: AgentScheduledTasks): string | null {
  const sentTo = run.sentTo;
  if (!sentTo) return null;
  if (sentTo.channel === "otter") return "Otter";
  return [
    agent.channels.find((c) => c.id === sentTo.channel)?.label ?? sentTo.channel,
    sentTo.to && /^https?:\/\//i.test(sentTo.to) ? hostOf(sentTo.to) : sentTo.to,
  ]
    .filter(Boolean)
    .join(" ");
}

/** What happened to a run's result. */
export function runDelivery(
  run: TaskRun,
  agent: AgentScheduledTasks,
): { tone: "muted" | "warning"; text: string } | null {
  const sentTo = runSentTo(run, agent);
  if (run.silent) return { tone: "muted", text: "It chose to send nothing this time." };
  if (run.deliveryError)
    return {
      tone: "warning",
      text: `Couldn't send it${sentTo ? ` to ${sentTo}` : ""}: ${run.deliveryError}`,
    };
  if (run.delivered === false) return { tone: "muted", text: "Its result wasn't delivered." };
  if (sentTo && run.delivered) return { tone: "muted", text: `Sent to ${sentTo}.` };
  return null;
}
