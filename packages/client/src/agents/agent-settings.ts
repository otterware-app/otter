import { useEffect, useState } from "react";
import { listen } from "../bridge.ts";
import { host } from "../host.ts";
import { mailApi, type SyncSettings } from "../mail/api.ts";
import { AUTO_SETTLE_MAX_DAYS } from "./auto-settle.ts";
import { useSetProvidersState } from "./agent-providers.ts";
import {
  agentApi,
  type AgentNotificationsMode,
  type AgentSettingsPatch,
  type ProviderSnapshot,
} from "./api.ts";
import type { FollowUpBehavior } from "./chat-queue.ts";

const failed = (what: string, error: unknown) =>
  host().notice({
    tone: "error",
    title: `${what}: ${error instanceof Error ? error.message : String(error)}`,
  });

/** Changes your agents' settings (which one new chats start with, an agent's name, picture, model…). */
export function useUpdateAgents() {
  const setState = useSetProvidersState();
  return (patch: AgentSettingsPatch) => {
    console.log("[Settings:updateAgent]", patch);
    agentApi
      .updateSettings(patch)
      .then(setState, (error: unknown) => failed("Could not save", error));
  };
}

/** Adds an agent of a kind; `onAdded` hears its id, to open its page and set it up. */
export function useAddAgent(onAdded: (id: string) => void) {
  const setState = useSetProvidersState();
  return (kind: string) => {
    console.log("[Settings:addAgent]", { kind });
    agentApi.add(kind).then(
      ({ id, state }) => {
        setState(state);
        onAdded(id);
      },
      (error: unknown) => failed("Could not add it", error),
    );
  };
}

/** Removes an agent from every device; `onRemoved` once it's gone. */
export function useRemoveAgent(id: string, onRemoved: () => void) {
  const setState = useSetProvidersState();
  const [removing, setRemoving] = useState(false);
  const remove = () => {
    setRemoving(true);
    console.log("[Settings:removeAgent]", { id });
    agentApi.remove(id).then(
      (next) => {
        setState(next);
        onRemoved();
      },
      (error: unknown) => {
        setRemoving(false);
        failed("Could not remove it", error);
      },
    );
  };
  return { remove, removing };
}

/** An agent's status needs a look: a warning, or it's unavailable. */
export const needsAttention = (p: ProviderSnapshot) =>
  p.status === "warning" || p.status === "error";

/** When the agents were last checked. */
export const lastChecked = (providers: ProviderSnapshot[]) =>
  Math.max(0, ...providers.map((p) => p.checkedAt ?? 0));

/** How long ago, briefly: "12s ago", "3m ago", "2h ago". */
export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export const AGENT_NOTIFICATIONS_OPTIONS: { value: AgentNotificationsMode; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "needs-you", label: "Only when needed" },
  { value: "off", label: "Off" },
];

/** What your phone hears of your agents; `computer`: what this device is called ("Mac"). */
export function agentNotificationsDescription(
  mode: AgentNotificationsMode | null,
  computer: string,
): string {
  const quiet = `Your phone stays quiet while you're active on your ${computer} unless you wrote from your phone.`;
  return mode === "needs-you"
    ? `Only approvals, questions, and agent messages. ${quiet}`
    : `Approvals, questions, agent messages, and long finished replies. ${quiet}`;
}

/** Which agent notifications reach your phone (a setting that follows the account), as it changes. */
export function useAgentNotificationsMode() {
  const [mode, setMode] = useState<AgentNotificationsMode | null>(null);
  useEffect(() => {
    let active = true;
    void mailApi
      .getSyncSettings()
      .then((settings) => {
        if (active) setMode(settings.agentNotificationsMode ?? "all");
      })
      .catch(() => {});
    const off = listen("settings:changed", (raw: unknown) => {
      const settings = raw as Partial<SyncSettings> | null;
      if (settings?.agentNotificationsMode) setMode(settings.agentNotificationsMode);
    });
    return () => {
      active = false;
      off();
    };
  }, []);
  const update = (next: AgentNotificationsMode) => {
    const previous = mode;
    setMode(next);
    void mailApi.setSyncSettings({ agentNotificationsMode: next }).catch((error: unknown) => {
      setMode(previous);
      failed("Could not save", error);
    });
  };
  return { mode, update };
}

export const FOLLOW_UP_BEHAVIORS: { value: FollowUpBehavior; label: string }[] = [
  { value: "queue", label: "Queue" },
  { value: "steer", label: "Steer" },
];

/** The days typed before chats settle on their own, within what's allowed; null for nothing usable. */
export function autoSettleDaysOf(typed: string): number | null {
  const days = Math.round(Number(typed));
  return typed.trim() && Number.isFinite(days)
    ? Math.min(AUTO_SETTLE_MAX_DAYS, Math.max(1, days))
    : null;
}

/**
 * An agent's state in a word or two, as the phone's rows show it: `tone` "ready" once it's
 * connected and on, "failed" when it doesn't answer.
 */
export function agentStatus(p: ProviderSnapshot): {
  text: string;
  tone: "ready" | "failed" | "muted";
} {
  if (!p.enabled) return { text: "Off", tone: "muted" };
  if (typeof p.settings.pairingRequest === "string" && p.settings.pairingRequest)
    return { text: "Waiting for approval", tone: "muted" };
  if (p.checkedAt === null) return { text: "Checking…", tone: "muted" };
  if (p.status === "ready") return { text: "Connected", tone: "ready" };
  if (!p.installed && p.status === "warning") return { text: "Not connected", tone: "muted" };
  return { text: "Not answering", tone: "failed" };
}

/** What the phone's Notifications setting says under it, for the account's choice. */
export function phoneNotificationsDescription(mode: AgentNotificationsMode | null): string {
  const what =
    mode === "off"
      ? "None, on any of your devices."
      : mode === "needs-you"
        ? "Only approvals, questions and agent messages."
        : "Approvals, questions, agent messages and long finished replies.";
  return `${what} Otter on your computer follows the same choice. Notifications name the chat and the agent, never what was said.`;
}
