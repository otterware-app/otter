import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentScheduledTasks,
  ChannelTarget,
  DeliveryChannel,
  ScheduledTask,
  TaskModels,
} from "@otter/contracts/scheduled";
import { readableError } from "../errors.ts";
import { host } from "../host.ts";
import {
  SCHEDULED_TASKS_KEY,
  deliveryText,
  destinationOf,
  keyOf,
  modelName,
  ownerKey,
  resultsToOf,
  useTaskModels,
  type Destination,
} from "./agent-scheduled.ts";
import { canStartChat, enabledModels } from "./agent-providers.ts";
import { agentApi, type ProviderKind, type ProviderSnapshot } from "./api.ts";
import {
  localTimeZone,
  newWhenForm,
  scheduleOfForm,
  scheduleText,
  whenFormOf,
  whenProblem,
  type Repeat,
  type WhenForm,
} from "./scheduled-text.ts";

export type Option = { value: string; label: string };

export const REPEATS: { value: Repeat; label: string }[] = [
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "interval", label: "Every few minutes or hours" },
  { value: "once", label: "Once" },
  { value: "cron", label: "Custom (cron)" },
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const WEEKDAY_OPTIONS: Option[] = WEEKDAYS.map((d, i) => ({
  value: String(i),
  label: `on ${d}`,
}));

export const MONTH_DAY_OPTIONS: Option[] = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: i < 28 ? `on day ${i + 1}` : `on day ${i + 1} (skips shorter months)`,
}));

export const UNIT_OPTIONS: Option[] = [
  { value: "minutes", label: "minutes" },
  { value: "hours", label: "hours" },
];

/** Repeats at a time of day. */
export const TIMED = new Set<Repeat>(["daily", "weekdays", "weekly", "monthly"]);

/** How a channel names who gets a message, as a hint for the recipient field. */
const TARGET_HINTS: Record<string, string> = {
  slack: "channel:C0123ABC or user:U0123ABC",
  discord: "channel:<id> or user:<id>",
  telegram: "@username or chat id",
  whatsapp: "+15551234567",
  signal: "+15551234567 or group:<id>",
  imessage: "chat_id:123 or +15551234567",
  matrix: "room:!id:server or user:@you:server",
  msteams: "user:<id> or conversation:<id>",
};

export const targetHint = (channel: string) =>
  TARGET_HINTS[channel] ?? "A chat, user or phone number";

/** The select's value for a schedule with no zone of its own: the agent's. */
const AGENT_ZONE = "agent";
/** The select's value for a task with no model of its own: the agent's. */
const AGENT_MODEL = "agent";

/** Who can run a new task: each agent that makes them, or each of a gateway's agents that's on (`subAgents`). */
export type Owner = { provider: string; agent?: string; label: string };

export function taskOwners(
  agents: AgentScheduledTasks[],
  providers: ProviderSnapshot[],
  subAgents: (kind: ProviderKind) => boolean,
): Owner[] {
  return agents
    .filter((a) => a.can.create && !a.readOnly)
    .flatMap((a) => {
      const snapshot = providers.find((p) => p.id === a.provider);
      const name = snapshot?.name ?? a.provider;
      if (!snapshot || !subAgents(snapshot.kind)) return [{ provider: a.provider, label: name }];
      if (!canStartChat(snapshot)) return [];
      if (!snapshot.models.length) return [{ provider: a.provider, label: name }];
      return enabledModels(snapshot).map((m) => ({
        provider: a.provider,
        agent: m.slug,
        label: snapshot.models.length > 1 ? `${m.name} · ${name}` : m.name,
      }));
    });
}

/** The channel results go to on, when they go to one. */
export const destinationChannel = (agent: AgentScheduledTasks, dest: Destination) =>
  dest.pick.startsWith("channel:")
    ? agent.channels.find((c) => `channel:${c.id}` === dest.pick)
    : undefined;

/** Where results can go: where they go now (when the editor can't say it), Otter, a channel, a webhook, nowhere. */
export function resultsOptions(task: ScheduledTask | null, agent: AgentScheduledTasks): Option[] {
  const chats = !task?.undeliverable;
  const d = task?.delivery;
  const keep = !d ? null : d.kind === "otter" && d.chat === "one" ? "This chat" : deliveryText(d);
  return [
    ...(keep && destinationOf(task, agent).pick === "keep" ? [{ value: "keep", label: keep }] : []),
    ...(chats && agent.can.deliverToOtter
      ? [{ value: "new-chat", label: "A new chat in Otter each time" }]
      : []),
    ...(chats ? agent.channels.map((c) => ({ value: `channel:${c.id}`, label: c.label })) : []),
    ...(agent.can.webhooks ? [{ value: "webhook", label: "A webhook" }] : []),
    { value: "off", label: "Off" },
  ];
}

