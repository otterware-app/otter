/** The chat each running turn is for, by its request id: what the browser's tools open pages in. */
const chats = new Map<string, string>();
const KEPT = 500;

export function setTurnChat(requestId: string, chatId: string): void {
  chats.set(requestId, chatId);
  if (chats.size > KEPT) chats.delete(chats.keys().next().value!);
}

export const turnChat = (requestId: string | undefined): string | undefined =>
  requestId ? chats.get(requestId) : undefined;
