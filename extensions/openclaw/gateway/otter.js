// What the plugin does, apart from OpenClaw's SDK, so Otter's tests can run it.
import { randomUUID } from "node:crypto";

/** Who sends what you type in Otter: the gateway's owner once `commands.ownerAllowFrom` lists `otter:owner`. */
export const OWNER = "owner";
export const OWNER_ENTRY = `otter:${OWNER}`;

/** A chat in Otter is a target of its own: what's sent to it is kept in its session. */
export const chatTarget = (sessionKey) => `chat:${sessionKey}`;

/** Like posting to a Slack channel rather than in a thread: each delivery starts a chat of its own. */
export const NEW_CHAT_TARGET = "chat:new";

const bare = (to) => (typeof to === "string" ? to.trim().replace(/^otter:/, "") : "");

/** What's sent to the gateway's owner (`otter:owner`) starts a chat, as it names none. */
export const isNewChat = (to) => bare(to) === NEW_CHAT_TARGET || bare(to) === OWNER;

/** A target as the channel keeps it: one of Otter's chats, or a new one each time; else none. */
export function targetOf(to) {
  const chat = chatOf(to);
  if (chat) return chatTarget(chat);
  return isNewChat(to) ? NEW_CHAT_TARGET : undefined;
}

export const TARGETS_HINT =
  '"chat:<session key>" for one of Otter\'s chats, or "chat:new" for a new one';

/** A session for a new chat, an Otter chat like one you start. */
export const newChatKey = (agentId, id) => `agent:${agentId}:otter-mail:${id}`;

/**
 * What an agent in an Otter chat is told about sending to Otter (the message tool, an automation's
 * delivery), with this chat's own target.
 */
export function otterTargetsNote(sessionKey) {
  const here = agentOf(sessionKey) ? chatTarget(sessionKey) : "chat:<session key>";
  return [
    "Otter delivery targets (channel `otter`), like replying in a thread or a new post in Slack:",
    `- "${here}": this chat. Any Otter chat is "chat:<its session key>".`,
    '- "chat:new": a new Otter chat for each delivery (an automation that should post a fresh chat every run, such as a morning brief or an alert).',
  ].join("\n");
}

export const agentOf = (sessionKey) =>
  typeof sessionKey === "string" && sessionKey.startsWith("agent:")
    ? sessionKey.split(":")[1]
    : undefined;

/** The chat a target names, if it names one. */
export function chatOf(to) {
  const target = bare(to);
  if (!target.startsWith("chat:")) return undefined;
  const sessionKey = target.slice("chat:".length);
  return agentOf(sessionKey) ? sessionKey : undefined;
}

export const isOwnerConfigured = (cfg) =>
  Array.isArray(cfg?.commands?.ownerAllowFrom) &&
  cfg.commands.ownerAllowFrom.some((entry) => String(entry).trim() === OWNER_ENTRY);

/**
 * What the relay is told of a delivery: never its text, only where to read it.
 * Otter's apps read it from the gateway themselves.
 */
export function pointerOf({ sessionKey, to, payload, at = Date.now() }) {
  const data = payload?.channelData ?? {};
  const approval = data.execApproval;
  const question = data.askUser;
  const session = approval?.sessionKey ?? sessionKey;
  // A new chat's session is the one its delivery was routed to.
  const chat = chatOf(to) ?? (isNewChat(to) && agentOf(sessionKey) ? sessionKey : undefined);
  const agentId = approval?.agentId ?? agentOf(chat ?? session) ?? "main";
  return {
    kind: approval ? "approval" : question ? "question" : "message",
    agentId,
    sessionKey: approval || question ? (session ?? null) : (chat ?? session ?? null),
    ...(approval && {
      approvalId: String(approval.approvalId),
      approvalKind: approval.approvalKind === "plugin" ? "plugin" : "exec",
      resolved: approval.state === "resolved",
    }),
    ...(question && { questionId: String(question.questionId) }),
    at,
  };
}

