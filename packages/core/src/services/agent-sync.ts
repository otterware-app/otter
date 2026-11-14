/**
 * This device's copy of the account's agents and chats (contracts' agent-sync.ts), in SQLite: the
 * app reads it and never waits on the relay. A change is applied here at once and kept in the
 * outbox until the relay has it; each exchange sends the outbox and takes what changed since,
 * writes that over the copy and applies again what the relay hasn't had yet. Agents' secrets are
 * kept in the platform's secrets (the copy only marks that one exists). Without an Otter account
 * there are no agents: the copy waits, unseen, for its account to sign in again.
 */

import {
  AGENT_SYNC_BATCH,
  applyMutation,
  fitTurn,
  prefixEnd,
  type AgentMutation,
  type AgentStore,
  type AgentSyncRequest,
  type AgentSyncResponse,
  type TurnRecord,
} from "@otter/contracts/agent-sync";
import type { ChatTurn } from "@otter/contracts/chats";

import { broadcast } from "../ipc.js";
import { logger } from "../logger.js";
import { platform, type SqlDatabase } from "../platform.js";
import { getOtterUser, onOtterAccountChange, relayRequest, RelayError } from "./otter-account.js";

export const CHATS_CHANGED = "chats:changed";

/** What a change touched: each entry as it was before (to tell what really changed), and secrets to write. */
type Touched = {
  before: Map<string, string | null | undefined>;
  secrets: Map<string, string | null>;
};

const touching = (): Touched => ({ before: new Map(), secrets: new Map() });

let opened: SqlDatabase | null = null;

export function agentDb(): SqlDatabase {
  if (opened) return opened;
  const db = platform().database();
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_entries (
      key TEXT PRIMARY KEY,
      value TEXT,
      chat TEXT,
      position INTEGER,
      role TEXT,
      text TEXT,
      updated INTEGER
    );
    CREATE INDEX IF NOT EXISTS agent_entries_turns ON agent_entries (chat, position);
    CREATE INDEX IF NOT EXISTS agent_entries_updated ON agent_entries (updated);
    CREATE TABLE IF NOT EXISTS agent_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, mutation TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  opened = db;
  return db;
}

