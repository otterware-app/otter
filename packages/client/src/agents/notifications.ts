import type { AgentPointer } from "@otter/contracts/relay";
import { agentApi, type AgentNoticeKind, type AgentNotificationsMode } from "./api.ts";
import { useChats, type Conversation } from "./chat-store.ts";

/** Whether an agent's notice of this kind shows, in this mode (core's notifyAsk decides alike). */
export const noticeShows = (mode: AgentNotificationsMode, kind: AgentNoticeKind) =>
  mode === "all" || (mode === "needs-you" && kind !== "finished");

export type PushPointer = Omit<AgentPointer, "channel" | "at">;

const KINDS = new Set<string>(["message", "finished", "approval", "question"]);

/** The pointer an agent's push carries (`AgentPushMetadata`), when it's one this app reads. */
export function pushPointer(metadata: unknown, userId: string | null): PushPointer | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const { kind, userId: user, pointer } = metadata as Record<string, unknown>;
  if (kind !== "agent" || (userId !== null && user !== userId)) return null;
  if (typeof pointer !== "object" || pointer === null) return null;
  const p = pointer as Record<string, unknown>;
  if (typeof p.agentId !== "string" || !p.agentId || !KINDS.has(p.kind as string)) return null;
  return {
    ...(p as PushPointer),
    sessionKey: typeof p.sessionKey === "string" ? p.sessionKey : null,
    resolved: p.resolved === true,
  };
}

/** The session a silent push says was read or answered on another device, so its alerts go. */
export function clearedSession(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const { kind, sessionKey } = metadata as Record<string, unknown>;
  return kind === "agent-clear" && typeof sessionKey === "string" ? sessionKey : null;
}

/** The chat a pointer is about, when there is one here yet. */
export const pointerChat = (conversations: Conversation[], pointer: PushPointer) =>
  pointer.sessionKey ? conversations.find((c) => c.sessionId === pointer.sessionKey) : undefined;

const PUSHED_CHAT_WAIT_MS = 15_000;

/**
 * The chat a tapped push opens: the one it points at, or, for a session with no chat here yet,
 * the one the agent makes of it once asked to catch up (or the account brings). Null if none comes.
 */
export async function pushedChat(pointer: PushPointer): Promise<Conversation | null> {
  const find = () => pointerChat(useChats.getState().conversations, pointer) ?? null;
  if (find() || !pointer.sessionKey) return find();
  const chat = new Promise<Conversation | null>((resolve) => {
    const done = (found: Conversation | null) => {
      clearTimeout(timer);
      off();
      resolve(found);
    };
    const off = useChats.subscribe(() => {
      const found = find();
      if (found) done(found);
    });
    const timer = setTimeout(() => done(null), PUSHED_CHAT_WAIT_MS);
  });
  void agentApi.delivered(pointer.sessionKey).catch(() => {});
  return chat;
}

/** Whether a push shows while the app is open: by the setting, and not for the chat on screen. */
export function pushShows(
  pointer: PushPointer,
  mode: AgentNotificationsMode,
  watched: Conversation | undefined,
): boolean {
  if (!noticeShows(mode, pointer.kind)) return false;
  return !pointer.sessionKey || watched?.sessionId !== pointer.sessionKey;
}
