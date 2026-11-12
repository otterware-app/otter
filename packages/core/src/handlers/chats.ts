import type { ChatSave } from "@otter/contracts/chats";

import { handle } from "../ipc.js";
import * as chats from "../services/chats.js";

type Params = Record<string, unknown> | undefined;

function str(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Invalid parameter: "${name}".`);
  return value;
}

function save(value: unknown): ChatSave {
  const p = value as Partial<ChatSave> | null;
  const c = p?.chat;
  if (!c || typeof c.id !== "string" || !Array.isArray(c.tabs))
    throw new Error('Invalid parameter: "chat".');
  if (!Array.isArray(p.turnIds) || !p.turnIds.every((id) => typeof id === "string"))
    throw new Error('Invalid parameter: "turnIds".');
  if (!Array.isArray(p.turns)) throw new Error('Invalid parameter: "turns".');
  return { chat: c, turnIds: p.turnIds, turns: p.turns, settled: p.settled !== false };
}

export function registerChatHandlers(): void {
  handle("chats:list", () => chats.listChats());
  handle("chats:get", (params: unknown) => chats.getChat(str((params as Params)?.id, "id")));
  handle("chats:search", (params: unknown) => {
    const query = (params as Params)?.query;
    return chats.searchChats(typeof query === "string" ? query : "");
  });
  handle("chats:save", (params: unknown) => chats.saveChat(save(params)));
  handle("chats:delete", (params: unknown) => chats.deleteChat(str((params as Params)?.id, "id")));
}