export function resultsDescription(
  dest: Destination,
  channel: DeliveryChannel | undefined,
): string {
  if (dest.pick === "off") return "Results stay on the agent.";
  if (dest.pick === "webhook") return "Each finished run is posted there.";
  if (dest.pick === "new-chat")
    return "Each run's result arrives as a new chat in Otter, and notifies you.";
  if (channel) return `The agent posts each result on ${channel.label}.`;
  return "Results keep going where they go now.";
}

/**
 * Where results go once you pick `pick`: the task's own recipient and account when it's the
 * channel it posts to now, else none, from the channel's default account when it has several.
 */
export function pickDestination(
  dest: Destination,
  pick: string,
  task: ScheduledTask | null,
  agent: AgentScheduledTasks,
): Destination {
  const d = task?.delivery;
  const next = agent.channels.find((c) => `channel:${c.id}` === pick);
  const same = d?.kind === "channel" && `channel:${d.channel}` === pick;
  return {
    ...dest,
    pick,
    to: same ? (d.to ?? "") : "",
    account:
      same && d.accountId
        ? d.accountId
        : next && next.accounts.length > 1
          ? (next.defaultAccount ?? next.accounts[0])
          : "",
  };
}

/** The account results are posted as on a channel. */
export const destinationAccount = (dest: Destination, channel: DeliveryChannel | undefined) =>
  dest.account || channel?.defaultAccount || channel?.accounts[0];

/** Who on a channel the agent can name, for the recipient field: those reached as the account. */
export function useDeliveryTargets(
  agent: AgentScheduledTasks,
  agentId: string,
  channel: DeliveryChannel | undefined,
  account: string | undefined,
): ChannelTarget[] {
  const targets = useQuery({
    queryKey: ["agent-scheduled-targets", agent.provider, agentId, channel?.id],
    queryFn: () => agentApi.scheduledTargets(agent.provider, agentId, channel!.id),
    enabled: Boolean(channel),
    staleTime: 60_000,
  });
  return (targets.data ?? []).filter((t) => !account || !t.accountId || t.accountId === account);
}

/** The models a task can run on, the agent's own first; a model no longer offered stays listed. */
export function modelOptions(models: TaskModels | undefined, model: string): Option[] {
  return [
    {
      value: AGENT_MODEL,
      label: models?.agentModel
        ? `The agent's (${modelName(models, models.agentModel)})`
        : "The agent's",
    },
    ...(model && !models?.models.some((m) => m.id === model)
      ? [{ value: model, label: model }]
      : []),
    ...(models?.models ?? []).map((m) => ({ value: m.id, label: m.name })),
  ];
}

/** The time zones a schedule can be in, the agent's first; a zone this device doesn't know stays listed. */
export function zoneOptions(tz: string, zones: string[]): Option[] {
  return [
    { value: AGENT_ZONE, label: "The agent's time zone" },
    ...(zones.includes(tz) || !tz ? zones : [tz, ...zones]).map((z) => ({
      value: z,
      label: z.replaceAll("_", " "),
    })),
  ];
}

/**
 * The task editor's state, a new task's or one's being changed: who runs it, its name, what it
 * asks, when (from daily to cron, in a time zone), on which model, and where results go. `save`
 * says what's missing instead (and throws), else saves it and says so.
 */