export function transaction<T>(db: SqlDatabase, work: () => T): T {
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

function state<T>(key: string): T | null {
  const row = agentDb().prepare("SELECT value FROM agent_sync_state WHERE key = ?").get(key);
  return row ? (JSON.parse(String(row.value)) as T) : null;
}

function setState(key: string, value: unknown): void {
  agentDb()
    .prepare(
      "INSERT INTO agent_sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, JSON.stringify(value));
}

function ownId(key: string): string {
  let id = state<string>(key);
  if (!id) {
    id = crypto.randomUUID();
    setState(key, id);
  }
  return id;
}

/** This device, for the settings that are its own and the chats that run on it. */
export const deviceId = () => ownId("device");

/** The id this device had before (its chats name it), kept. */
export function keepDeviceId(id: string): void {
  setState("device", id);
}

/** What a message says: a reply's text is in its items, between its steps. */
const messageText = (turn: ChatTurn) =>
  [turn.text, ...(turn.items ?? []).map((item) => (item.kind === "text" ? item.text : ""))]
    .filter(Boolean)
    .join("\n\n");

const segments = (key: string) => key.split("/");

function store(db: SqlDatabase, touched: Touched): AgentStore {
  const keysIn = (prefix: string) =>
    db
      .prepare("SELECT key FROM agent_entries WHERE key >= ? AND key < ?")
      .all(prefix, prefixEnd(prefix))
      .map((row) => String(row.key));
  const put = db.prepare(
    `INSERT INTO agent_entries (key, value, chat, position, role, text, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, chat = excluded.chat,
       position = excluded.position, role = excluded.role, text = excluded.text,
       updated = excluded.updated`,
  );
  const read = db.prepare("SELECT value FROM agent_entries WHERE key = ?");
  const raw = (key: string) => {
    const row = read.get(key);
    return row ? (row.value === null ? null : String(row.value)) : undefined;
  };
  const touch = (key: string) => {
    if (!touched.before.has(key)) touched.before.set(key, raw(key));
  };
  return {
    get(key) {
      const value = raw(key);
      return value == null ? value : JSON.parse(value);
    },
    set(key, value) {
      const [kind, id] = segments(key);
      if (kind === "secret") {
        touched.secrets.set(key, typeof value === "string" ? value : null);
        // The secret itself goes to the platform's secrets: the copy only knows there is one.
        value = value === null ? null : true;
      }
      const json = value === null ? null : JSON.stringify(value);
      if (raw(key) === json) return;
      touch(key);
      const turn = kind === "turn" ? (value as TurnRecord | null) : null;
      put.run(
        key,
        json,
        kind === "turn" ? id! : null,
        turn?.position ?? null,
        turn?.turn.role ?? null,
        turn ? messageText(turn.turn) : null,
        kind === "chat" ? ((value as { updatedAt?: number } | null)?.updatedAt ?? null) : null,
      );
    },
    turnKeys: (chat) =>
      db
        .prepare("SELECT key FROM agent_entries WHERE chat = ?")
        .all(chat)
        .map((row) => String(row.key)),
    removeTurns(chat) {
      for (const row of db.prepare("SELECT key FROM agent_entries WHERE chat = ?").all(chat))
        touch(String(row.key));
      db.prepare("DELETE FROM agent_entries WHERE chat = ?").run(chat);
    },
    deviceKeys: (agent) => keysIn(`agent-device/${agent}/`),
    secretKeys: (agent) => keysIn(`secret/${agent}/`),
  };
}

const secretName = (key: string) => {
  const [, agent, name] = segments(key);
  return `agent:${agent}:${name}`;
};

type Listener = (change: { agents: Set<string>; selected: boolean }) => void;
const agentListeners = new Set<Listener>();

/** Agents changed here by another device (or the copy started over): their providers follow. */
export function onAgentsChanged(listener: Listener): void {
  agentListeners.add(listener);
}

const syncedListeners = new Set<() => void>();

/** The copy caught up with the relay, its outbox sent. */
export function onSynced(listener: () => void): void {
  syncedListeners.add(listener);
}

/** Tells what really changed (an entry written and written back is the same): the windows, the agents. */
async function settle(db: SqlDatabase, touched: Touched, remote: boolean): Promise<void> {
  const chats = new Set<string>();
  const agents = new Set<string>();
  let selected = false;
  const read = db.prepare("SELECT value FROM agent_entries WHERE key = ?");
  for (const [key, before] of touched.before) {
    const row = read.get(key);
    const after = row ? (row.value === null ? null : String(row.value)) : undefined;
    if ((after ?? null) === (before ?? null)) continue;
    const [kind, id] = segments(key);
    if (kind === "chat" || kind === "turn") chats.add(id!);
    else if (kind === "selected") selected = true;
    else agents.add(id!);
  }
  for (const [key, value] of touched.secrets) {
    const name = secretName(key);
    try {
      const current = await platform()
        .secrets.get(name)
        .catch(() => null);
      if (current === value) continue;
      if (value === null) await platform().secrets.delete(name);
      else await platform().secrets.set(name, value);
      agents.add(segments(key)[1]!);
    } catch (err) {
      logger.failure("agent-sync", "Couldn't keep an agent's secret", err);
    }
  }
  if (chats.size > 0) broadcast(CHATS_CHANGED, { ids: [...chats] });
  if (remote && (agents.size > 0 || selected))
    for (const listener of agentListeners) listener({ agents, selected });
}

/** The unsent mutation this one can join, so a streaming turn sends its latest, not each step. */
function joinable(
  db: SqlDatabase,
  mutation: AgentMutation,
): { id: number; mutation: AgentMutation } | null {
  const plain = (m: AgentMutation) =>
    (m.op === "turns" && !m.imported) || (m.op === "chat.set" && !m.ifNewer);
  if (!plain(mutation)) return null;
  const chat =
    mutation.op === "turns" ? mutation.chat : mutation.op === "chat.set" && mutation.chat.id;
  // Only what was never sent: one the relay may have applied can't change under its id.
  const rows = db
    .prepare("SELECT id, mutation FROM agent_outbox WHERE id > ? ORDER BY id DESC")
    .all(state<number>("sent") ?? 0);
  for (const row of rows) {
    const queued = JSON.parse(String(row.mutation)) as AgentMutation;
    if (queued.op === "chat.delete" && queued.id === chat) return null;
    if (queued.op === mutation.op && plain(queued)) {
      if (queued.op === "turns" && queued.chat === chat)
        return { id: Number(row.id), mutation: queued };
      if (queued.op === "chat.set" && queued.chat.id === chat)
        return { id: Number(row.id), mutation: queued };
    }
  }
  return null;
}

function joined(queued: AgentMutation, mutation: AgentMutation): AgentMutation {
  if (queued.op === "chat.set" && mutation.op === "chat.set")
    return { op: "chat.set", chat: { ...queued.chat, ...mutation.chat } };
  if (queued.op === "turns" && mutation.op === "turns") {
    const put = new Map(queued.put.map((turn) => [turn.id, turn]));
    for (const turn of mutation.put) put.set(turn.id, turn);
    const order = new Set(mutation.order);
    const removed = [...new Set([...(queued.removed ?? []), ...(mutation.removed ?? [])])].filter(
      (id) => !order.has(id),
    );
    return {
      op: "turns",
      chat: mutation.chat,
      put: [...put.values()].filter((turn) => order.has(turn.id)),
      order: mutation.order,
      ...(removed.length > 0 && { removed }),
    };
  }
  return mutation;
}

const PART_BYTES = 1_000_000;

/** A chat's turns written at once go in parts the relay takes. */
function parts(mutation: AgentMutation): AgentMutation[] {
  if (mutation.op !== "turns") return [mutation];
  const put = mutation.put.map(fitTurn);
  const out: AgentMutation[] = [];
  let part: ChatTurn[] = [];
  let size = 0;
  for (const turn of put) {
    const bytes = JSON.stringify(turn).length;
    if (part.length > 0 && size + bytes > PART_BYTES) {
      out.push({ ...mutation, put: part });
      part = [];
      size = 0;
    }
    part.push(turn);
    size += bytes;
  }
  out.push({ ...mutation, put: part });
  return out;
}

/** Applies the mutations here and sends them to the relay soon: in `delay`, or with what goes first. */
export async function mutate(given: AgentMutation[], delay = 300): Promise<void> {
  const mutations = given.flatMap(parts);
  if (mutations.length === 0) return;
  const db = agentDb();
  const touched = touching();
  transaction(db, () => {
    const local = store(db, touched);
    for (const mutation of mutations) {
      applyMutation(local, mutation);
      const queued = joinable(db, mutation);
      const both = queued && JSON.stringify(joined(queued.mutation, mutation));
      // Parts stay parts: joined, a long chat's upload would be more than the relay takes.
      if (queued && both && both.length <= PART_BYTES)
        db.prepare("UPDATE agent_outbox SET mutation = ? WHERE id = ?").run(both, queued.id);
      else
        db.prepare("INSERT INTO agent_outbox (mutation) VALUES (?)").run(JSON.stringify(mutation));
    }
  });
  await settle(db, touched, false);
  requestSync(delay);
}

/** Reads one entry of the copy (never a secret's value). */
export function entry<T>(key: string): T | null | undefined {
  const row = agentDb().prepare("SELECT value FROM agent_entries WHERE key = ?").get(key);
  if (!row) return undefined;
  return row.value === null ? null : (JSON.parse(String(row.value)) as T);
}

/** The entries under `prefix` that are there (not gone). */
export function entries<T>(prefix: string): { key: string; value: T }[] {
  return agentDb()
    .prepare(
      "SELECT key, value FROM agent_entries WHERE key >= ? AND key < ? AND value IS NOT NULL",
    )
    .all(prefix, prefixEnd(prefix))
    .map((row) => ({ key: String(row.key), value: JSON.parse(String(row.value)) as T }));
}

// The windows show the account's chats, or none without it.
onOtterAccountChange(() => broadcast(CHATS_CHANGED, { ids: [] }));

/** Whose account the copy is: another's signing in starts it over. */
async function adoptAccount(): Promise<boolean> {
  const user = getOtterUser();
  if (!user) return false;
  const owner = state<string>("user");
  if (owner === user.id) return true;
  if (owner) await startOver();
  setState("user", user.id);
  return true;
}

/** The copy, its outbox and its secrets go: the next exchange reads the account's whole. */
async function startOver(): Promise<void> {
  const db = agentDb();
  const touched = touching();
  transaction(db, () => {
    for (const row of db.prepare("SELECT key, value FROM agent_entries").all()) {
      const key = String(row.key);
      touched.before.set(key, row.value === null ? null : String(row.value));
      if (key.startsWith("secret/")) touched.secrets.set(key, null);
    }
    db.exec("DELETE FROM agent_entries; DELETE FROM agent_outbox;");
    db.prepare(
      "DELETE FROM agent_sync_state WHERE key IN ('version', 'client', 'user', 'sent')",
    ).run();
  });
  await settle(db, touched, true);
}

/** Signing out of this device: the account's agents, chats and secrets leave it with the account. */
export async function forgetAgentData(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  await startOver();
}

const RETRY_MS = [2_000, 5_000, 15_000, 60_000];
let timer: ReturnType<typeof setTimeout> | null = null;
let timerAt = 0;
let running: Promise<void> | null = null;
let again = false;
let failures = 0;
/** The relay refused a batch: they go one by one until the one it can't take is found, and dropped. */
let oneByOne = false;

/** An exchange with the relay, in `delay` or sooner if one was already due sooner. */
export function requestSync(delay = 0): void {
  if (!getOtterUser()) return;
  if (timer && timerAt <= Date.now() + delay) return;
  if (timer) clearTimeout(timer);
  timerAt = Date.now() + delay;
  timer = setTimeout(() => {
    timer = null;
    void syncAgentData();
  }, delay);
}

/** Exchanges with the relay until the outbox is empty and every change is here. */
export function syncAgentData(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await exchange();
      } while (again);
      failures = 0;
      for (const listener of syncedListeners) listener();
    } catch (err) {
      const delay = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]!;
      failures += 1;
      if (!(err instanceof RelayError && err.status === 401))
        logger.failure("agent-sync", "Couldn't sync agents and chats, retrying", err);
      requestSync(delay);
    } finally {
      running = null;
    }
  })();
  return running;
}

