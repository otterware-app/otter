/**
 * The account's agents and chats (contracts' agent-sync.ts), in its UserHub's SQLite: an entry per
 * key, numbered by the write that last changed it, so a device takes what changed since its last
 * number. Agents' secrets are sealed with a key only the relay holds: storage alone can't reveal
 * them, and the relay opens them for the account's own devices.
 */

import {
  AGENT_SYNC_PAGE,
  applyMutation,
  prefixEnd,
  type AgentChange,
  type AgentMutation,
  type AgentStore,
  type AgentSyncRequest,
  type AgentSyncResponse,
} from "@otter/contracts/agent-sync";
import type { Chat } from "@otter/contracts/chats";
import { EncryptJWT, jwtDecrypt } from "jose";

import { derivedKey } from "./keys.ts";

const PAGE_BYTES = 2_000_000;

const sealKey = (secret: string) => derivedKey(secret, "otter agent secrets");

async function seal(secret: string, userId: string, value: string): Promise<string> {
  return new EncryptJWT({ value })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setSubject(userId)
    .encrypt(await sealKey(secret));
}

async function open(secret: string, userId: string, sealed: string): Promise<string | null> {
  try {
    const { payload } = await jwtDecrypt<{ value: string }>(sealed, await sealKey(secret), {
      subject: userId,
    });
    return payload.value;
  } catch {
    return null;
  }
}

const isSecret = (key: string) => key.startsWith("secret/");

