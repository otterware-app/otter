/**
 * Gmail REST API client.
 * Base URL: https://gmail.googleapis.com/gmail/v1/users/me
 *
 * gmailFetch: authenticated fetch that spends the account's Gmail quota through
 * quota.ts (user actions first, sync in the background) and backs off on
 * rate limits (429, and 403 per-user quota errors).
 */

import { fromBase64, toBase64Url, utf8Decode, utf8Encode } from "../../bytes.js";
import { SIGNED_OUT_MESSAGE } from "../../google.js";
import { logger } from "../../logger.js";
import { platform } from "../../platform.js";
import { mapPool } from "../../pool.js";
import { getAccount } from "../../services/account-store.js";
import { buildMime, senderOf } from "../../services/outgoing.js";
import type { MailLabel, MessageSummary, MessageDetail } from "../../types.js";
import type { DraftSave, ErrorKind, OutgoingMail } from "../provider.js";
import {
  acquireQuota,
  budgetOf,
  isBackgroundWork,
  quotaCost,
  reportQuotaExceeded,
  spentLastMinute,
} from "./quota.js";

const BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Retries after a rate-limit error. Gmail's quota window is a minute, so the
 * user's own requests wait it out too (writes already answer the UI early and
 * finish in the background, see settleWrite); sync work backs off longer.
 * The quota is per user and per Google project, shared with every other app
 * signed in through the same project, so this app alone can't stay under it.
 */
const FOREGROUND_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];
const BACKGROUND_MAX_RETRIES = 6;
const BACKGROUND_TRANSIENT_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 90_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRateLimited(status: number, body: string): boolean {
  if (status === 429) return true;
  return (
    status === 403 &&
    /rateLimitExceeded|userRateLimitExceeded|RATE_LIMIT_EXCEEDED|Quota exceeded/.test(body)
  );
}

function gmailErrorMessage(body: string): string {
  try {
    return (JSON.parse(body) as { error?: { message?: string } }).error?.message?.trim() ?? "";
  } catch {
    return body.trim().slice(0, 200);
  }
}

export class GmailApiError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
    readonly body: string,
  ) {
    const reason = isRateLimited(status, body)
      ? "Gmail is limiting requests for this account right now. Try again in a minute."
      : gmailErrorMessage(body);
    super(`Gmail API error: ${status} ${statusText}${reason ? ` — ${reason}` : ""}`);
    this.name = "GmailApiError";
  }

  get rateLimited(): boolean {
    return isRateLimited(this.status, this.body);
  }
}

export function isRateLimitError(err: unknown): boolean {
  return err instanceof GmailApiError && err.rateLimited;
}

export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error) || err instanceof GmailApiError) return false;
  return (
    err.name === "TimeoutError" ||
    err.name === "AbortError" ||
    /fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(
      `${err.message} ${String((err as { cause?: unknown }).cause ?? "")}`,
    )
  );
}

export function errorKind(err: unknown): ErrorKind | null {
  if (isRateLimitError(err)) return "rateLimit";
  if (isNetworkError(err)) return "network";
  if (err instanceof GmailApiError && err.status === 404) return "notFound";
  if (isSignInError(err)) return "auth";
  return null;
}

function isSignInError(err: unknown): boolean {
  if (err instanceof GmailApiError) {
    return (
      err.status === 401 ||
      (err.status === 403 && /insufficient(Permissions| authentication scopes)/i.test(err.body))
    );
  }
  const text = String(err);
  return text.includes(SIGNED_OUT_MESSAGE) || text.includes("Google sign-in expired");
}