export function useTaskEditor({
  task,
  agents,
  providers,
  subAgents,
  onCreated,
}: {
  task: ScheduledTask | null;
  agents: AgentScheduledTasks[];
  providers: ProviderSnapshot[];
  subAgents: (kind: ProviderKind) => boolean;
  /** A new task was made: its key. */
  onCreated: (key: string) => void;
}) {
  const qc = useQueryClient();
  const choices = taskOwners(agents, providers, subAgents);
  const [owner, setOwnerKey] = useState(() =>
    task ? ownerKey(task) : choices[0] ? ownerKey(choices[0]) : "",
  );
  const provider = task?.provider ?? owner.split("|")[0];
  const agentTasks = agents.find((a) => a.provider === provider);
  const ownerSnapshot = providers.find((p) => p.id === provider);
  const can = agentTasks?.can;
  const [name, setNameValue] = useState(task?.name ?? "");
  const [prompt, setPromptValue] = useState(task?.prompt ?? "");
  const [when, setWhen] = useState<WhenForm>(
    () => (task && whenFormOf(task.schedule)) || newWhenForm(),
  );
  const [destination, setDestinationValue] = useState(() => destinationOf(task, agentTasks));
  const [model, setModelValue] = useState(task?.model ?? "");
  const routes = Boolean(can?.deliverToOtter || can?.webhooks || agentTasks?.channels.length);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [whenChanged, setWhenChanged] = useState(false);
  const asksPrompt = !task || task.prompt !== undefined;
  // Only an agent turn in a session of its own runs on a model of its own (OpenClaw).
  const ownModel = asksPrompt && !task?.undeliverable;
  const agentId = task?.agent ?? owner.split("|")[1] ?? "";
  const models = useTaskModels(provider, agentId, ownModel).data;
  const zoned = Boolean(can?.timeZones) && (TIMED.has(when.repeat) || when.repeat === "cron");
  // An untouched "when" goes back exactly as it was, whatever the fields can't show.
  const kept = task && !whenChanged && task.schedule.kind !== "other" ? task.schedule : null;
  const schedule = () => kept ?? scheduleOfForm(zoned ? when : { ...when, tz: "" });
  const summary = kept ? scheduleText(kept) : whenProblem(when) ? null : scheduleText(schedule());

  const save = async () => {
    const results = routes ? resultsToOf(destination) : undefined;
    const problem =
      (!name.trim() && "Give it a name.") ||
      (asksPrompt && !prompt.trim() && "Say what the agent should do.") ||
      (kept ? null : whenProblem(when)) ||
      (results && "problem" in results ? results.problem : null);
    if (problem) {
      setError(problem);
      throw new Error(problem);
    }
    setBusy(true);
    setError(null);
    try {
      const agent = owner.split("|")[1] || undefined;
      const saved = await agentApi.saveScheduledTask(provider, task?.id ?? null, {
        name: name.trim(),
        ...(asksPrompt ? { prompt: prompt.trim() } : {}),
        schedule: schedule(),
        ...(!task && agent ? { agent } : {}),
        ...(results && !("problem" in results) ? { resultsTo: results } : {}),
        ...(model !== (task?.model ?? "") ? { model: model || null } : {}),
        ...(task?.revision ? { revision: task.revision } : {}),
      });
      await qc.invalidateQueries({ queryKey: SCHEDULED_TASKS_KEY });
      host().notice({ tone: "success", title: task ? "Saved" : `${name.trim()} is scheduled` });
      if (!task && saved.id) onCreated(keyOf({ provider, id: saved.id }));
    } catch (err) {
      setError(readableError(err));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  return {
    owners: choices.map((o) => ({ value: ownerKey(o), label: o.label })),
    owner,
    /** A new task's agent: its model and where results go start over. */
    setOwner: (value: string) => {
      setOwnerKey(value);
      setModelValue("");
      setDestinationValue(
        destinationOf(
          null,
          agents.find((a) => a.provider === value.split("|")[0]),
        ),
      );
    },
    ownerKind: ownerSnapshot?.kind,
    ownerName: ownerSnapshot?.name ?? "the agent",
    agentTasks,
    agentId,
    name,
    setName: (value: string) => {
      setError(null);
      setNameValue(value);
    },
    asksPrompt,
    prompt,
    setPrompt: (value: string) => {
      setError(null);
      setPromptValue(value);
    },
    /** The model field shows: the task can have one, and the agent offers some (or it has one). */
    picksModel: ownModel && Boolean(models?.models.length || task?.model),
    modelValue: model || AGENT_MODEL,
    modelOptions: modelOptions(models, model),
    setModel: (value: string) => setModelValue(value === AGENT_MODEL ? "" : value),
    when,
    setWhen: (patch: Partial<WhenForm>) => {
      setError(null);
      setWhenChanged(true);
      setWhen((w) => ({ ...w, ...patch }));
    },
    zoned,
    zoneValue: when.tz || AGENT_ZONE,
    zoneOptions: zoneOptions(when.tz, Intl.supportedValuesOf?.("timeZone") ?? [localTimeZone()]),
    setZone: (tz: string) => {
      setError(null);
      setWhenChanged(true);
      setWhen((w) => ({ ...w, tz: tz === AGENT_ZONE ? "" : tz }));
    },
    /** How the schedule reads, once it's complete. */
    summary,
    /** Where results go can be chosen. */
    routes,
    destination,
    setDestination: (next: Destination) => {
      setError(null);
      setDestinationValue(next);
    },
    /** Results can't reach Otter until OpenClaw's Messages from your agents is set up. */
    needsDeliveries:
      ownerSnapshot?.kind === "openclaw" && !can?.deliverToOtter && !task?.undeliverable,
    error,
    busy,
    save,
  };
}
