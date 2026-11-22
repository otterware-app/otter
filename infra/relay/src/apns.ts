import { importPKCS8, SignJWT } from "jose";
import type {
  AgentClearPushMetadata,
  AgentPointer,
  AgentPushMetadata,
  MailPushMetadata,
  NewMailPushMetadata,
} from "@otter/contracts/relay";
import type { Env } from "./worker.ts";
import type { PushDevice } from "./push.ts";

let cached: { key: string; token: Promise<string>; issuedAt: number } | undefined;

/** Cached for 50 minutes: APNs rejects overly frequent provider-token rotation. */
async function authorization(env: Env): Promise<string> {
  const key = `${env.APNS_KEY_ID}:${env.APNS_TEAM_ID}:${env.APNS_PRIVATE_KEY}`;
  const now = Math.floor(Date.now() / 1000);
  if (!cached || cached.key !== key || now - cached.issuedAt >= 3000) {
    const token = importPKCS8(env.APNS_PRIVATE_KEY!, "ES256").then((privateKey) =>
      new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid: env.APNS_KEY_ID! })
        .setIssuer(env.APNS_TEAM_ID!)
        .setIssuedAt(now)
        .sign(privateKey),
    );
    cached = { key, token, issuedAt: now };
    token.catch(() => {
      if (cached?.token === token) cached = undefined;
    });
  }
  return cached.token;
}

export function configured(env: Env): boolean {
  return Boolean(env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_PRIVATE_KEY);
}

/** Explicit allowlist: never spread a Pub/Sub event or registration into the APNs body. */
export function payload(metadata: MailPushMetadata | NewMailPushMetadata) {
  return {
    aps: {
      alert: {
        title: "Otter Mail",
        body:
          metadata.version === 2
            ? "New mail. Open Otter Mail to read it."
            : "Mailbox updated. Open Otter Mail to check your mail.",
      },
      "mutable-content": 1,
      ...(metadata.version === 2 ? { sound: "default" } : {}),
    },
    otter: {
      version: metadata.version,
      userId: metadata.userId,
      email: metadata.email,
      historyId: metadata.historyId,
      mode: metadata.mode,
      ...(metadata.version === 2
        ? {
            provider: metadata.provider,
            messageId: metadata.messageId,
            ...(metadata.folder ? { folder: metadata.folder } : {}),
            ...(metadata.uidValidity ? { uidValidity: metadata.uidValidity } : {}),
          }
        : {}),
    },
  };
}

export type Result = "sent" | "invalid" | "retry" | "rejected" | { retryAfterMs: number };

/** Fetch uses the Workers outbound HTTPS transport; live APNs HTTP/2 delivery must be verified when configuring keys. */
export function send(
  env: Env,
  device: PushDevice,
  metadata: MailPushMetadata | NewMailPushMetadata,
  transport: typeof fetch = fetch,
): Promise<Result> {
  return post(env, device, `${metadata.userId}:${metadata.email}`, payload(metadata), transport);
}

const AGENT_STATUS = {
  approval: "Needs approval",
  question: "Asks a question",
  message: "New message",
  finished: "Finished",
};

/** As the computer's: where it's from (the agent and its chat), then what happened; never what was said. */
export function agentPayload(userId: string, pointer: AgentPointer) {
  // The chat's title and the agent's name show twice (the alert, and the extension's copy): they're
  // cut, the title first, until the push fits APNs' limit.
  const fitted = { ...pointer };
  for (const field of ["title", "agentName"] as const) {
    let chars = Array.from(fitted[field] ?? "");
    while (chars.length > 0 && bytes(agentAlert(userId, fitted)) > APNS_MAX_BYTES) {
      chars = chars.slice(0, Math.floor(chars.length * 0.8));
      fitted[field] = chars.length > 0 ? chars.join("") : undefined;
    }
  }
  return agentAlert(userId, fitted);
}

const APNS_MAX_BYTES = 4096;
const bytes = (payload: unknown) => new TextEncoder().encode(JSON.stringify(payload)).length;

