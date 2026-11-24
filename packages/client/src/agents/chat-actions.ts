import { readableError } from "../errors.ts";
import { host } from "../host.ts";
import { regenerateTitle, renameChat, shelveChat } from "./chat-store.ts";

export function settleChat(id: string): Promise<void> {
  return shelveChat(id, { snoozedUntil: null, settledAt: Date.now() });
}

/** Back among the active chats, from Snoozed or Settled. */
export function bringBackChat(id: string): Promise<void> {
  return shelveChat(id, { snoozedUntil: null, settledAt: null });
}

export function snoozeChat(id: string, until: number): Promise<void> {
  return shelveChat(id, { snoozedUntil: until, settledAt: null });
}

/** Renames a chat as typed; `onAgent`: the agent keeps the title too (its provider's `titles`). */
export function renameChatAs(id: string, title: string, onAgent: boolean): void {
  if (!title.trim()) host().notice({ tone: "warning", title: "A chat's title can't be empty" });
  else void renameChat(id, title, onAgent);
}

/** Asks the agent for a new title, saying so when it can't. */
export function regenerateChatTitle(id: string): Promise<void> {
  return regenerateTitle(id).catch((err: unknown) => {
    host().notice({
      tone: "error",
      title: "Couldn't regenerate the title",
      body: readableError(err),
    });
  });
}
