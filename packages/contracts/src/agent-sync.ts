/**
 * The account's agents and chats: the relay keeps them (a store per Otter account, every write in
 * one order, each numbered by `version`) and every device keeps a copy it reads from, so the app
 * never waits on the network. A device changes its copy at once with a mutation and sends the
 * mutation to the relay, which applies it the same way (`applyMutation`, here, for both). Taking
 * the entries written since its `version`, a device writes them over its copy and applies again
 * the mutations the relay hasn't had yet: its copy is always the relay's plus what it hasn't sent.
 *
 * Entries, by key (a value of null is gone, and stays gone):
 *   agent/<id>                    AgentRecord: what every device shares
 *   agent-device/<id>/<device>    one device's own settings for it (a CLI's path)
 *   secret/<id>/<name>            its key or token, sealed by the relay
 *   selected                      the agent new chats start with
 *   chat/<id>                     ChatRecord: a chat without its turns
 *   turn/<chat>/<id>              TurnRecord: one of its turns, where it sits
 */

import type { Chat, ChatTurn } from "./chats.js";

export interface AgentRecord {
  id: string;
  kind: string;
  name: string;
  avatar?: string;
  settings: Record<string, unknown>;
  /** Where it sits among the agents: they're listed in the order they were added. */
  addedAt: number;
}

export type ChatRecord = Omit<Chat, "turns">;

export interface TurnRecord {
  position: number;
  turn: ChatTurn;
}

export type AgentMutation =
  /** Makes the agent, or changes it: its settings are merged, key by key. */
  | {
      op: "agent.set";
      id: string;
      kind: string;
      name?: string;
      avatar?: string | null;
      settings?: Record<string, unknown>;
      addedAt?: number;
    }
  | { op: "agent.device"; id: string; device: string; settings: Record<string, unknown> }
  | { op: "agent.remove"; id: string }
  | { op: "secret.set"; agent: string; name: string; value: string | null }
  | { op: "select"; id: string | null }
  /** Makes the chat or changes the fields given. `ifNewer`: only over an older one (a device's first upload). */
  | { op: "chat.set"; chat: Partial<ChatRecord> & { id: string }; ifNewer?: true }
  | { op: "chat.delete"; id: string }
  /**
   * Writes `put`, numbers the chat's turns in `order`'s order, and removes `removed`. Turns the
   * relay has that the device hasn't heard of (another device's) keep their place after.
   */
  | {
      op: "turns";
      chat: string;
      put: ChatTurn[];
      order: string[];
      removed?: string[];
      /**
       * A device's first upload of what it kept before: a turn the account already has keeps
       * its content, taking back only what the old relay copy cut (outputs, pictures), and a
       * removed one stays removed.
       */
      imported?: true;
    };

export interface AgentChange {
  key: string;
  value: unknown;
}

// POST /v1/agent-sync  ← AgentSyncRequest → AgentSyncResponse
//
// Applies `mutations` in order (each once: a device numbers them, and the relay remembers the
// last it applied for that device, `lastMutationId`), then answers the entries written after
// `since`, up to a page (`more`: ask again from `version`). The account's other devices hear
// `{ type: "agent-sync" }` (relay.ts).

export interface AgentSyncRequest {
  /** This device's: the relay counts its mutations by it. */
  client: string;
  since: number;
  mutations: { id: number; mutation: AgentMutation }[];
}

export interface AgentSyncResponse {
  version: number;
  lastMutationId: number;
  changes: AgentChange[];
  more: boolean;
}

/** One request's mutations, at most, so a long upload goes in parts. */
export const AGENT_SYNC_BATCH = { mutations: 200, bytes: 4_000_000 } as const;
/** Entries in one answer. */
export const AGENT_SYNC_PAGE = 500;
/** A turn, at most, as kept: the relay keeps rows up to 2 MB. */
const TURN_BYTES = 1_000_000;

export const agentKey = (id: string) => `agent/${id}`;
export const agentDeviceKey = (id: string, device: string) => `agent-device/${id}/${device}`;
export const secretKey = (agent: string, name: string) => `secret/${agent}/${name}`;
export const SELECTED_KEY = "selected";
export const chatKey = (id: string) => `chat/${id}`;
export const turnKey = (chat: string, id: string) => `turn/${chat}/${id}`;
/** Every key under `prefix` sorts between it and this. */
export const prefixEnd = (prefix: string) =>
  `${prefix.slice(0, -1)}${String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)}`;

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** A turn too big to keep gives up its steps' outputs, then its pictures: the same on every device. */
export function fitTurn(turn: ChatTurn): ChatTurn {
  if (bytes(turn) <= TURN_BYTES) return turn;
  let fitted: ChatTurn = {
    ...turn,
    items: turn.items?.map((item) =>
      item.kind === "step" && item.output !== undefined
        ? {
            ...item,
            output: item.output.length > 2000 ? `${item.output.slice(0, 2000)}…` : item.output,
          }
        : item,
    ),
  };
  if (bytes(fitted) > TURN_BYTES)
    fitted = { ...fitted, attachments: fitted.attachments?.map(({ thumb: _thumb, ...a }) => a) };
  if (bytes(fitted) > TURN_BYTES)
    fitted = { ...fitted, text: `${fitted.text.slice(0, TURN_BYTES / 4)}…` };
  return fitted;
}