function agentAlert(userId: string, pointer: AgentPointer) {
  const title = [pointer.agentName, pointer.title].filter(Boolean).join(" · ") || "Otter Agents";
  const body = AGENT_STATUS[pointer.kind];
  const passive = pointer.kind === "finished";
  return {
    aps: {
      alert: { title, body },
      "interruption-level": passive ? "passive" : "active",
      ...(passive ? {} : { sound: "default" }),
      ...(pointer.sessionKey ? { "thread-id": pointer.sessionKey } : {}),
      // Otter Agents' extension makes it a message from the agent, with its picture.
      "mutable-content": 1,
    },
    otter: {
      version: 1,
      kind: "agent",
      userId,
      pointer: {
        kind: pointer.kind,
        agentId: pointer.agentId,
        sessionKey: pointer.sessionKey,
        ...(pointer.approvalId ? { approvalId: pointer.approvalId } : {}),
        ...(pointer.approvalKind ? { approvalKind: pointer.approvalKind } : {}),
        ...(pointer.questionId ? { questionId: pointer.questionId } : {}),
        ...(pointer.title ? { title: pointer.title } : {}),
        ...(pointer.agentName ? { agentName: pointer.agentName } : {}),
        at: pointer.at,
      },
    } satisfies AgentPushMetadata,
  };
}

/** One alert per chat: a newer update in the same chat replaces the previous one rather than stacking. */
export function sendAgent(
  env: Env,
  device: PushDevice,
  userId: string,
  pointer: AgentPointer,
  transport: typeof fetch = fetch,
): Promise<Result> {
  const collapse = `${userId}:${pointer.sessionKey ?? pointer.agentId}`;
  const priority = pointer.kind === "finished" ? "5" : "10";
  return post(env, device, collapse, agentPayload(userId, pointer), transport, priority);
}

/** Silent (a background push): the iPhone removes the chat's alerts, read or answered elsewhere. */
export function clearAgent(
  env: Env,
  device: PushDevice,
  userId: string,
  sessionKey: string,
  transport: typeof fetch = fetch,
): Promise<Result> {
  const body = {
    aps: { "content-available": 1 },
    otter: { version: 1, kind: "agent-clear", userId, sessionKey } satisfies AgentClearPushMetadata,
  };
  return post(env, device, `${userId}:${sessionKey}:clear`, body, transport, "5", "background");
}

async function post(
  env: Env,
  device: PushDevice,
  collapseKey: string,
  body: unknown,
  transport: typeof fetch,
  priority: "5" | "10" = "10",
  type: "alert" | "background" = "alert",
): Promise<Result> {
  const host =
    device.environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const origin = env.APNS_TEST_ORIGIN ?? `https://${host}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(collapseKey));
  const collapse = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  // Errors and retries are handled by the durable alarm, never logged with tokens/payloads.
  try {
    const response = await transport(`${origin}/3/device/${device.token}`, {
      method: "POST",
      redirect: "manual",
      headers: {
        authorization: `bearer ${await authorization(env)}`,
        "apns-topic": device.topic,
        "apns-push-type": type,
        "apns-priority": priority,
        "apns-expiration": "0", // Don't queue stale alerts across sign-out/offline periods.
        "apns-collapse-id": collapse,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 200) return "sent";
    const error = (await response.json().catch(() => null)) as {
      reason?: string;
      timestamp?: number;
    } | null;
    if (response.status === 410) {
      return error?.timestamp && error.timestamp < device.updated_at ? "rejected" : "invalid";
    }
    if (error?.reason === "BadDeviceToken" || error?.reason === "DeviceTokenNotForTopic")
      return "invalid";
    if (error?.reason === "ExpiredProviderToken") {
      cached = undefined;
      return "retry";
    }
    if (response.status >= 500) return { retryAfterMs: 15 * 60_000 };
    if (error?.reason === "TooManyProviderTokenUpdates") return { retryAfterMs: 20 * 60_000 };
    if (response.status === 429) return "retry";
    console.warn("APNs rejected a notification", response.status);
    return "rejected";
  } catch {
    return "retry";
  }
}

export function newer(historyId: string, previous?: string): boolean {
  return /^\d{1,20}$/.test(historyId) && (!previous || BigInt(historyId) > BigInt(previous));
}
