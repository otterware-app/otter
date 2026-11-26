/**
 * One Durable Object per Otter account: holds the WebSocket of every device
 * signed in to it and fans relay events out to them. Uses hibernation, so
 * idle connections cost nothing, and answers `ping` with `pong` without
 * waking up.
 */

import { DurableObject } from "cloudflare:workers";
import type { AgentSyncRequest, AgentSyncResponse } from "@otter/contracts/agent-sync";
import type { Chat } from "@otter/contracts/chats";
import {
  AGENT_COALESCE_MS,
  AGENT_ESCALATE_MS,
  type AgentPointer,
  ORIGIN_TTL_MS,
  type PresenceDevice,
  type RelayEvent,
  WATCHING_FOR_MS,
} from "@otter/contracts/relay";
import { AgentData } from "./agent-sync.ts";
import { retryingReset } from "./durable-objects.ts";
import { openOldAgentKeys } from "./preferences.ts";
import * as apns from "./apns.ts";
import * as push from "./push.ts";
import { connection, NotificationFailure } from "./notification-connections.ts";
import { stillEligible } from "./notification-providers.ts";
import type { Env } from "./worker.ts";

type PendingPush = {
  userId: string;
  email: string;
  historyId: string;
  attempts: number;
  due: number;
  verified?: {
    provider: "gmail" | "outlook" | "imap";
    messageId: string;
    inbox: boolean;
    generation: string;
    folder?: string;
    uidValidity?: number;
  };
  inboxMessage?: PendingPush["verified"];
};

type PendingAgentPush = {
  userId: string;
  pointer: AgentPointer;
  due: number;
};

/** The last alert the iPhones got for a chat, until it's opened or answered elsewhere. */
type PushedAgent = {
  userId: string;
  ask: string;
};

type SessionOrigin = {
  device: PresenceDevice;
  at: number;
};

export const SESSION_HEADER = "x-otter-session";

/** Kept with a device's socket: the agent session it has on screen, whether the computer is active, and when it said so. */
type Attachment = {
  session?: string;
  active?: boolean;
  device?: PresenceDevice;
  at?: number;
};

const isPresenceDevice = (value: unknown): value is PresenceDevice =>
  value === "desktop" || value === "web" || value === "ios";

/** Sends an agent pointer to every eligible Otter Agents iPhone, respecting the account's mode. */
export async function deliverAgentPush(
  env: Env,
  userId: string,
  pointer: AgentPointer,
): Promise<void> {
  if (!apns.configured(env)) return;
  const devices = await push.agentDevices(env, userId);
  await Promise.all(
    devices.map(async (device) => {
      if (pointer.kind === "finished" && device.agent_notification_mode === "needs-you") return;
      const result = await apns.sendAgent(env, device, userId, pointer);
      if (result === "invalid") await push.invalidate(env, device);
    }),
  );
}

/** Tells the account's Otter Agents iPhones to remove a chat's alerts. */
export async function clearAgentPush(env: Env, userId: string, sessionKey: string): Promise<void> {
  if (!apns.configured(env)) return;
  const devices = await push.agentDevices(env, userId);
  await Promise.all(
    devices.map(async (device) => {
      const result = await apns.clearAgent(env, device, userId, sessionKey);
      if (result === "invalid") await push.invalidate(env, device);
    }),
  );
}

const askOf = (pointer: AgentPointer) =>
  pointer.approvalId
    ? `approval:${pointer.approvalId}`
    : pointer.questionId
      ? `question:${pointer.questionId}`
      : pointer.kind;

export class UserHub extends DurableObject<Env> {
  private agentData: AgentData | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private agents(): AgentData {
    this.agentData ??= new AgentData(this.ctx.storage, this.env.BETTER_AUTH_SECRET);
    return this.agentData;
  }

  /** A device's agent mutations and what changed since it last asked; the account's other devices hear of it. */
  async agentSync(
    userId: string,
    sessionId: string,
    request: AgentSyncRequest,
  ): Promise<AgentSyncResponse> {
    const agents = this.agents();
    if (!agents.imported()) await agents.import(userId, await this.oldAgentData(userId));
    const before = agents.head();
    const response = await agents.sync(userId, request);
    if (agents.head() !== before) {
      const message = JSON.stringify({ type: "agent-sync", email: "" } satisfies RelayEvent);
      for (const socket of this.ctx.getWebSockets()) {
        if (this.ctx.getTags(socket).includes(sessionId)) continue;
        try {
          socket.send(message);
        } catch {
          // Already closing; its device reconnects and catches up.
        }
      }
    }
    return response;
  }

