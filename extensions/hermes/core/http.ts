import { hermesStep } from "@otter/core/extension-kit";
import type { AgentSecrets, ChatSession, ChatSessionMessage } from "@otter/core/extension-kit";

import type { HermesSettings } from "./settings.js";

export const PROBE_TIMEOUT_MS = 4_000;

export function normalizeHermesBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export function apiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/v1$/i, "");
}

export function authHeaders(key: string, json = false): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

export type Ready = { baseUrl: string; root: string; key: string; agentModel: string };

export async function requireReady(
  settings: HermesSettings,
  secrets: AgentSecrets,
): Promise<Ready> {
  const key = await secrets.get("key");
  const { baseUrl, agentModel } = settings;
  if (!baseUrl || !key) throw new Error("not_configured");
  return { baseUrl, root: apiRoot(baseUrl), key, agentModel };
}

export async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } | string };
    const error = body.error;
    return (typeof error === "string" ? error : error?.message) ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function readSse(
  body: ReadableStream<Uint8Array>,
  onFrame: (event: string | null, data: string) => void,
  onActivity: () => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity();
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const sep = buffer.indexOf("\n\n");
      if (sep === -1) break;
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event: string | null = null;
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (data.length > 0) onFrame(event, data.join("\n"));
    }
  }
}

export function parseJson(json: string): Record<string, unknown> | null {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        const p = part as { type?: string; text?: string };
        return p.type === "text" || p.type === "output_text" || p.type === "input_text"
          ? (p.text ?? "")
          : "";
      })
      .join("");
  }
  if (content && typeof content === "object") return (content as { text?: string }).text ?? "";
  return "";
}

export type RawSession = {
  id?: string;
  title?: string | null;
  source?: string;
  last_active?: number | string | null;
  started_at?: number | string | null;
  ended_at?: number | string | null;
  end_reason?: string | null;
  message_count?: number | null;
  preview?: string | null;
  model?: string | null;
};

export function toMillis(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Date.parse(value) || Number(value);
  if (!Number.isFinite(n)) return 0;
  // The gateway stores epoch seconds (float); ISO strings already parse to ms.
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

export function toSession(raw: RawSession): ChatSession {
  return {
    id: String(raw.id ?? ""),
    title: raw.title ? String(raw.title) : null,
    source: String(raw.source ?? "api_server"),
    lastActive: toMillis(raw.last_active) || toMillis(raw.started_at),
    messageCount: Number(raw.message_count ?? 0) || 0,
    preview: raw.preview ? String(raw.preview) : null,
  };
}

export type RawMessage = {
  id?: number;
  timestamp?: number;
  role?: string;
  content?: unknown;
  tool_name?: string | null;
  tool_calls?:
    | { function?: { name?: string; arguments?: string }; name?: string; arguments?: string }[]
    | null;
};

export function toMessage(m: RawMessage): ChatSessionMessage {
  const role = m.role === "user" || m.role === "assistant" || m.role === "tool" ? m.role : "system";
  const toolCalls = (m.tool_calls ?? [])
    .filter((call) => call.function?.name ?? call.name)
    .map((call) =>
      hermesStep(
        call.function?.name ?? call.name ?? "",
        call.function?.arguments ?? call.arguments,
      ),
    );
  return {
    role,
    text: contentText(m.content),
    ...(m.tool_name ? { toolName: String(m.tool_name) } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

/** Oldest first: the whole session, or (`latest`) its last messages. */
export async function rawMessages(
  ready: Ready,
  sessionId: string,
  latest?: number,
): Promise<RawMessage[]> {
  const page = latest ? `order=latest&limit=${latest}` : "order=oldest&limit=500";
  const response = await fetch(
    `${ready.root}/api/sessions/${encodeURIComponent(sessionId)}/messages?${page}`,
    { headers: authHeaders(ready.key), signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error(await readError(response));
  return ((await response.json()) as { data?: RawMessage[] }).data ?? [];
}

export async function sessionMessages(
  ready: Ready,
  sessionId: string,
): Promise<ChatSessionMessage[]> {
  return (await rawMessages(ready, sessionId)).map(toMessage);
}

/** GET /api/sessions, most recently active first; of one source (`cron`, `otter`) or all. */
export async function listSessions(
  ready: Ready,
  limit: number,
  source?: string,
): Promise<RawSession[]> {
  const response = await fetch(
    `${ready.root}/api/sessions?${source ? `source=${source}&` : ""}limit=${limit}`,
    { headers: authHeaders(ready.key), signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error(await readError(response));
  return ((await response.json()) as { data?: RawSession[] }).data ?? [];
}

/** The gateway's platforms (GET /health/detailed): Otter's plugin, Telegram…, by name. */
export async function connectedPlatforms(ready: Ready): Promise<string[]> {
  const response = await fetch(`${ready.root}/health/detailed`, {
    headers: authHeaders(ready.key),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { platforms?: Record<string, { state?: string }> };
  return Object.entries(body.platforms ?? {})
    .filter(([, p]) => p.state === "connected")
    .map(([name]) => name);
}

export async function sessionOf(ready: Ready, sessionId: string): Promise<RawSession | null> {
  const response = await fetch(`${ready.root}/api/sessions/${encodeURIComponent(sessionId)}`, {
    headers: authHeaders(ready.key),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await readError(response));
  return ((await response.json()) as { session?: RawSession }).session ?? null;
}

/** What follows the last message of yours: the reply to it, so far. */
export function lastReply(messages: ChatSessionMessage[]): ChatSessionMessage[] {
  const last = messages.findLastIndex((m) => m.role === "user");
  return messages.slice(last + 1).filter((m) => m.role !== "system");
}
