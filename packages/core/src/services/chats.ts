/**
 * Agent chats (contracts' chats.ts), local-first: this device keeps them in SQLite, a row per
 * chat and a row per turn (as T3 Code keeps a row per message), and the renderer saves each
 * change as it comes, sending only the turns that changed: a long chat that streams writes one
 * turn, not itself whole. Each changed chat is written whole to the relay when signed in to an
 * Otter account. Chats not on the relay yet are `pending`, by id; a pull (on connecting, and on
 * the relay's `chats` event) takes the chats written elsewhere since, and leaves the pending ones
 * as they are here. Without an Otter account, chats stay on this device until one signs in.
 */

import {
  CHAT_LIMITS,
  LOCAL_AGENT_KINDS,
  chatForSync,
  type Chat,
  type ChatMessageMatch,
  type ChatSave,
  type ChatSummary,
  type ChatTurn,
  type ListChatsResponse,
} from "@otter/contracts/chats";
import { matchMessage, messageSnippet, messageTokens } from "@otter/shared/chat-search";

import { broadcast } from "../ipc.js";
import { readJson } from "../json-file.js";
import { logger } from "../logger.js";
import { platform, type SqlDatabase } from "../platform.js";
import { getProviderSettings } from "./agent/settings.js";
import { getOtterUser, relayRequest, RelayError } from "./otter-account.js";

export const CHATS_CHANGED = "chats:changed";
/** Where chats were kept before: read into the database once, then removed. */
const OLD_FILE = "chats.json";

type Device = { id: string; name: string };
type ChatRow = Omit<Chat, "turns">;

let opened: Promise<SqlDatabase> | null = null;

function database(): Promise<SqlDatabase> {
  opened ??= (async () => {
    const db = platform().database();
    db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        updatedAt INTEGER NOT NULL,
        chat TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_turns (
        chatId TEXT NOT NULL,
        id TEXT NOT NULL,
        position INTEGER NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        turn TEXT NOT NULL,
        PRIMARY KEY (chatId, id)
      );
      CREATE INDEX IF NOT EXISTS chat_turns_position ON chat_turns (chatId, position);
      CREATE TABLE IF NOT EXISTS chat_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const old = await readJson<{ chats?: Chat[]; pending?: string[]; device?: { id?: string } }>(
      OLD_FILE,
    );
    if (old) {
      try {
        transaction(db, () => {
          for (const chat of old.chats ?? []) writeChat(db, chat);
          setState(db, "pending", old.pending ?? []);
          if (old.device?.id) setState(db, "device", { id: old.device.id });
        });
        await platform().files.remove(OLD_FILE);
      } catch (err) {
        logger.failure("chats", "Couldn't move the chats into the database", err);
      }
    }
    return db;
  })();
  return opened;
}

