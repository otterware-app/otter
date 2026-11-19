/** When a scheduled task runs. `text` is the agent's own wording for one Otter can't edit. */
export type TaskSchedule =
  | { kind: "cron"; expr: string; tz?: string }
  | { kind: "every"; everyMs: number }
  /** Once, at an ISO time. */
  | { kind: "at"; at: string }
  | { kind: "other"; text: string };

export type TaskRunStatus = "ok" | "error" | "skipped";

/** Where a task's result goes. */
export type TaskDelivery =
  | { kind: "none" }
  | { kind: "otter"; chat: "new" | "one" }
  /** A chat app the agent has set up (Slack, Telegram…); channel "last" is wherever it was last talked to. */
  | {
      kind: "channel";
      channel: string;
      label: string;
      to?: string;
      accountId?: string;
      threadId?: string;
    }
  | { kind: "webhook"; url: string }
  /** Somewhere Otter can name but not change (one of Hermes's platforms). */
  | { kind: "elsewhere"; label: string };

/** A chat app the agent can send results to, and the accounts it sends from. */
export interface DeliveryChannel {
  id: string;
  label: string;
  accounts: string[];
  defaultAccount?: string;
}

/** Someone or somewhere on a channel results can go to (a Slack channel, a Telegram chat). */
export interface ChannelTarget {
  target: string;
  label?: string;
  accountId?: string;
}

/** A task an agent runs on its own, on a schedule. */
export interface ScheduledTask {
  provider: string;
  id: string;
  /** Which of the provider's agents runs it (an OpenClaw agent: a model slug of the provider's). */
  agent?: string;
  name: string;
  description?: string;
  /** What it asks the agent; absent when it isn't a message (a heartbeat, a command). */
  prompt?: string;
  /** What it runs when it isn't a message to the agent ("Runs `npm test`"). */
  runs?: string;
  schedule: TaskSchedule;
  /** It runs only when its own check says so. */
  conditional?: true;
  enabled: boolean;
  running: boolean;
  nextRunAt?: number;
  lastRun?: { at: number; status: TaskRunStatus; error?: string; durationMs?: number };
  delivery: TaskDelivery;
  /** Why its results may not arrive, as the agent sees it. */
  deliveryProblem?: string;
  /** Where its failures are reported, when that's set apart from its results. */
  failureAlerts?: string;
  /** Kept by the agent itself or one of its plugins (OpenClaw's heartbeat): it can be paused and run, not changed. */
  managedBy?: string;
  /** Why the agent paused it on its own. */
  autoPaused?: string;
  /** The version of it shown, so a save doesn't overwrite a change made since. */
  revision?: string;
  /** Its results can't go to a chat (OpenClaw: only an agent turn in a session of its own can). */
  undeliverable?: true;
  /** The model it runs on, when it has one of its own rather than its agent's. */
  model?: string;
  /** The chats it belongs to (their sessions): the one it was made in, the one its results go to. */
  chats?: string[];
}

/** One agent's tasks, or why they couldn't be read. */
export interface AgentScheduledTasks {
  provider: string;
  tasks: ScheduledTask[];
  error?: string;
  /** Why tasks can be read but not changed (the gateway didn't give Otter full access). */
  readOnly?: string;
  /** The chat apps results can go to, besides Otter. */
  channels: DeliveryChannel[];
  /** What the agent can do with them beyond listing, pausing, running and deleting. */
  can: {
    create: boolean;
    /** Results can come to Otter as chats. */
    deliverToOtter: boolean;
    /** Results can be posted to a URL. */
    webhooks: boolean;
    /** Past runs, each with its transcript. */
    history: boolean;
    /** Schedules it understands; cron with a time zone. */
    timeZones: boolean;
  };
}

/** Where a task's results should go. */
export type ResultsTo =
  | { kind: "new-chat" }
  | { kind: "off" }
  | { kind: "channel"; channel: string; to: string; accountId?: string }
  | { kind: "webhook"; url: string };

export interface ScheduledTaskInput {
  name: string;
  prompt?: string;
  schedule: Exclude<TaskSchedule, { kind: "other" }>;
  agent?: string;
  /** Unset leaves them where they go (this chat, wherever they went). */
  resultsTo?: ResultsTo;
  /** A model of its own; null runs it on its agent's. Unset leaves it as it is. */
  model?: string | null;
  /** The version edited (`ScheduledTask.revision`). */
  revision?: string;
}

/** A model a task can run on. */
export interface TaskModel {
  id: string;
  name: string;
}

/** What an agent's tasks can run on: its own model, or one of these. */
export interface TaskModels {
  /** The agent's own model, which a task without one of its own runs on. */
  agentModel?: string;
  models: TaskModel[];
}

export interface TaskRun {
  id: string;
  at: number;
  status: TaskRunStatus;
  durationMs?: number;
  error?: string;
  summary?: string;
  model?: string;
  delivered?: boolean;
  /** The agent chose to send nothing this time. */
  silent?: true;
  /** Where its result was sent (a channel id, and who on it). */
  sentTo?: { channel: string; to?: string };
  /** Why sending its result failed. */
  deliveryError?: string;
}
