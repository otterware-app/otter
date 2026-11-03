import { logger } from "../logger.js";
import { getAccount } from "./account-store.js";
import { providerFor } from "../providers/index.js";
import * as store from "./mail-store.js";
import { buildMime, formatAddress } from "./outgoing.js";

export type UnsubscribeInfo = {
  method: "oneClick" | "mailto" | "web";
  target: string;
};

type Parsed = { https?: string; mailto?: string; oneClick: boolean };

const cache = new Map<string, Parsed | null>();

function parse(header: string, oneClick: boolean): Parsed | null {
  const links = [...header.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
  const https = links.find((l) => /^https:\/\//i.test(l));
  const mailto = links.find((l) => /^mailto:/i.test(l));
  return https || mailto ? { https, mailto, oneClick: oneClick && Boolean(https) } : null;
}

async function lookup(accountId: string, messageId: string): Promise<Parsed | null> {
  const key = `${accountId}:${messageId}`;
  if (cache.has(key)) return cache.get(key)!;
  const { listUnsubscribe, oneClick } = await providerFor(accountId).getUnsubscribeHeaders(
    accountId,
    messageId,
  );
  const parsed = listUnsubscribe ? parse(listUnsubscribe, oneClick) : null;
  cache.set(key, parsed);
  return parsed;
}

function describe(p: Parsed): UnsubscribeInfo {
  if (p.oneClick && p.https) return { method: "oneClick", target: new URL(p.https).hostname };
  if (p.mailto)
    return { method: "mailto", target: p.mailto.replace(/^mailto:/i, "").split("?")[0] };
  return { method: "web", target: new URL(p.https!).hostname };
}

export async function getUnsubscribe(
  accountId: string,
  messageId: string,
): Promise<UnsubscribeInfo | null> {
  const parsed = await lookup(accountId, messageId);
  return parsed ? describe(parsed) : null;
}

export function unsubscribeEmail(
  mailto: string,
  from: string,
): { to: string; subject: string; body: string; raw: string } {
  const url = new URL(mailto);
  const to = decodeURIComponent(url.pathname).trim();
  const subject = url.searchParams.get("subject") ?? "unsubscribe";
  const body = url.searchParams.get("body") ?? "unsubscribe";
  if (!/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/.test(to)) {
    throw new Error("This message's unsubscribe address isn't one address.");
  }
  if (/[\r\n]/.test(subject)) throw new Error("This message's unsubscribe link is malformed.");
  const raw = buildMime({ from, to, subject, body });
  return { to, subject, body, raw };
}

async function sendUnsubscribeEmail(accountId: string, mailto: string): Promise<void> {
  const account = await getAccount(accountId);
  const me = account?.email ?? accountId;
  const { raw } = unsubscribeEmail(mailto, formatAddress(account?.name ?? "", me));
  await providerFor(accountId).sendRaw(accountId, raw);
}

export async function unsubscribe(
  accountId: string,
  messageId: string,
): Promise<{ done: true } | { openUrl: string }> {
  const parsed = await lookup(accountId, messageId);
  if (!parsed) throw new Error("This message has no unsubscribe link.");
  if (parsed.oneClick && parsed.https) {
    const response = await fetch(parsed.https, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok || response.status === 202 || response.status === 204) {
      logger.info("unsubscribe", "one-click", { host: new URL(parsed.https).hostname });
      remember(accountId, messageId);
      return { done: true };
    }
    logger.info("unsubscribe", "one-click refused", { status: response.status });
  }
  if (parsed.mailto) {
    await sendUnsubscribeEmail(accountId, parsed.mailto);
    logger.info("unsubscribe", "mailto");
    remember(accountId, messageId);
    return { done: true };
  }
  return { openUrl: parsed.https! };
}

function remember(accountId: string, messageId: string): void {
  const detail = store.getMessageDetail(accountId, messageId);
  if (detail?.fromEmail)
    store.setKv(`unsubscribed:${accountId}:${detail.fromEmail.toLowerCase()}`, "1");
}

export function isUnsubscribed(accountId: string, fromEmail: string): boolean {
  return store.getKv(`unsubscribed:${accountId}:${fromEmail.toLowerCase()}`) === "1";
}