/** What a run is for when it isn't an answer to you: a schedule's delivery tells Otter itself. */
const QUIET_TRIGGERS = new Set(["cron", "heartbeat", "memory", "overflow"]);

/**
 * What the relay is told when a run ends in one of Otter's chats (one it started, or one you
 * wrote to from Otter), so a phone that isn't looking hears of it. Nothing for any other run.
 */
export function finishedOf(ctx, at = Date.now()) {
  const sessionKey = ctx?.sessionKey;
  const agentId = agentOf(sessionKey);
  if (!agentId || ctx.jobId || QUIET_TRIGGERS.has(ctx.trigger)) return undefined;
  const kind = sessionKey.split(":")[2];
  const fromOtter = ctx.channel === "otter" || ctx.messageProvider === "otter";
  if (kind !== "otter-mail" && (!fromOtter || kind === "subagent" || kind === "cron"))
    return undefined;
  return { kind: "finished", agentId, sessionKey, at };
}

export function accountOf(cfg) {
  const section = cfg?.channels?.otter ?? {};
  return {
    accountId: "default",
    enabled: section.enabled !== false,
    relayUrl: typeof section.relayUrl === "string" ? section.relayUrl.replace(/\/+$/, "") : "",
    token: typeof section.token === "string" ? section.token : "",
  };
}

/** Tells Otter's devices; the delivery itself is already kept on the gateway. */
export async function tell(account, pointer, { fetch = globalThis.fetch, signal } = {}) {
  if (!account.relayUrl || !account.token) return false;
  const response = await fetch(`${account.relayUrl}/channel/v1/pointers`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${account.token}` },
    body: JSON.stringify(pointer),
  });
  if (!response.ok) throw new Error(`Otter's relay answered ${response.status}`);
  return true;
}

/** A delivery to Otter: kept on the gateway even when the relay can't be told of it. */
export async function deliver(ctx, payload, { warn, fetch } = {}) {
  const pointer = pointerOf({ sessionKey: ctx.sessionKey, to: ctx.to, payload });
  try {
    await tell(accountOf(ctx.cfg), pointer, { fetch, signal: ctx.signal });
  } catch (error) {
    if (ctx.signal?.aborted) throw error;
    warn?.(`otter: couldn't tell Otter's devices of a delivery: ${String(error)}`);
  }
  return { channel: "otter", messageId: randomUUID(), timestamp: pointer.at };
}

/**
 * Runs `prepare`, then `run` with what it made, in `detach(work, fail)`: settles once prepared,
 * with `prepare`'s error or `detach`'s; what `run` throws goes to `warn`.
 */
export const startDetached = (detach, prepare, run, warn) =>
  new Promise((resolve, reject) => {
    const work = async () => {
      let ready;
      try {
        ready = await prepare();
      } catch (error) {
        return reject(error);
      }
      resolve();
      try {
        await run(ready);
      } catch (error) {
        warn?.(error);
      }
    };
    try {
      detach(work, reject);
    } catch (error) {
      reject(error);
    }
  });

/** A message sent from Otter, checked: where it goes and what it carries. */
export function messageOf(params) {
  const { sessionKey, message, idempotencyKey, attachments } = params ?? {};
  if (typeof sessionKey !== "string" || !agentOf(sessionKey))
    throw new Error("sessionKey must be an agent's session");
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim())
    throw new Error("idempotencyKey is required");
  const files = Array.isArray(attachments) ? attachments : [];
  for (const file of files)
    if (typeof file?.content !== "string" || typeof file?.mimeType !== "string")
      throw new Error("each attachment needs its content (base64) and mimeType");
  const text = typeof message === "string" ? message : "";
  if (!text.trim() && files.length === 0) throw new Error("message or attachments are required");
  return { sessionKey, agentId: agentOf(sessionKey), text, messageId: idempotencyKey, files };
}