export class AgentData {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly secret: string,
  ) {
    storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS agent_data (key TEXT PRIMARY KEY, version INTEGER NOT NULL, value TEXT);
      CREATE INDEX IF NOT EXISTS agent_data_version ON agent_data (version);
      CREATE TABLE IF NOT EXISTS agent_clients (id TEXT PRIMARY KEY, last INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_state (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
    `);
  }

  private get sql() {
    return this.storage.sql;
  }

  head(): number {
    return Number(
      this.sql.exec("SELECT value FROM agent_state WHERE key = 'head'").toArray()[0]?.value ?? 0,
    );
  }

  imported(): boolean {
    return this.sql.exec("SELECT 1 FROM agent_state WHERE key = 'imported'").toArray().length > 0;
  }

  private store(): AgentStore {
    let version = this.head();
    const sql = this.sql;
    const range = (prefix: string) =>
      sql
        .exec("SELECT key FROM agent_data WHERE key >= ? AND key < ?", prefix, prefixEnd(prefix))
        .toArray()
        .map((row) => String(row.key));
    return {
      get(key) {
        const row = sql.exec("SELECT value FROM agent_data WHERE key = ?", key).toArray()[0];
        if (!row) return undefined;
        return row.value === null ? null : JSON.parse(String(row.value));
      },
      set(key, value) {
        version += 1;
        sql.exec(
          `INSERT INTO agent_data (key, version, value) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET version = excluded.version, value = excluded.value`,
          key,
          version,
          value === null ? null : JSON.stringify(value),
        );
        sql.exec(
          "INSERT INTO agent_state (key, value) VALUES ('head', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          version,
        );
      },
      turnKeys: (chat) => range(`turn/${chat}/`),
      removeTurns(chat) {
        const prefix = `turn/${chat}/`;
        sql.exec("DELETE FROM agent_data WHERE key >= ? AND key < ?", prefix, prefixEnd(prefix));
      },
      deviceKeys: (agent) => range(`agent-device/${agent}/`),
      secretKeys: (agent) => range(`secret/${agent}/`),
    };
  }

  /** The secrets sealed before anything is written: the writes themselves don't wait. */
  private async sealed(userId: string, mutation: AgentMutation): Promise<AgentMutation> {
    if (mutation.op !== "secret.set" || mutation.value === null) return mutation;
    return { ...mutation, value: await seal(this.secret, userId, mutation.value) };
  }

  async sync(userId: string, request: AgentSyncRequest): Promise<AgentSyncResponse> {
    const last = () =>
      Number(
        this.sql.exec("SELECT last FROM agent_clients WHERE id = ?", request.client).toArray()[0]
          ?.last ?? 0,
      );
    const fresh = request.mutations.filter((m) => m.id > last());
    const sealed = await Promise.all(fresh.map((m) => this.sealed(userId, m.mutation)));
    // Sealing waited: another request may have applied some of these since.
    const already = last();
    const store = this.store();
    this.storage.transactionSync(() => {
      fresh.forEach((m, i) => {
        if (m.id > already) applyMutation(store, sealed[i]);
      });
      const newest = Math.max(already, ...request.mutations.map((m) => m.id));
      if (newest > already)
        this.sql.exec(
          `INSERT INTO agent_clients (id, last) VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET last = excluded.last`,
          request.client,
          newest,
        );
    });
    const lastMutationId = last();
    const rows = this.sql
      .exec(
        "SELECT key, version, value FROM agent_data WHERE version > ? ORDER BY version LIMIT ?",
        request.since,
        AGENT_SYNC_PAGE + 1,
      )
      .toArray();
    // Read with the rows: opening secrets waits, and a write meanwhile isn't in them.
    const head = this.head();
    const changes: AgentChange[] = [];
    let size = 0;
    let version = request.since;
    for (const row of rows.slice(0, AGENT_SYNC_PAGE)) {
      if (changes.length && size > PAGE_BYTES) break;
      const key = String(row.key);
      const raw = row.value === null ? null : String(row.value);
      size += key.length + (raw?.length ?? 4);
      let value: unknown = raw === null ? null : JSON.parse(raw);
      if (isSecret(key) && typeof value === "string")
        value = await open(this.secret, userId, value);
      changes.push({ key, value });
      version = Number(row.version);
    }
    const more = changes.length < rows.length;
    return {
      version: more ? version : Math.max(version, head),
      lastMutationId,
      changes,
      more,
    };
  }

  /** What the relay kept before it kept everything: its chats and the account's agents, once. */
  async import(
    userId: string,
    old: {
      chats: (Chat & { deletedAt: number | null })[];
      assistant: unknown;
      agentKeys: Record<string, string>;
    },
  ): Promise<void> {
    if (this.imported()) return;
    const mutations: AgentMutation[] = [];
    const tombstones: string[] = [];
    const assistant = old.assistant as {
      selected?: unknown;
      agents?: {
        id?: unknown;
        kind?: unknown;
        name?: unknown;
        avatar?: unknown;
        settings?: unknown;
      }[];
      removed?: unknown;
    } | null;
    if (Array.isArray(assistant?.removed))
      for (const id of assistant.removed)
        if (typeof id === "string") tombstones.push(`agent/${id}`);
    (Array.isArray(assistant?.agents) ? assistant.agents : []).forEach((agent, addedAt) => {
      if (typeof agent?.id !== "string" || typeof agent.kind !== "string") return;
      if (typeof agent.name !== "string" || !agent.name) return;
      mutations.push({
        op: "agent.set",
        id: agent.id,
        kind: agent.kind,
        name: agent.name,
        ...(typeof agent.avatar === "string" && { avatar: agent.avatar }),
        settings:
          typeof agent.settings === "object" && agent.settings !== null
            ? (agent.settings as Record<string, unknown>)
            : {},
        addedAt,
      });
    });
    for (const [agent, key] of Object.entries(old.agentKeys))
      mutations.push({ op: "secret.set", agent, name: "key", value: key });
    if (typeof assistant?.selected === "string")
      mutations.push({ op: "select", id: assistant.selected });
    for (const { turns, deletedAt, ...chat } of old.chats) {
      if (deletedAt) {
        tombstones.push(`chat/${chat.id}`);
        continue;
      }
      mutations.push({ op: "chat.set", chat });
      mutations.push({ op: "turns", chat: chat.id, put: turns, order: turns.map((t) => t.id) });
    }
    const sealed = await Promise.all(mutations.map((m) => this.sealed(userId, m)));
    if (this.imported()) return;
    const store = this.store();
    this.storage.transactionSync(() => {
      for (const key of tombstones) if (store.get(key) === undefined) store.set(key, null);
      for (const mutation of sealed) applyMutation(store, mutation);
      this.sql.exec("INSERT INTO agent_state (key, value) VALUES ('imported', 1)");
    });
  }
}