function transaction<T>(db: SqlDatabase, work: () => T): T {
  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function state<T>(db: SqlDatabase, key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM chat_state WHERE key = ?").get(key);
  return row ? (JSON.parse(String(row.value)) as T) : fallback;
}

function setState(db: SqlDatabase, key: string, value: unknown): void {
  db.prepare(
    "INSERT INTO chat_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, JSON.stringify(value));
}

function device(db: SqlDatabase): Device {
  let saved = state<{ id: string } | null>(db, "device", null);
  if (!saved) {
    saved = { id: crypto.randomUUID() };
    setState(db, "device", saved);
  }
  return { id: saved.id, name: platform().deviceName ?? "This computer" };
}

const pendingIds = (db: SqlDatabase) => state<string[]>(db, "pending", []);

function queue(db: SqlDatabase, id: string, delay = 300): void {
  const pending = pendingIds(db);
  if (!pending.includes(id)) setState(db, "pending", [...pending, id]);
  schedulePush(delay);
}

/** While a turn streams, the relay (and so every other device) has the chat this often. */
const STREAMING_PUSH_MS = 15_000;

/** What a message says: a reply's text is in its items, between its steps. */
const messageText = (turn: ChatTurn) =>
  [turn.text, ...(turn.items ?? []).map((item) => (item.kind === "text" ? item.text : ""))]
    .filter(Boolean)
    .join("\n\n");

function putRow(db: SqlDatabase, chat: ChatRow): void {
  db.prepare(
    "INSERT INTO chats (id, updatedAt, chat) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updatedAt = excluded.updatedAt, chat = excluded.chat",
  ).run(chat.id, chat.updatedAt, JSON.stringify(chat));
}

/** The chat's turns become `turnIds`, in that order, with `turns` written over what they were. */
function putTurns(db: SqlDatabase, chatId: string, turnIds: string[], turns: ChatTurn[]): void {
  const position = new Map(turnIds.map((id, i) => [id, i]));
  const stored = db
    .prepare("SELECT id FROM chat_turns WHERE chatId = ? ORDER BY position")
    .all(chatId)
    .map((row) => String(row.id));
  if (stored.length !== turnIds.length || stored.some((id, i) => id !== turnIds[i])) {
    const remove = db.prepare("DELETE FROM chat_turns WHERE chatId = ? AND id = ?");
    const move = db.prepare("UPDATE chat_turns SET position = ? WHERE chatId = ? AND id = ?");
    for (const id of stored) {
      const at = position.get(id);
      if (at === undefined) remove.run(chatId, id);
      else move.run(at, chatId, id);
    }
  }
  const put = db.prepare(
    `INSERT INTO chat_turns (chatId, id, position, role, text, turn) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(chatId, id) DO UPDATE SET position = excluded.position, role = excluded.role,
       text = excluded.text, turn = excluded.turn`,
  );
  for (const turn of turns) {
    const at = position.get(turn.id);
    if (at !== undefined)
      put.run(chatId, turn.id, at, turn.role, messageText(turn), JSON.stringify(turn));
  }
}

function writeChat(db: SqlDatabase, { turns, ...chat }: Chat): void {
  putRow(db, chat);
  putTurns(
    db,
    chat.id,
    turns.map((t) => t.id),
    turns,
  );
}

function removeChat(db: SqlDatabase, id: string): boolean {
  db.prepare("DELETE FROM chat_turns WHERE chatId = ?").run(id);
  return Number(db.prepare("DELETE FROM chats WHERE id = ?").run(id).changes) > 0;
}

/** The chat with its turns, or only its last `last` of them. */
function readChat(db: SqlDatabase, id: string, last?: number): Chat | null {
  const row = db.prepare("SELECT chat FROM chats WHERE id = ?").get(id);
  if (!row) return null;
  const turns =
    last === undefined
      ? db.prepare("SELECT turn FROM chat_turns WHERE chatId = ? ORDER BY position").all(id)
      : db
          .prepare("SELECT turn FROM chat_turns WHERE chatId = ? ORDER BY position DESC LIMIT ?")
          .all(id, last)
          .toReversed();
  return {
    ...(JSON.parse(String(row.chat)) as ChatRow),
    turns: turns.map((t) => JSON.parse(String(t.turn)) as ChatTurn),
  };
}

export async function listChats(): Promise<{
  chats: Omit<ChatSummary, "deletedAt">[];
  device: Device;
}> {
  const db = await database();
  const chats = db
    .prepare("SELECT chat FROM chats ORDER BY updatedAt DESC")
    .all()
    .map((row) => JSON.parse(String(row.chat)) as ChatRow);
  return { chats, device: device(db) };
}

export async function getChat(id: string): Promise<Chat | null> {
  return readChat(await database(), id);
}

const SEARCH_LIMIT = 50;

/** Chats with a message holding every word of `query`, best first, each with its best message. */
export async function searchChats(query: string): Promise<ChatMessageMatch[]> {
  const tokens = messageTokens(query);
  if (tokens.length === 0) return [];
  const rows = (await database())
    .prepare(
      `SELECT t.chatId, t.id, t.role, t.text FROM chat_turns t JOIN chats c ON c.id = t.chatId
       ORDER BY c.updatedAt DESC, t.position DESC`,
    )
    .all();
  const best = new Map<string, ChatMessageMatch & { quality: number; offset: number }>();
  for (const row of rows) {
    const text = String(row.text);
    const match = matchMessage(text, tokens);
    const id = String(row.chatId);
    if (!match || match.quality <= (best.get(id)?.quality ?? 0)) continue;
    best.set(id, {
      id,
      turnId: String(row.id),
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

/** A Claude or Codex chat is the device's that started it. Past the limit, the oldest chats go (everywhere). */
export async function saveChat({ chat, turnIds, turns, settled }: ChatSave): Promise<void> {
  const db = await database();
  const kind = (await getProviderSettings()).agents.find((a) => a.id === chat.provider)?.kind;
  const local = kind !== undefined && LOCAL_AGENT_KINDS.includes(kind);
  transaction(db, () => {
    putRow(db, { ...chat, device: chat.device ?? (local ? device(db) : null) });
    putTurns(db, chat.id, turnIds, turns);
    const over = db
      .prepare("SELECT id FROM chats ORDER BY updatedAt DESC LIMIT -1 OFFSET ?")
      .all(CHAT_LIMITS.chats);
    for (const { id } of over) {
      removeChat(db, String(id));
      queue(db, String(id));
    }
    queue(db, chat.id, settled ? 300 : STREAMING_PUSH_MS);
  });
  broadcast(CHATS_CHANGED, { ids: [chat.id] });
}

export async function deleteChat(id: string): Promise<void> {
  const db = await database();
  transaction(db, () => {
    removeChat(db, id);
    queue(db, id);
  });
  broadcast(CHATS_CHANGED, { ids: [id] });
}

const RETRY_MS = 30_000;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushAt = 0;
let pushing: Promise<void> | null = null;
let inFlight: string | null = null;

function schedulePush(delay = 300): void {
  if (!getOtterUser()) return;
  if (pushTimer && pushAt <= Date.now() + delay) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushAt = Date.now() + delay;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void push();
  }, delay);
}

function push(): Promise<void> {
  pushing ??= (async () => {
    try {
      const db = await database();
      while (getOtterUser()) {
        const [id, ...rest] = pendingIds(db);
        if (!id) return;
        setState(db, "pending", rest);
        inFlight = id;
        // The relay keeps a chat's latest turns (`chatForSync`): only those are read.
        const chat = readChat(db, id, CHAT_LIMITS.turns);
        const route = `/v1/chats/${encodeURIComponent(id)}`;
        try {
          if (chat) await relayRequest("PUT", route, chatForSync(chat));
          else await relayRequest("DELETE", route);
        } catch (err) {
          if (err instanceof RelayError && err.status === 409) {
            schedulePull();
            continue;
          }
          if (err instanceof RelayError && [400, 404, 413].includes(err.status)) {
            logger.warn("chats", `The relay refused a chat: ${err.message}`);
            continue;
          }
          const pending = pendingIds(db);
          if (!pending.includes(id)) setState(db, "pending", [id, ...pending]);
          schedulePush(RETRY_MS);
          return;
        } finally {
          inFlight = null;
        }
      }
    } finally {
      pushing = null;
    }
  })();
  return pushing;
}

let pullTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePull(): void {
  pullTimer ??= setTimeout(() => {
    pullTimer = null;
    void pullChats().catch((err: unknown) => logger.failure("chats", "Chats sync failed", err));
  }, 300);
}

/**
 * The relay's copy over this device's, keeping what the relay leaves out
 * (`chatForSync`): the older turns before its first, steps' whole outputs,
 * and the thumbnails it dropped from a chat too big for it.
 */
function merged(remote: Chat, local: Chat | undefined): Chat {
  if (!local) return remote;
  const mine = new Map(local.turns.map((t) => [t.id, t]));
  const first = remote.turns[0]?.id;
  const at = first === undefined ? -1 : local.turns.findIndex((t) => t.id === first);
  const turns = remote.turns.map((turn): ChatTurn => {
    const own = mine.get(turn.id);
    if (!own) return turn;
    return {
      ...turn,
      items: turn.items?.map((item, i) => {
        const whole = own.items?.[i];
        return item.kind === "step" &&
          whole?.kind === "step" &&
          item.output !== undefined &&
          whole.output !== undefined &&
          item.output.endsWith("…") &&
          whole.output.startsWith(item.output.slice(0, -1))
          ? { ...item, output: whole.output }
          : item;
      }),
      attachments: turn.attachments?.map((a) => ({
        ...a,
        thumb: a.thumb ?? own.attachments?.find((b) => b.name === a.name)?.thumb,
      })),
    };
  });
  return {
    ...remote,
    // Where this device has read the chat's session up to is its own: the relay doesn't keep it.
    ...(local.cursor && { cursor: local.cursor }),
    turns: [...(at > 0 ? local.turns.slice(0, at) : []), ...turns],
  };
}

export async function pullChats(): Promise<void> {
  if (!getOtterUser()) return;
  const { chats: remote } = await relayRequest<ListChatsResponse>("GET", "/v1/chats");
  const db = await database();
  const waiting = () => new Set([...pendingIds(db), ...(inFlight ? [inFlight] : [])]);
  const updatedAt = (id: string) =>
    Number(db.prepare("SELECT updatedAt FROM chats WHERE id = ?").get(id)?.updatedAt ?? -1);
  const newer = remote.filter(
    (r) => !r.deletedAt && !waiting().has(r.id) && updatedAt(r.id) < r.updatedAt,
  );
  const fetched = new Map<string, Chat>();
  for (const { id } of newer) {
    try {
      const { chat } = await relayRequest<{ chat: Chat }>(
        "GET",
        `/v1/chats/${encodeURIComponent(id)}`,
      );
      fetched.set(id, chat);
    } catch (err) {
      if (!(err instanceof RelayError && err.status === 404)) throw err;
    }
  }
  const changed: string[] = [];
  transaction(db, () => {
    const pending = waiting();
    const known = new Set(remote.map((r) => r.id));
    for (const r of remote) {
      if (pending.has(r.id)) continue;
      if (r.deletedAt) {
        if (removeChat(db, r.id)) changed.push(r.id);
        continue;
      }
      const chat = fetched.get(r.id);
      if (chat && updatedAt(r.id) < chat.updatedAt) {
        writeChat(db, merged(chat, readChat(db, r.id) ?? undefined));
        changed.push(r.id);
      }
    }
    const unknown = db
      .prepare("SELECT id FROM chats")
      .all()
      .map((row) => String(row.id))
      .filter((id) => !known.has(id) && !pending.has(id));
    if (unknown.length > 0) setState(db, "pending", [...pendingIds(db), ...unknown]);
  });
  if (changed.length > 0) broadcast(CHATS_CHANGED, { ids: changed });
  if (pendingIds(db).length > 0) schedulePush(0);
}