export function describeError(err: unknown): string {
  if (isRateLimitError(err)) return "Gmail is limiting requests right now — retrying shortly";
  if (isNetworkError(err)) return "Can't reach Gmail — retrying when the connection is back";
  const text = String(err);
  if (text.includes(SIGNED_OUT_MESSAGE) || text.includes("Google sign-in expired")) {
    return SIGNED_OUT_MESSAGE;
  }
  if (err instanceof GmailApiError) {
    if (err.status === 401) {
      return "Gmail rejected this account's sign-in — sign in to it again";
    }
    if (err.status >= 500) return "Gmail is having trouble right now — retrying shortly";
    let detail = "";
    try {
      detail = (JSON.parse(err.body) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      // not JSON: fall back to the status alone
    }
    return `Gmail error ${err.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`;
  }
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

type GmailFetchInit = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

async function gmailFetch(
  accountId: string,
  path: string,
  init: GmailFetchInit = {},
  retryCount = 0,
  attempt: { tokenRefreshed?: boolean; transientRetries?: number } = {},
): Promise<unknown> {
  await acquireQuota(accountId, quotaCost(init.method ?? "GET", path));
  const token = await platform().google.getAccessToken(accountId);
  const background = isBackgroundWork();

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const tries = attempt.transientRetries ?? 0;
    if (background && tries < BACKGROUND_TRANSIENT_RETRIES && isNetworkError(err)) {
      await sleep(2000 * 2 ** tries);
      return gmailFetch(accountId, path, init, retryCount, {
        ...attempt,
        transientRetries: tries + 1,
      });
    }
    throw err;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 401 && !attempt.tokenRefreshed) {
      await platform().google.getAccessToken(accountId, { forceRefresh: true });
      return gmailFetch(accountId, path, init, retryCount, { ...attempt, tokenRefreshed: true });
    }
    if (isRateLimited(response.status, body)) {
      const retryAfter = parseInt(response.headers.get("Retry-After") ?? "", 10) * 1000;
      const spent = spentLastMinute(accountId);
      if (reportQuotaExceeded(accountId, retryAfter > 0 ? retryAfter : 0)) {
        logger.info("gmail", `rate limited (${response.status}): ${gmailErrorMessage(body)}`, {
          spentLastMinute: spent,
          budgetNow: budgetOf(accountId),
        });
      }
      const waitMs = background
        ? retryAfter > 0
          ? retryAfter
          : Math.min(1000 * 2 ** retryCount, 32_000)
        : retryAfter > 0 && retryCount < FOREGROUND_RETRY_DELAYS_MS.length
          ? retryAfter
          : FOREGROUND_RETRY_DELAYS_MS[retryCount];
      const canRetry = background ? retryCount < BACKGROUND_MAX_RETRIES : waitMs !== undefined;
      if (canRetry) {
        await sleep(waitMs);
        return gmailFetch(accountId, path, init, retryCount + 1, attempt);
      }
    }
    const tries = attempt.transientRetries ?? 0;
    if (background && response.status >= 500 && tries < BACKGROUND_TRANSIENT_RETRIES) {
      await sleep(1000 * 2 ** tries);
      return gmailFetch(accountId, path, init, retryCount, {
        ...attempt,
        transientRetries: tries + 1,
      });
    }
    throw new GmailApiError(response.status, response.statusText, body);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

export async function listLabelNames(
  accountId: string,
): Promise<{ id: string; name: string; type: string }[]> {
  const data = (await gmailFetch(accountId, "/labels")) as {
    labels?: { id: string; name: string; type: string }[];
  };
  return data.labels ?? [];
}

export async function listLabels(accountId: string): Promise<MailLabel[]> {
  const rawLabels = await listLabelNames(accountId);

  // labels.list omits message counts and color — only labels.get returns them,
  // so fetch per-label detail for every label.
  const fetched = await mapPool(
    rawLabels,
    8,
    (l) =>
      gmailFetch(accountId, `/labels/${l.id}`) as Promise<{
        id: string;
        messagesUnread?: number;
        messagesTotal?: number;
        color?: { backgroundColor?: string; textColor?: string };
      }>,
  );
  const detailById = new Map(fetched.map((label) => [label.id, label]));

  return rawLabels.map((label) => {
    const detail = detailById.get(label.id);
    return {
      id: label.id,
      name: label.name,
      type: label.type === "system" ? "system" : "user",
      unread: detail?.messagesUnread,
      total: detail?.messagesTotal,
      color:
        detail?.color?.backgroundColor && detail.color.textColor
          ? { backgroundColor: detail.color.backgroundColor, textColor: detail.color.textColor }
          : undefined,
    };
  });
}

export async function createLabel(accountId: string, name: string): Promise<MailLabel> {
  const data = (await gmailFetch(accountId, "/labels", {
    method: "POST",
    body: JSON.stringify({
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  })) as { id: string; name: string };

  return { id: data.id, name: data.name, type: "user" };
}

type SendAs = {
  sendAsEmail: string;
  isPrimary?: boolean;
  signature?: string;
  verificationStatus?: "accepted" | "pending";
};

async function listSendAs(accountId: string): Promise<SendAs[]> {
  const { sendAs = [] } = (await gmailFetch(accountId, "/settings/sendAs")) as {
    sendAs?: SendAs[];
  };
  return sendAs;
}

export async function getSendAs(accountId: string, email: string): Promise<string[]> {
  return (await listSendAs(accountId))
    .filter((s) => s.sendAsEmail.toLowerCase() !== email.toLowerCase())
    .filter((s) => s.verificationStatus !== "pending")
    .map((s) => s.sendAsEmail);
}

export async function getSignature(accountId: string, email: string): Promise<string> {
  const sendAs = await listSendAs(accountId);
  const own =
    sendAs.find((s) => s.sendAsEmail.toLowerCase() === email.toLowerCase()) ??
    sendAs.find((s) => s.isPrimary);
  return own?.signature ?? "";
}

export async function setSignature(
  accountId: string,
  email: string,
  html: string,
): Promise<string> {
  const saved = (await gmailFetch(accountId, `/settings/sendAs/${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ signature: html }),
  })) as SendAs;
  return saved.signature ?? "";
}

/**
 * Rename and/or recolor a label. Gmail nests by "/" path but a patch does not
 * move children, so renames cascade to every nested label.
 */
export async function updateLabel(
  accountId: string,
  params: {
    labelId: string;
    name?: string;
    color?: { backgroundColor: string; textColor: string };
  },
): Promise<{ ok: true }> {
  const body: Record<string, unknown> = {};
  if (params.name) body.name = params.name;
  if (params.color) body.color = params.color;

  let children: { id: string; name: string }[] = [];
  let oldName: string | undefined;
  if (params.name) {
    const list = (await gmailFetch(accountId, "/labels")) as {
      labels?: { id: string; name: string; type: string }[];
    };
    oldName = (list.labels ?? []).find((l) => l.id === params.labelId)?.name;
    if (oldName) {
      const prefix = `${oldName}/`;
      children = (list.labels ?? []).filter((l) => l.type === "user" && l.name.startsWith(prefix));
    }
  }

  await gmailFetch(accountId, `/labels/${params.labelId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (params.name && oldName) {
    for (const child of children) {
      await gmailFetch(accountId, `/labels/${child.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: `${params.name}${child.name.slice(oldName.length)}` }),
      });
    }
  }
  return { ok: true };
}

export async function deleteLabel(accountId: string, labelId: string): Promise<{ ok: true }> {
  await gmailFetch(accountId, `/labels/${labelId}`, { method: "DELETE" });
  return { ok: true };
}

function parseFrom(from: string): { fromName: string; fromEmail: string } {
  const match = from.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return { fromName: match[1].trim().replace(/^"|"$/g, ""), fromEmail: match[2].trim() };
  }
  return { fromName: from, fromEmail: from };
}

function getHeaderValue(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export async function getUnsubscribeHeaders(
  accountId: string,
  messageId: string,
): Promise<{ listUnsubscribe: string; oneClick: boolean }> {
  const msg = (await gmailFetch(
    accountId,
    `/messages/${messageId}?format=metadata&metadataHeaders=List-Unsubscribe&metadataHeaders=List-Unsubscribe-Post`,
  )) as { payload?: { headers?: { name: string; value: string }[] } };
  const headers = msg.payload?.headers ?? [];
  return {
    listUnsubscribe: getHeaderValue(headers, "List-Unsubscribe"),
    oneClick: /List-Unsubscribe=One-Click/i.test(getHeaderValue(headers, "List-Unsubscribe-Post")),
  };
}

export interface RawMessageMetadata {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: { name: string; value: string }[];
    parts?: unknown[];
  };
}

export function mapMessageSummary(msg: RawMessageMetadata): MessageSummary {
  const headers = msg.payload?.headers ?? [];
  const from = getHeaderValue(headers, "From");
  const { fromName, fromEmail } = parseFrom(from);
  const labelIds = msg.labelIds ?? [];

  return {
    id: msg.id,
    threadId: msg.threadId,
    fromName,
    fromEmail,
    to: getHeaderValue(headers, "To"),
    subject: getHeaderValue(headers, "Subject"),
    snippet: msg.snippet ?? "",
    date: msg.internalDate ? parseInt(msg.internalDate, 10) : 0,
    unread: labelIds.includes("UNREAD"),
    starred: labelIds.includes("STARRED"),
    labelIds,
    hasAttachments: false, // metadata format does not expose attachment info reliably
    messageIdHeader: getHeaderValue(headers, "Message-ID") || undefined,
    referencesHeader: getHeaderValue(headers, "References") || undefined,
  };
}

export async function fetchMetadataForIds(
  accountId: string,
  ids: string[],
): Promise<MessageSummary[]> {
  // messages.get costs 5 quota units; quota.ts paces the calls, so the
  // pool only bounds sockets in flight.
  const fetched = await mapPool(ids, 6, async (id) => {
    try {
      return (await gmailFetch(
        accountId,
        `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=References`,
      )) as RawMessageMetadata;
    } catch (err) {
      // A message can be purged between the history feed listing it and this
      // fetch; a dead id must not kill the sync (the cursor would never
      // advance and every tick would replay the same failure).
      if (err instanceof GmailApiError && err.status === 404) return null;
      throw err;
    }
  });

  return fetched.filter((m): m is RawMessageMetadata => m !== null).map(mapMessageSummary);
}

export async function fetchMessagesForIds(
  accountId: string,
  ids: string[],
): Promise<MessageDetail[]> {
  const fetched = await mapPool(ids, 6, async (id) => {
    try {
      return await getMessage(accountId, id);
    } catch (err) {
      if (err instanceof GmailApiError && err.status === 404) return null;
      throw err;
    }
  });
  return fetched.filter((m): m is MessageDetail => m !== null);
}

export async function getProfile(
  accountId: string,
): Promise<{ historyId: string; messagesTotal: number }> {
  const data = (await gmailFetch(accountId, "/profile")) as {
    historyId?: string;
    messagesTotal?: number;
  };
  return { historyId: data.historyId ?? "", messagesTotal: data.messagesTotal ?? 0 };
}

export async function listMessageIdsPage(
  accountId: string,
  params: { pageToken?: string; maxResults?: number; labelIds?: string[]; spamTrash?: boolean },
): Promise<{ ids: string[]; nextPageToken?: string; resultSizeEstimate: number }> {
  const query = new URLSearchParams();
  query.set("maxResults", String(params.maxResults ?? 500));
  if (params.spamTrash !== false) query.set("includeSpamTrash", "true");
  for (const lid of params.labelIds ?? []) query.append("labelIds", lid);
  if (params.pageToken) query.set("pageToken", params.pageToken);

  const list = (await gmailFetch(accountId, `/messages?${query.toString()}`)) as {
    messages?: { id: string }[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  };

  return {
    ids: (list.messages ?? []).map((m) => m.id),
    nextPageToken: list.nextPageToken,
    resultSizeEstimate: list.resultSizeEstimate ?? 0,
  };
}

export async function searchMailPage(
  accountId: string,
  q: string,
  pageToken?: string,
  maxResults = 50,
): Promise<{
  refs: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}> {
  const query = new URLSearchParams({ q, maxResults: String(maxResults) });
  if (/\b(in|label):(spam|trash|anywhere)\b/i.test(q)) query.set("includeSpamTrash", "true");
  if (pageToken) query.set("pageToken", pageToken);
  const list = (await gmailFetch(accountId, `/messages?${query.toString()}`)) as {
    messages?: { id: string; threadId: string }[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  };
  return {
    refs: list.messages ?? [],
    nextPageToken: list.nextPageToken,
    resultSizeEstimate: list.resultSizeEstimate ?? 0,
  };
}

export interface GmailHistoryPage {
  historyId?: string;
  nextPageToken?: string;
  history?: {
    messagesAdded?: { message: { id: string } }[];
    messagesDeleted?: { message: { id: string } }[];
    labelsAdded?: { message: { id: string }; labelIds: string[] }[];
    labelsRemoved?: { message: { id: string }; labelIds: string[] }[];
  }[];
}

export async function listHistory(
  accountId: string,
  startHistoryId: string,
  pageToken?: string,
): Promise<GmailHistoryPage> {
  const query = new URLSearchParams();
  query.set("startHistoryId", startHistoryId);
  query.set("maxResults", "500");
  if (pageToken) query.set("pageToken", pageToken);
  return (await gmailFetch(accountId, `/history?${query.toString()}`)) as GmailHistoryPage;
}

export async function watchMailbox(
  accountId: string,
  topicName: string,
): Promise<{ historyId: string; expiration: number }> {
  const data = (await gmailFetch(accountId, "/watch", {
    method: "POST",
    body: JSON.stringify({ topicName }),
  })) as { historyId?: string; expiration?: string };
  return { historyId: data.historyId ?? "", expiration: Number(data.expiration ?? 0) };
}

export function isHistoryExpiredError(err: unknown): boolean {
  return err instanceof GmailApiError && err.status === 404;
}

interface MimePart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: MimePart[];
}

function decodeBase64url(data: string): string {
  return utf8Decode(fromBase64(data));
}

function walkParts(
  parts: MimePart[],
  result: {
    bodyHtml: string | null;
    bodyText: string | null;
    attachments: {
      id: string;
      filename: string;
      mimeType: string;
      size: number;
      contentId?: string;
    }[];
  },
): void {
  for (const part of parts) {
    const mimeType = part.mimeType ?? "";

    if (part.filename && part.body?.attachmentId) {
      result.attachments.push({
        id: part.body.attachmentId,
        filename: part.filename,
        mimeType,
        size: part.body.size ?? 0,
        contentId:
          getHeaderValue(part.headers ?? [], "Content-ID").replace(/^<|>$/g, "") || undefined,
      });
      continue;
    }

    if (mimeType === "text/html" && result.bodyHtml === null && part.body?.data) {
      result.bodyHtml = decodeBase64url(part.body.data);
    } else if (mimeType === "text/plain" && result.bodyText === null && part.body?.data) {
      result.bodyText = decodeBase64url(part.body.data);
    }

    if (part.parts?.length) {
      walkParts(part.parts, result);
    }
  }
}

interface RawMessageFull extends RawMessageMetadata {
  payload?: RawMessageMetadata["payload"] & {
    body?: { data?: string };
    parts?: MimePart[];
    mimeType?: string;
  };
}

export async function getMessage(accountId: string, messageId: string): Promise<MessageDetail> {
  return detailOf(
    (await gmailFetch(accountId, `/messages/${messageId}?format=full`)) as RawMessageFull,
  );
}

/**
 * Every message of a thread, whole: one threads.get (40 units) where each
 * message on its own costs 20, so it's cheaper from two messages up.
 */
export async function getThread(accountId: string, threadId: string): Promise<MessageDetail[]> {
  const thread = (await gmailFetch(accountId, `/threads/${threadId}?format=full`)) as {
    messages?: RawMessageFull[];
  };
  return (thread.messages ?? []).map(detailOf);
}

function detailOf(msg: RawMessageFull): MessageDetail {
  const summary = mapMessageSummary(msg);
  const headers = msg.payload?.headers ?? [];

  const bodyResult: {
    bodyHtml: string | null;
    bodyText: string | null;
    attachments: {
      id: string;
      filename: string;
      mimeType: string;
      size: number;
      contentId?: string;
    }[];
  } = { bodyHtml: null, bodyText: null, attachments: [] };

  const payload = msg.payload;
  if (payload) {
    const topMime = payload.mimeType ?? "";
    if (topMime === "text/html" && payload.body?.data) {
      bodyResult.bodyHtml = decodeBase64url(payload.body.data);
    } else if (topMime === "text/plain" && payload.body?.data) {
      bodyResult.bodyText = decodeBase64url(payload.body.data);
    }

    if (payload.parts?.length) {
      walkParts(payload.parts, bodyResult);
    }
  }

  return {
    ...summary,
    cc: getHeaderValue(headers, "Cc") || undefined,
    bcc: getHeaderValue(headers, "Bcc") || undefined,
    bodyHtml: bodyResult.bodyHtml,
    bodyText: bodyResult.bodyText,
    hasAttachments: bodyResult.attachments.length > 0,
    attachments: bodyResult.attachments,
  };
}

export async function modifyMessage(
  accountId: string,
  messageId: string,
  params: { addLabelIds?: string[]; removeLabelIds?: string[] },
): Promise<{ ok: true }> {
  await gmailFetch(accountId, `/messages/${messageId}/modify`, {
    method: "POST",
    body: JSON.stringify({
      addLabelIds: params.addLabelIds ?? [],
      removeLabelIds: params.removeLabelIds ?? [],
    }),
  });
  return { ok: true };
}

export async function trashMessage(accountId: string, messageId: string): Promise<{ ok: true }> {
  await gmailFetch(accountId, `/messages/${messageId}/trash`, { method: "POST" });
  return { ok: true };
}

export async function modifyThread(
  accountId: string,
  threadId: string,
  params: { addLabelIds?: string[]; removeLabelIds?: string[] },
): Promise<{ ok: true }> {
  await gmailFetch(accountId, `/threads/${threadId}/modify`, {
    method: "POST",
    body: JSON.stringify({
      addLabelIds: params.addLabelIds ?? [],
      removeLabelIds: params.removeLabelIds ?? [],
    }),
  });
  return { ok: true };
}

export async function trashThread(accountId: string, threadId: string): Promise<{ ok: true }> {
  await gmailFetch(accountId, `/threads/${threadId}/trash`, { method: "POST" });
  return { ok: true };
}

/** Restores a trashed thread and returns fresh summaries — trashing deleted the
    local rows, so the caller re-upserts them. */
export async function untrashThread(
  accountId: string,
  threadId: string,
): Promise<MessageSummary[]> {
  const res = (await gmailFetch(accountId, `/threads/${threadId}/untrash`, {
    method: "POST",
  })) as { messages?: { id: string }[] };
  const ids = (res.messages ?? []).map((m) => m.id);
  return ids.length > 0 ? fetchMetadataForIds(accountId, ids) : [];
}

/** PERMANENT bulk delete — one messages.batchDelete per 1000 ids. Gmail has
    no threads.batchDelete, so callers resolve threads to message ids first. */
export async function batchDeleteMessages(accountId: string, messageIds: string[]): Promise<void> {
  for (let i = 0; i < messageIds.length; i += 1000) {
    await gmailFetch(accountId, "/messages/batchDelete", {
      method: "POST",
      body: JSON.stringify({ ids: messageIds.slice(i, i + 1000) }),
    });
  }
}

export async function deleteThreadPermanently(
  accountId: string,
  threadId: string,
): Promise<{ ok: boolean }> {
  await gmailFetch(accountId, `/threads/${threadId}`, { method: "DELETE" });
  return { ok: true };
}

export async function untrashMessage(
  accountId: string,
  messageId: string,
): Promise<MessageSummary[]> {
  await gmailFetch(accountId, `/messages/${messageId}/untrash`, { method: "POST" });
  return fetchMetadataForIds(accountId, [messageId]);
}

export async function fetchReplyHeaders(
  accountId: string,
  messageId: string,
): Promise<{ messageIdHeader: string | null; referencesHeader: string | null }> {
  const msg = (await gmailFetch(
    accountId,
    `/messages/${messageId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`,
  )) as RawMessageMetadata;
  const headers = msg.payload?.headers ?? [];
  return {
    messageIdHeader: getHeaderValue(headers, "Message-ID") || null,
    referencesHeader: getHeaderValue(headers, "References") || null,
  };
}

function encodeBase64url(data: string): string {
  return toBase64Url(utf8Encode(data));
}

export async function sendMessage(
  accountId: string,
  params: OutgoingMail,
): Promise<{ ok: true; messageId?: string }> {
  const account = await getAccount(accountId);
  const fromAddress = account
    ? senderOf(account, params.from, { name: account.name }).from
    : accountId;

  const raw = buildMime({
    from: fromAddress,
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    body: params.body,
    bodyHtml: params.bodyHtml,
    inReplyTo: params.inReplyTo,
    references: params.references,
    attachments: params.attachments,
  });

  const payload: { raw: string; threadId?: string } = { raw: encodeBase64url(raw) };
  if (params.threadId) payload.threadId = params.threadId;

  const sent = (await gmailFetch(accountId, "/messages/send", {
    method: "POST",
    body: JSON.stringify(payload),
  })) as { id?: string };

  return { ok: true, messageId: sent.id };
}

export async function sendRawMessage(
  accountId: string,
  raw: string,
  threadId?: string,
): Promise<{ id?: string }> {
  const payload: { raw: string; threadId?: string } = { raw: encodeBase64url(raw) };
  if (threadId) payload.threadId = threadId;
  return (await gmailFetch(accountId, "/messages/send", {
    method: "POST",
    body: JSON.stringify(payload),
  })) as { id?: string };
}

export async function saveDraft(
  accountId: string,
  params: DraftSave,
): Promise<{ draftId: string; messageId?: string; threadId?: string }> {
  const account = await getAccount(accountId);
  const fromAddress = account
    ? senderOf(account, params.from, { name: account.name, draft: true }).from
    : accountId;

  const raw = buildMime({
    from: fromAddress,
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    body: params.body,
    bodyHtml: params.bodyHtml,
    inReplyTo: params.inReplyTo,
    references: params.references,
    attachments: params.attachments,
  });
  const message: { raw: string; threadId?: string } = { raw: encodeBase64url(raw) };
  if (params.threadId) message.threadId = params.threadId;

  const res = (await gmailFetch(
    accountId,
    params.draftId ? `/drafts/${params.draftId}` : "/drafts",
    {
      method: params.draftId ? "PUT" : "POST",
      body: JSON.stringify(params.draftId ? { id: params.draftId, message } : { message }),
    },
  )) as { id: string; message?: { id?: string; threadId?: string } };
  return {
    draftId: res.id,
    messageId: res.message?.id,
    threadId: res.message?.threadId,
  };
}

export async function getDraftVersion(accountId: string, draftId: string): Promise<string | null> {
  try {
    const res = (await gmailFetch(accountId, `/drafts/${draftId}?format=minimal`)) as {
      message?: { id?: string };
    };
    return res.message?.id ?? null;
  } catch (err) {
    if (err instanceof Error && err.message.includes("Gmail API error: 404")) return null;
    throw err;
  }
}

export async function listDraftIds(
  accountId: string,
): Promise<{ draftId: string; messageId: string; threadId?: string }[]> {
  const out: { draftId: string; messageId: string; threadId?: string }[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ maxResults: "100" });
    if (pageToken) query.set("pageToken", pageToken);
    const res = (await gmailFetch(accountId, `/drafts?${query.toString()}`)) as {
      drafts?: { id: string; message?: { id?: string; threadId?: string } }[];
      nextPageToken?: string;
    };
    for (const d of res.drafts ?? []) {
      if (d.message?.id)
        out.push({ draftId: d.id, messageId: d.message.id, threadId: d.message.threadId });
    }
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  return out;
}

/**
 * The draft id owning a message id, or null. Draft updates mint new message
 * ids, so a stale row can miss — then a draft in the same thread is the
 * best match.
 */
export async function findDraftIdByMessageId(
  accountId: string,
  messageId: string,
  threadId?: string,
): Promise<string | null> {
  const drafts = await listDraftIds(accountId);
  const own = drafts.find((d) => d.messageId === messageId);
  if (own) return own.draftId;
  const inThread = threadId ? drafts.filter((d) => d.threadId === threadId) : [];
  return inThread.length === 1 ? inThread[0]!.draftId : null;
}

export async function deleteDraft(
  accountId: string,
  draftId: string,
): Promise<{ ok: true; messageId?: string }> {
  let messageId: string | undefined;
  try {
    const draft = (await gmailFetch(accountId, `/drafts/${draftId}?format=minimal`)) as {
      message?: { id?: string };
    };
    messageId = draft.message?.id;
  } catch {
    // already gone
  }
  await gmailFetch(accountId, `/drafts/${draftId}`, { method: "DELETE" });
  return { ok: true, messageId };
}

export async function fetchAttachment(
  accountId: string,
  messageId: string,
  attachmentId: string,
): Promise<Uint8Array> {
  const data = (await gmailFetch(
    accountId,
    `/messages/${messageId}/attachments/${attachmentId}`,
  )) as { data?: string; size?: number };

  if (!data.data) {
    throw new Error(`Attachment ${attachmentId} returned no data.`);
  }
  return fromBase64(data.data);
}