/** `kept` with what the old relay copy cut from it (a step's output, a picture) back from `whole`. */
function restored(kept: ChatTurn, whole: ChatTurn): ChatTurn {
  return {
    ...kept,
    ...(kept.items && {
      items: kept.items.map((item, i) => {
        const full = whole.items?.[i];
        return item.kind === "step" &&
          full?.kind === "step" &&
          item.output?.endsWith("…") &&
          full.output?.startsWith(item.output.slice(0, -1))
          ? { ...item, output: full.output }
          : item;
      }),
    }),
    ...(kept.attachments && {
      attachments: kept.attachments.map((a) => {
        const thumb = a.thumb ?? whole.attachments?.find((b) => b.name === a.name)?.thumb;
        return thumb ? { ...a, thumb } : a;
      }),
    }),
  };
}

/**
 * What the store holds, for `applyMutation`: `undefined` never written, `null` gone.
 * `removeTurns` drops every turn of a chat, with no trace: the chat's own entry says it's gone.
 */
export interface AgentStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  turnKeys(chat: string): string[];
  removeTurns(chat: string): void;
  deviceKeys(agent: string): string[];
  secretKeys(agent: string): string[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The one place a mutation becomes entries: the relay and each device run it alike. */
export function applyMutation(store: AgentStore, mutation: AgentMutation): void {
  switch (mutation.op) {
    case "agent.set": {
      const key = agentKey(mutation.id);
      const current = store.get(key);
      if (current === null) return;
      const before = isObject(current) ? (current as unknown as AgentRecord) : null;
      if (!before && !mutation.name) return;
      const next: AgentRecord = {
        id: mutation.id,
        kind: before?.kind ?? mutation.kind,
        name: mutation.name ?? before?.name ?? "",
        settings: { ...before?.settings, ...mutation.settings },
        addedAt: before?.addedAt ?? mutation.addedAt ?? 0,
      };
      const avatar = mutation.avatar === undefined ? before?.avatar : mutation.avatar;
      if (avatar) next.avatar = avatar;
      store.set(key, next);
      return;
    }
    case "agent.device": {
      if (!isObject(store.get(agentKey(mutation.id)))) return;
      const key = agentDeviceKey(mutation.id, mutation.device);
      const before = store.get(key);
      store.set(key, { ...(isObject(before) ? before : {}), ...mutation.settings });
      return;
    }
    case "agent.remove": {
      store.set(agentKey(mutation.id), null);
      for (const key of store.deviceKeys(mutation.id)) store.set(key, null);
      for (const key of store.secretKeys(mutation.id)) store.set(key, null);
      if (store.get(SELECTED_KEY) === mutation.id) store.set(SELECTED_KEY, null);
      return;
    }
    case "secret.set": {
      if (!isObject(store.get(agentKey(mutation.agent)))) return;
      const key = secretKey(mutation.agent, mutation.name);
      if (mutation.value === null && store.get(key) == null) return;
      store.set(key, mutation.value);
      return;
    }
    case "select": {
      if (mutation.id !== null && !isObject(store.get(agentKey(mutation.id)))) return;
      store.set(SELECTED_KEY, mutation.id);
      return;
    }
    case "chat.set": {
      const key = chatKey(mutation.chat.id);
      const current = store.get(key);
      if (current === null) return;
      const before = isObject(current) ? (current as unknown as ChatRecord) : null;
      if (mutation.ifNewer && before && before.updatedAt >= (mutation.chat.updatedAt ?? 0)) return;
      if (!before && (!mutation.chat.provider || mutation.chat.createdAt === undefined)) return;
      store.set(key, { ...before, ...mutation.chat });
      return;
    }
    case "chat.delete": {
      if (store.get(chatKey(mutation.id)) === null) return;
      store.set(chatKey(mutation.id), null);
      store.removeTurns(mutation.id);
      return;
    }
    case "turns": {
      if (!isObject(store.get(chatKey(mutation.chat)))) return;
      const removed = new Set(mutation.removed);
      for (const id of removed) {
        if (store.get(turnKey(mutation.chat, id)) !== undefined)
          store.set(turnKey(mutation.chat, id), null);
      }
      const stored = new Map(
        store
          .turnKeys(mutation.chat)
          .map((key) => store.get(key) as TurnRecord | null | undefined)
          .filter((record): record is TurnRecord => !!record)
          .map((record) => [record.turn.id, record]),
      );
      const order = mutation.order.filter((id) => !removed.has(id));
      const known = new Set(order);
      // A turn written elsewhere that this order doesn't know of stays after the one it followed.
      const following = new Map<string | null, string[]>();
      let after: string | null = null;
      for (const { turn } of [...stored.values()].sort((a, b) => a.position - b.position)) {
        if (known.has(turn.id)) after = turn.id;
        else following.set(after, [...(following.get(after) ?? []), turn.id]);
      }
      const all = [
        ...(following.get(null) ?? []),
        ...order.flatMap((id) => [id, ...(following.get(id) ?? [])]),
      ];
      const put = new Map(mutation.put.map((turn) => [turn.id, turn]));
      all.forEach((id, position) => {
        const key = turnKey(mutation.chat, id);
        const turn = put.get(id);
        const before = stored.get(id);
        if (turn && mutation.imported && store.get(key) === null) return;
        if (turn)
          store.set(key, {
            position,
            turn: fitTurn(mutation.imported && before ? restored(before.turn, turn) : turn),
          } satisfies TurnRecord);
        else if (before && before.position !== position) store.set(key, { ...before, position });
      });
      return;
    }
  }
}