function outbox(db: SqlDatabase): { id: number; mutation: AgentMutation }[] {
  const rows = db
    .prepare("SELECT id, mutation FROM agent_outbox ORDER BY id LIMIT ?")
    .all(oneByOne ? 1 : AGENT_SYNC_BATCH.mutations);
  const batch: { id: number; mutation: AgentMutation }[] = [];
  let size = 0;
  for (const row of rows) {
    const text = String(row.mutation);
    if (batch.length > 0 && size + text.length > AGENT_SYNC_BATCH.bytes) break;
    size += text.length;
    batch.push({ id: Number(row.id), mutation: JSON.parse(text) as AgentMutation });
  }
  return batch;
}

async function exchange(): Promise<void> {
  if (!(await adoptAccount())) return;
  const user = getOtterUser()!.id;
  const db = agentDb();
  for (;;) {
    const mutations = outbox(db);
    const sending = mutations.at(-1)?.id ?? 0;
    if (sending > (state<number>("sent") ?? 0)) setState("sent", sending);
    let response: AgentSyncResponse;
    try {
      response = await relayRequest<AgentSyncResponse>("POST", "/v1/agent-sync", {
        client: ownId("client"),
        since: state<number>("version") ?? 0,
        mutations,
      } satisfies AgentSyncRequest);
    } catch (err) {
      if (!(err instanceof RelayError && [400, 413].includes(err.status)) || !mutations.length)
        throw err;
      if (mutations.length > 1) oneByOne = true;
      else {
        logger.failure("agent-sync", "The relay refused a change; it's dropped", err);
        // What it did here goes too: the copy is read again whole, under what's still to send.
        transaction(db, () => {
          db.prepare("DELETE FROM agent_outbox WHERE id = ?").run(mutations[0]!.id);
          db.exec("DELETE FROM agent_entries");
          setState("version", 0);
        });
      }
      continue;
    }
    if (mutations.length === 1) oneByOne = false;
    if (getOtterUser()?.id !== user || state<string>("user") !== user) return;
    const touched = touching();
    transaction(db, () => {
      db.prepare("DELETE FROM agent_outbox WHERE id <= ?").run(response.lastMutationId);
      const local = store(db, touched);
      for (const change of response.changes) {
        local.set(change.key, change.value);
        if (change.value === null && change.key.startsWith("chat/"))
          local.removeTurns(segments(change.key)[1]!);
      }
      for (const row of db.prepare("SELECT mutation FROM agent_outbox ORDER BY id").all())
        applyMutation(local, JSON.parse(String(row.mutation)) as AgentMutation);
      setState("version", response.version);
    });
    await settle(db, touched, true);
    const waiting = Number(db.prepare("SELECT count(*) AS n FROM agent_outbox").get()?.n ?? 0);
    if (!response.more && waiting === 0) return;
  }
}