  /** Where the relay kept chats and agents before this store: read once, into it. */
  private async oldAgentData(userId: string) {
    const [chats, preferences] = await Promise.all([
      this.env.DB.prepare("SELECT * FROM chats WHERE user_id = ?").bind(userId).all(),
      this.env.DB.prepare("SELECT data, agent_keys FROM preferences WHERE user_id = ?")
        .bind(userId)
        .first<{ data: string; agent_keys: string | null }>(),
    ]);
    const assistant = preferences
      ? (JSON.parse(preferences.data) as Record<string, unknown>).assistant
      : null;
    const agentKeys = preferences?.agent_keys
      ? await openOldAgentKeys(this.env.BETTER_AUTH_SECRET, userId, preferences.agent_keys)
      : {};
    const json = <T>(value: unknown, fallback: T): T =>
      typeof value === "string" ? (JSON.parse(value) as T) : fallback;
    return {
      assistant,
      agentKeys,
      chats: chats.results.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        provider: String(row.provider),
        sessionId: (row.session_id as string | null) ?? null,
        sessionOwned: Boolean(row.session_owned),
        lastResponseId: (row.last_response_id as string | null) ?? null,
        device: json<Chat["device"]>(row.device, null),
        tabs: json<Chat["tabs"]>(row.tabs, []),
        turns: json<Chat["turns"]>(row.turns, []),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        snoozedUntil: (row.snoozed_until as number | null) ?? null,
        settledAt: (row.settled_at as number | null) ?? null,
        pinnedAt: (row.pinned_at as number | null) ?? null,
        returnedAt: (row.returned_at as number | null) ?? null,
        deletedAt: (row.deleted_at as number | null) ?? null,
      })),
    };
  }

  override async fetch(request: Request): Promise<Response> {
    const sessionId = request.headers.get(SESSION_HEADER);
    if (!sessionId) return new Response("Missing session", { status: 400 });
    const { 0: client, 1: server } = new WebSocketPair();
    // Tagged with the session, so signing out closes exactly that device's sockets.
    this.ctx.acceptWebSocket(server, [sessionId]);
    return new Response(null, { status: 101, webSocket: client });
  }

  publish(event: RelayEvent): number {
    const message = JSON.stringify(event);
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
        delivered += 1;
      } catch {
        // Already closing; its device reconnects and catches up.
      }
    }
    return delivered;
  }

  async queuePush(userId: string, email: string, _historyId: string): Promise<void> {
    // Legacy change markers never produce a visible alert. The provider watcher verifies additions.
    const mailboxes = this.env.NOTIFICATION_MAILBOX;
    if (mailboxes) {
      const id = mailboxes.idFromName(JSON.stringify([userId, email]));
      await retryingReset(
        () => mailboxes.get(id),
        (stub) => stub.changed(),
      );
    }
  }

  async queueVerifiedPush(
    userId: string,
    email: string,
    historyId: string,
    verified: NonNullable<PendingPush["verified"]>,
  ): Promise<void> {
    if (!apns.configured(this.env)) return;
    if (!(await push.devices(this.env, userId, email)).length) return;
    await this.ctx.blockConcurrencyWhile(async () => {
      const previous = await this.ctx.storage.get<string>(`new-marker:${email}`);
      if (!apns.newer(historyId, previous)) return;
      const last = (await this.ctx.storage.get<number>(`last:${email}`)) ?? 0;
      const due = Math.max(Date.now() + 5000, last + 30_000);
      const existing = await this.ctx.storage.get<PendingPush>(`pending:${email}`);
      const nextDue = existing?.due ?? due;
      await this.ctx.storage.put({
        [`new-marker:${email}`]: historyId,
        [`pending:${email}`]: {
          userId,
          email,
          historyId,
          attempts: 0,
          due: nextDue,
          verified,
          inboxMessage: verified.inbox ? verified : existing?.inboxMessage,
        },
      });
      const alarm = await this.ctx.storage.getAlarm();
      if (!alarm || alarm > nextDue) await this.ctx.storage.setAlarm(nextDue);
    });
  }

  override async alarm(): Promise<void> {
    const pending = await this.ctx.storage.list<PendingPush>({ prefix: "pending:" });
    for (const [key, event] of pending) {
      if (event.due > Date.now()) continue;
      if (!event.verified) {
        await this.ctx.storage.delete(key);
        continue;
      }
      let retryDelay = 0;
      const devices = await push.devices(this.env, event.userId, event.email);
      for (const device of devices) {
        const receipt = `new-sent:${device.session_id}:${event.email}`;
        if (!apns.newer(event.historyId, await this.ctx.storage.get<string>(receipt))) continue;
        // Registration/unlink/revocation is checked again immediately before submission.
        const current = (await push.devices(this.env, event.userId, event.email)).find(
          (d) => d.session_id === device.session_id,
        );
        if (!current) continue;
        const selected =
          current.notification_mode === "inbox" ? event.inboxMessage : event.verified;
        if (!selected) continue;
        const linked = await this.env.DB.prepare(
          "SELECT 1 FROM notification_connections WHERE user_id=? AND email=? AND generation=? AND status='ready'",
        )
          .bind(event.userId, event.email, selected.generation)
          .first();
        if (!linked) continue;
        const row = await connection(this.env, event.userId, event.email);
        if (!row || row.generation !== selected.generation) continue;
        try {
          if (!(await stillEligible(this.env, row, selected, current.notification_mode))) {
            await this.ctx.storage.put(receipt, event.historyId);
            continue;
          }
        } catch (error) {
          if (!(error instanceof NotificationFailure && error.reauthorize))
            retryDelay = Math.max(retryDelay, 30_000);
          continue;
        }
        // Provider reads yielded: revocation/unlink/Off may have changed while they were in flight.
        const recipient = (await push.devices(this.env, event.userId, event.email)).find(
          (d) => d.session_id === current.session_id && d.token === current.token,
        );
        if (!recipient) continue;
        if (recipient.notification_mode !== current.notification_mode) {
          retryDelay = Math.max(retryDelay, 5000);
          continue;
        }
        if (
          (await connection(this.env, event.userId, event.email))?.generation !==
          selected.generation
        )
          continue;
        const result = await apns.send(this.env, recipient, {
          version: 2,
          userId: event.userId,
          email: event.email,
          historyId: event.historyId,
          mode: current.notification_mode,
          provider: selected.provider,
          messageId: selected.messageId,
          ...(selected.folder ? { folder: selected.folder } : {}),
          ...(selected.uidValidity ? { uidValidity: selected.uidValidity } : {}),
        });
        if (result === "invalid") await push.invalidate(this.env, recipient);
        if (typeof result === "object") retryDelay = Math.max(retryDelay, result.retryAfterMs);
        else if (result === "retry")
          retryDelay = Math.max(retryDelay, 30_000 * (event.attempts + 1));
        else await this.ctx.storage.put(receipt, event.historyId);
      }
      await this.ctx.storage.put(`last:${event.email}`, Date.now());
      await this.ctx.storage.transaction(async (storage) => {
        const latest = await storage.get<PendingPush>(key);
        if (latest?.historyId !== event.historyId) {
          if (latest)
            await storage.put(key, {
              ...latest,
              due: Math.max(latest.due, Date.now() + Math.max(30_000, retryDelay)),
            });
          return;
        }
        if (retryDelay && event.attempts < 2) {
          await storage.put(key, {
            ...event,
            attempts: event.attempts + 1,
            due: Date.now() + retryDelay,
          });
        } else await storage.delete(key);
      });
    }
    const pendingAgents = await this.ctx.storage.list<PendingAgentPush>({
      prefix: "pending-agent:",
    });
    for (const [key, item] of pendingAgents) {
      if (item.due > Date.now()) continue;
      await this.ctx.storage.delete(key);
      if (item.pointer.sessionKey && this.watching(item.pointer.sessionKey)) continue;
      await this.pushed(item.userId, item.pointer);
      await deliverAgentPush(this.env, item.userId, item.pointer);
    }
    const [remainingMail, remainingAgents] = await Promise.all([
      this.ctx.storage.list<PendingPush>({ prefix: "pending:" }),
      this.ctx.storage.list<PendingAgentPush>({ prefix: "pending-agent:" }),
    ]);
    const dues = [
      ...Array.from(remainingMail.values(), (p) => p.due),
      ...Array.from(remainingAgents.values(), (p) => p.due),
    ];
    if (dues.length) await this.ctx.storage.setAlarm(Math.min(...dues));
  }

  async disconnect(sessionId?: string): Promise<void> {
    for (const socket of this.ctx.getWebSockets(sessionId)) {
      socket.close(4001, "Signed out");
    }
    if (!sessionId) await this.ctx.storage.deleteAll();
    else {
      for (const prefix of [`sent:${sessionId}:`, `new-sent:${sessionId}:`]) {
        const receipts = await this.ctx.storage.list({ prefix });
        if (receipts.size) await this.ctx.storage.delete([...receipts.keys()]);
      }
    }
  }

  async forgetPush(email: string): Promise<void> {
    await this.ctx.storage.delete([
      `pending:${email}`,
      `marker:${email}`,
      `new-marker:${email}`,
      `last:${email}`,
    ]);
    for (const prefix of ["sent:", "new-sent:"]) {
      const receipts = await this.ctx.storage.list({ prefix });
      const matching = [...receipts.keys()].filter((key) => key.endsWith(`:${email}`));
      if (matching.length) await this.ctx.storage.delete(matching);
    }
  }

  /** A device of the account has this agent session on screen, with its window in front. */
  watching(session: string): boolean {
    const since = Date.now() - WATCHING_FOR_MS;
    return this.ctx.getWebSockets().some((socket) => {
      const said = socket.deserializeAttachment() as Attachment | null;
      return said?.session === session && (said.at ?? 0) > since;
    });
  }

  /** The user is actively using Otter on a desktop or web device right now. */
  computerActive(): boolean {
    const since = Date.now() - WATCHING_FOR_MS;
    return this.ctx.getWebSockets().some((socket) => {
      const said = socket.deserializeAttachment() as Attachment | null;
      return (
        (said?.device === "desktop" || said?.device === "web") &&
        said.active === true &&
        (said.at ?? 0) > since
      );
    });
  }

  private async clearPendingAgent(target: string, askId?: string): Promise<void> {
    if (askId) {
      await this.ctx.storage.delete(`pending-agent:${target}:${askId}`);
      return;
    }
    const entries = await this.ctx.storage.list({ prefix: `pending-agent:${target}:` });
    if (entries.size) await this.ctx.storage.delete([...entries.keys()]);
  }

  /**
   * Decides how to route an agent pointer to iPhones:
   * - `suppress`: resolved, already on screen, redundant `finished`, or non-urgent while computer is active
   * - `delay`: blocking ask (`approval`/`question`) while computer is active — queued for escalation
   * - `push`: send to iPhones immediately (originated on iPhone, or computer is idle/away)
   */
  async routeAgentPush(
    userId: string,
    pointer: AgentPointer,
  ): Promise<"push" | "suppress" | "delay"> {
    const target = pointer.sessionKey ?? pointer.agentId;
    const askId = askOf(pointer);
    const pendingKey = `pending-agent:${target}:${askId}`;
    const alertKey = `last-agent-alert:${target}`;

    if (pointer.resolved) {
      const ask = pointer.approvalId || pointer.questionId ? askId : undefined;
      await this.clearPendingAgent(target, ask);
      if (pointer.sessionKey) await this.clearPushed(pointer.sessionKey, ask);
      return "suppress";
    }
    if (pointer.sessionKey && this.watching(pointer.sessionKey)) {
      await this.clearPendingAgent(target);
      return "suppress";
    }

    const now = Date.now();
    if (pointer.kind === "finished") {
      const lastAlert = await this.ctx.storage.get<number>(alertKey);
      if (lastAlert && now - lastAlert < AGENT_COALESCE_MS) return "suppress";
    }

    const origin = pointer.sessionKey
      ? await this.ctx.storage.get<SessionOrigin>(`origin:${pointer.sessionKey}`)
      : undefined;
    const fromPhone = Boolean(origin && now - origin.at < ORIGIN_TTL_MS && origin.device === "ios");
    if (origin && now - origin.at >= ORIGIN_TTL_MS && pointer.sessionKey) {
      await this.ctx.storage.delete(`origin:${pointer.sessionKey}`);
    }

    if (!fromPhone && this.computerActive()) {
      if (pointer.kind === "approval" || pointer.kind === "question") {
        const escalateMs = Number(this.env.AGENT_ESCALATE_MS) || AGENT_ESCALATE_MS;
        const existing = await this.ctx.storage.get<PendingAgentPush>(pendingKey);
        const due = existing ? Math.min(existing.due, now + escalateMs) : now + escalateMs;
        await this.ctx.storage.put({
          [pendingKey]: { userId, pointer, due } satisfies PendingAgentPush,
          [alertKey]: now,
        });
        const alarm = await this.ctx.storage.getAlarm();
        if (!alarm || alarm > due) await this.ctx.storage.setAlarm(due);
        return "delay";
      }
      return "suppress";
    }

    if (pointer.kind !== "finished") await this.ctx.storage.put(alertKey, now);
    await this.pushed(userId, pointer);
    return "push";
  }

  private async pushed(userId: string, pointer: AgentPointer): Promise<void> {
    if (!pointer.sessionKey) return;
    await this.ctx.storage.put(`pushed-agent:${pointer.sessionKey}`, {
      userId,
      ask: askOf(pointer),
    } satisfies PushedAgent);
  }

  /** The chat was opened, or its ask (`ask`, else any) answered, on another device: the iPhones' alert for it goes. */
  private async clearPushed(session: string, ask?: string): Promise<void> {
    const key = `pushed-agent:${session}`;
    const pushed = await this.ctx.storage.get<PushedAgent>(key);
    if (!pushed || (ask && pushed.ask !== ask)) return;
    await this.ctx.storage.delete(key);
    await clearAgentPush(this.env, pushed.userId, session);
  }

  /** Besides `ping` (answered without waking up), a device reports its presence, watched session, sent origin, or resolved ask. */
  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > 600) return;
    let said: {
      type?: unknown;
      session?: unknown;
      active?: unknown;
      device?: unknown;
      id?: unknown;
      at?: unknown;
    };
    try {
      said = JSON.parse(message) as typeof said;
    } catch {
      return;
    }
    if (said.type === "watching") {
      const session = typeof said.session === "string" && said.session ? said.session : undefined;
      const active = typeof said.active === "boolean" ? said.active : undefined;
      const device = isPresenceDevice(said.device) ? said.device : undefined;
      socket.serializeAttachment({ session, active, device, at: Date.now() } satisfies Attachment);
      if (session) await this.clearPendingAgent(session);
      // An iPhone clears its own alerts for the chat it opens.
      if (session && device === "ios") await this.ctx.storage.delete(`pushed-agent:${session}`);
      else if (session) await this.clearPushed(session);
      return;
    }
    if (said.type === "sent") {
      const session = typeof said.session === "string" && said.session ? said.session : undefined;
      const device = isPresenceDevice(said.device) ? said.device : undefined;
      if (!session || !device) return;
      const now = Date.now();
      const rawAt = typeof said.at === "number" && Number.isFinite(said.at) ? said.at : now;
      const at = Math.min(now, rawAt);
      if (now - at >= ORIGIN_TTL_MS) return;
      const existing = await this.ctx.storage.get<SessionOrigin>(`origin:${session}`);
      if (existing && at < existing.at) return;
      await this.ctx.storage.put(`origin:${session}`, { device, at } satisfies SessionOrigin);
      return;
    }
    if (said.type === "resolved") {
      const session = typeof said.session === "string" && said.session ? said.session : undefined;
      const id = typeof said.id === "string" && said.id ? said.id : undefined;
      if (!session) return;
      await this.clearPendingAgent(session, id);
      await this.clearPushed(session, id);
    }
  }

  override webSocketClose(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      // Codes like 1006 can't be echoed; the socket is gone either way.
    }
  }
}
