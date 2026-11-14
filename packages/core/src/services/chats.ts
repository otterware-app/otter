/**
 * Agent chats (contracts' chats.ts), the account's (agent-sync.ts): read from this device's copy,
 * a chat and each of its turns an entry. The renderer saves each change as it comes, sending
 * only the turns that changed: a long chat that streams writes one turn, not itself whole.
 */

import { chatKey, type ChatRecord, type TurnRecord } from "@otter/contracts/agent-sync";
import {
  LOCAL_AGENT_KINDS,
  type Chat,
  type ChatMessageMatch,
  type ChatSave,
  type ChatTurn,
} from "@otter/contracts/chats";
import { matchMessage, messageSnippet, messageTokens } from "@otter/shared/chat-search";

import { platform } from "../platform.js";
import { agentDb, deviceId, entry, mutate, onSynced } from "./agent-sync.js";
import { getProviderSettings } from "./agent/settings.js";
import { logger } from "../logger.js";
import { getOtterUser } from "./otter-account.js";

export { CHATS_CHANGED } from "./agent-sync.js";

type Device = { id: string; name: string };

const device = (): Device => ({
  id: deviceId(),
  name: platform().deviceName ?? "This computer",
});

/** While a turn streams, the account's other devices have it this often. */
const STREAMING_PUSH_MS = 300;

function turnsOf(chat: string): ChatTurn[] {
  return agentDb()
    .prepare(
      "SELECT value FROM agent_entries WHERE chat = ? AND value IS NOT NULL ORDER BY position, key",
    )
    .all(chat)
    .map((row) => (JSON.parse(String(row.value)) as TurnRecord).turn);
}

export async function listChats(): Promise<{ chats: ChatRecord[]; device: Device }> {
  if (!getOtterUser()) return { chats: [], device: device() };
  const chats = agentDb()
    .prepare(
      "SELECT value FROM agent_entries WHERE key >= 'chat/' AND key < 'chat0' AND value IS NOT NULL ORDER BY updated DESC",
    )
    .all()
    .map((row) => JSON.parse(String(row.value)) as ChatRecord);
  return { chats, device: device() };
}

export async function getChat(id: string): Promise<Chat | null> {
  if (!getOtterUser()) return null;
  const chat = entry<ChatRecord>(chatKey(id));
  return chat ? { ...chat, turns: turnsOf(id) } : null;
}

const SEARCH_LIMIT = 50;

/** Chats with a message holding every word of `query`, best first, each with its best message. */
export async function searchChats(query: string): Promise<ChatMessageMatch[]> {
  const tokens = messageTokens(query);
  if (tokens.length === 0 || !getOtterUser()) return [];
  const rows = agentDb()
    .prepare(
      `SELECT t.chat, t.key, t.role, t.text FROM agent_entries t
       JOIN agent_entries c ON c.key = 'chat/' || t.chat AND c.value IS NOT NULL
       WHERE t.chat IS NOT NULL AND t.value IS NOT NULL
       ORDER BY c.updated DESC, t.position DESC`,
    )
    .all();
  const best = new Map<string, ChatMessageMatch & { quality: number; offset: number }>();
  for (const row of rows) {
    const text = String(row.text);
    const match = matchMessage(text, tokens);
    const id = String(row.chat);
    if (!match || match.quality <= (best.get(id)?.quality ?? 0)) continue;
    best.set(id, {
      id,
      turnId: String(row.key).split("/").at(-1)!,
      role: row.role as ChatTurn["role"],
      snippet: messageSnippet(text, match.offset),
      ...match,
    });
  }
  return [...best.values()]
    .sort((a, b) => b.quality - a.quality)
    .slice(0, SEARCH_LIMIT)
    .map(({ quality: _quality, offset: _offset, ...match }) => match);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A Claude or Codex chat is the device's that started it. */
export async function saveChat({ chat, turnIds, turns, settled }: ChatSave): Promise<void> {
  if (!getOtterUser()) return;
  const before = entry<ChatRecord>(chatKey(chat.id));
  if (before === null) return;
  const kind = (await getProviderSettings()).agents.find((a) => a.id === chat.provider)?.kind;
  const local = kind !== undefined && LOCAL_AGENT_KINDS.includes(kind);
  const next: ChatRecord = { ...chat, device: chat.device ?? (local ? device() : null) };
  const fields = before
    ? Object.fromEntries(
        Object.entries(next).filter(
          ([key, value]) => !same(before[key as keyof ChatRecord], value),
        ),
      )
    : next;
  const stored = before ? turnsOf(chat.id).map((t) => t.id) : [];
  const order = new Set(turnIds);
  const removed = stored.filter((id) => !order.has(id));
  const reordered = stored.length !== turnIds.length || stored.some((id, i) => id !== turnIds[i]);
  await mutate(
    [
      ...(Object.keys(fields).length > 0
        ? [{ op: "chat.set" as const, chat: { ...fields, id: chat.id } }]
        : []),
      ...(turns.length > 0 || reordered
        ? [
            {
              op: "turns" as const,
              chat: chat.id,
              put: turns,
              order: turnIds,
              ...(removed.length > 0 && { removed }),
            },
          ]
        : []),
    ],
    settled ? 100 : STREAMING_PUSH_MS,
  );
}

export async function deleteChat(id: string): Promise<void> {
  if (!getOtterUser()) return;
  await mutate([{ op: "chat.delete", id }], 0);
}

/** Chats from before agents had ids name their kind ("openclaw"): they run on the account's agent of that kind. */
export async function relinkChats(): Promise<void> {
  if (!getOtterUser()) return;
  const { agents } = await getProviderSettings();
  const ofKind = new Map<string, string>();
  for (const agent of agents) if (!ofKind.has(agent.kind)) ofKind.set(agent.kind, agent.id);
  const { chats } = await listChats();
  await mutate(
    chats.flatMap((chat) => {
      const provider = ofKind.get(chat.provider);
      return provider ? [{ op: "chat.set" as const, chat: { id: chat.id, provider } }] : [];
    }),
  );
}

onSynced(
  () =>
    void relinkChats().catch((err: unknown) =>
      logger.failure("chats", "Couldn't move old chats to their agent", err),
    ),
);
