import type { ChatTab } from "@otter/contracts/chats";
import type { AgentScheduledTasks, ScheduledTask } from "@otter/contracts/scheduled";
import { host } from "../host.ts";
import { openClawAgentId, type ChatProvider } from "./agent-providers.ts";
import type { Conversation } from "./chat-store.ts";
import { scheduleText, untilText } from "./scheduled-text.ts";

/** What the agent made: a draft, a file, an event; the rest is what it read. */
export const isOutput = (tab: ChatTab) =>
  tab.made ?? (tab.ref.kind === "draft" || tab.ref.kind === "file");

/** How many of each list the details show before "View all". */
export const DETAILS_SHOWN = 5;

/** A chat's details: who it's with, and what it made and read, newest first (closed tabs too). */
export function chatDetails(convo: Conversation, chatAgent: ChatProvider) {
  const agent = openClawAgentId(convo.sessionId);
  return {
    agent,
    agentName:
      (agent ? (chatAgent.provider?.models.find((m) => m.slug === agent)?.name ?? agent) : null) ??
      chatAgent.name,
    /** The agent behind a gateway's agent, and the computer a chat ran on. */
    about: [agent ? chatAgent.name : null, convo.device?.name].filter(Boolean).join(" · "),
    outputs: convo.tabs.filter(isOutput).toReversed(),
    sources: convo.tabs.filter((t) => !isOutput(t)).toReversed(),
  };
}

/** A page's title, or where it is when it has none of its own: its site and path. */
export function tabTitle(tab: ChatTab): string {
  if (tab.ref.kind !== "page" || tab.title !== tab.ref.url || !URL.canParse(tab.ref.url))
    return tab.title;
  const url = new URL(tab.ref.url);
  const path = url.pathname === "/" ? "" : decodeURIComponent(url.pathname).replace(/\/$/, "");
  return url.host.replace(/^www\./, "") + path;
}

/** What the agent runs on a schedule for a chat: made in it, or posting to it. */
export const chatTasks = (agents: AgentScheduledTasks[], sessionId: string) =>
  agents.flatMap((agent) => agent.tasks.filter((task) => task.chats?.includes(sessionId)));

/** A task's line under its name in a chat's details: how it repeats, and what's next. */
export function taskLine(task: ScheduledTask, now: number): string {
  const when = scheduleText(task.schedule);
  if (!task.enabled) return `${when} · Paused`;
  if (task.running) return `${when} · Running now`;
  return task.nextRunAt ? `${when} · next ${untilText(task.nextRunAt, now)}` : when;
}

/** Shown docked beside the chat when there's room; the button then hides or shows it. */
const DOCKED_KEY = "otter:chat-details-docked";

export function readDetailsDocked(): boolean {
  try {
    return host().storage.get(DOCKED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveDetailsDocked(shown: boolean): void {
  try {
    host().storage.set(DOCKED_KEY, String(shown));
  } catch {
    // Without storage it shows each time.
  }
}
