// IMAP avoids Gmail API quota during initial sync but lacks snippets and category labels; the API fills those later.

import { platform } from "../../platform.js";
import {
  connectImap,
  decodeMailboxName,
  type FetchedMessage,
  type SpecialUse,
} from "../../protocols/index.js";
import { getAccount } from "../../services/account-store.js";
import * as store from "../../services/mail-store.js";
import type { MessageSummary } from "../../types.js";
import type { SyncContext } from "../provider.js";
import { mapMessageSummary } from "./api.js";

const ROWS_PER_FETCH = 1000;
const HEADERS = ["From", "To", "Cc", "Subject", "Date", "Message-ID", "References"];

const SYSTEM_LABELS: Record<string, string> = {
  "\\Inbox": "INBOX",
  "\\Important": "IMPORTANT",
  "\\Sent": "SENT",
  "\\Draft": "DRAFT",
  "\\Drafts": "DRAFT",
  "\\Starred": "STARRED",
};

const FOLDERS: [SpecialUse, string | null][] = [
  ["\\All", null],
  ["\\Junk", "SPAM"],
  ["\\Trash", "TRASH"],
];

export async function fillOverImap(accountId: string, ctx: SyncContext): Promise<void> {
  const account = await getAccount(accountId);
  const client = await connectImap({
    host: "imap.gmail.com",
    port: 993,
    security: "tls",
    auth: {
      user: account?.email ?? accountId,
      accessToken: await platform().google.getAccessToken(accountId),
    },
  });
  try {
    const folders = await client.list();
    const userLabels = new Map(
      store
        .getLabels(accountId)
        .filter((l) => l.type === "user")
        .map((l) => [l.name, l.id]),
    );
    let synced = 0;
    let total = 0;
    ctx.update({ phase: "full", synced, total: null });
    for (const [use, folderLabel] of FOLDERS) {
      const folder = folders.find((f) => f.specialUse === use);
      if (!folder) {
        if (use === "\\All") throw new Error("Gmail shows no All Mail folder over IMAP.");
        continue;
      }
      await client.select(folder.path, { readOnly: true });
      const uids = (await client.search("ALL")).sort((a, b) => b - a);
      total += uids.length;
      ctx.update({ total });
      for (let i = 0; i < uids.length; i += ROWS_PER_FETCH) {
        const fetched = await client.fetch(uids.slice(i, i + ROWS_PER_FETCH), {
          flags: true,
          internalDate: true,
          headers: HEADERS,
          gmail: true,
        });
        const rows = fetched
          .map((m) => rowOf(m, folderLabel, userLabels))
          .filter((row): row is MessageSummary => row !== null);
        ctx.assertActive();
        const fresh = new Set(
          store.filterUnknownIds(
            accountId,
            rows.map((row) => row.id),
          ),
        );
        store.upsertMessages(
          accountId,
          rows.filter((row) => fresh.has(row.id)),
        );
        synced += rows.length;
        ctx.update({ synced });
        ctx.bumpRevision();
      }
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** The row the Gmail API would give for a message, but for the snippet and categories. */
function rowOf(
  m: FetchedMessage,
  folderLabel: string | null,
  userLabels: Map<string, string>,
): MessageSummary | null {
  if (m.gmailId === undefined) return null;
  const labelIds = new Set<string>();
  for (const raw of m.gmailLabels ?? []) {
    const id = SYSTEM_LABELS[raw] ?? userLabels.get(decodeMailboxName(raw));
    if (id) labelIds.add(id);
  }
  if (!m.flags?.includes("\\Seen")) labelIds.add("UNREAD");
  if (m.flags?.includes("\\Flagged")) labelIds.add("STARRED");
  if (folderLabel) labelIds.add(folderLabel);
  const headers = m.headers ?? {};
  return mapMessageSummary({
    id: m.gmailId.toString(16),
    threadId: (m.gmailThreadId ?? m.gmailId).toString(16),
    labelIds: [...labelIds],
    internalDate: String(m.internalDate?.getTime() ?? 0),
    payload: {
      headers: HEADERS.filter((name) => headers[name.toLowerCase()] !== undefined).map((name) => ({
        name,
        value: headers[name.toLowerCase()]!,
      })),
    },
  });
}
