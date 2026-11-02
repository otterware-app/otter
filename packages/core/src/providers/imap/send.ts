import { randomHex, utf8Encode } from "../../bytes.js";
import { logger } from "../../logger.js";
import { sendMail } from "../../protocols/index.js";
import { parseHeaders } from "../../protocols/imap/structures.js";
import { getAccount } from "../../services/account-store.js";
import * as store from "../../services/mail-store.js";
import {
  buildMime,
  senderOf,
  splitAddressList,
  type OutgoingMessage,
} from "../../services/outgoing.js";
import type { DraftSave, OutgoingMail } from "../provider.js";
import {
  accessFor,
  findByMessageId,
  isMessageIdHeader,
  noteSignInFailure,
  selectFolder,
  smtpOptions,
  tagFailure,
  withImap,
  type ImapAccess,
} from "./connection.js";
import { ensureFolder, foldersOf, messageId, parseMessageId } from "./folders.js";
import { referencesFor, threadIdOf } from "./messages.js";
import { expungeOnly } from "./writes.js";

const newMessageIdHeader = (email: string) =>
  `<${randomHex(16)}@${email.split("@")[1] || "otter.mail"}>`;

/** Date and Message-ID up front: the Gmail API adds them, SMTP servers may not. */
const withIds = (mime: string, messageIdHeader: string, date: Date) =>
  `Date: ${date.toUTCString()}\r\nMessage-ID: ${messageIdHeader}\r\n${mime}`;

function addressesIn(...lists: (string | undefined)[]): string[] {
  return lists
    .flatMap((list) => (list ? splitAddressList(list) : []))
    .map((entry) => (/<([^>]+)>\s*$/.exec(entry)?.[1] ?? entry).trim())
    .filter((address) => address.includes("@"));
}

/** Servers that put what you send in Sent themselves (appending would file it twice). */
const filesSentMail = (smtpHost: string) =>
  /(^|\.)(gmail|googlemail|office365|outlook|hotmail|live)\.com$/i.test(smtpHost);

async function sender(accountId: string, from?: string) {
  const account = await getAccount(accountId);
  if (!account) throw new Error(`Account not found: ${accountId}`);
  return senderOf(account, from);
}

async function submit(
  accountId: string,
  access: ImapAccess,
  from: string,
  to: string[],
  raw: string,
) {
  if (to.length === 0) throw new Error("Add at least one recipient.");
  try {
    await sendMail(smtpOptions(access), { from, to }, raw);
  } catch (err) {
    noteSignInFailure(accountId, access, err);
    throw tagFailure(err, access.settings.smtp.host, access.settings.username);
  }
}

/** Appends what was just sent to Sent; its id there, when the server says. Never throws: the mail went. */
async function fileSent(
  accountId: string,
  access: ImapAccess,
  raw: string,
): Promise<string | undefined> {
  if (filesSentMail(access.settings.smtp.host)) return undefined;
  try {
    return await withImap(
      accountId,
      async (client) => {
        const sent = await ensureFolder(accountId, client, "SENT", "Sent");
        const appended = await client.append(sent.path, raw, { flags: ["\\Seen"] });
        if (!appended) return undefined;
        const { uidValidity } = await selectFolder(client, sent.path);
        return messageId(uidValidity, appended.uid, sent.path);
      },
      { retry: false },
    );
  } catch (err) {
    logger.warn("imap", `Sent, but couldn't file it in Sent: ${String(err)}`);
    return undefined;
  }
}

export async function send(accountId: string, mail: OutgoingMail): Promise<{ messageId?: string }> {
  const access = await accessFor(accountId);
  const { email, from } = await sender(accountId, mail.from);
  const header = newMessageIdHeader(email);
  const date = new Date();
  const message: OutgoingMessage = {
    from,
    to: mail.to,
    cc: mail.cc,
    subject: mail.subject,
    body: mail.body,
    bodyHtml: mail.bodyHtml,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    attachments: mail.attachments,
  };
  await submit(
    accountId,
    access,
    email,
    addressesIn(mail.to, mail.cc, mail.bcc),
    withIds(buildMime(message), header, date),
  );
  const sent = withIds(buildMime({ ...message, bcc: mail.bcc }), header, date);
  return { messageId: await fileSent(accountId, access, sent) };
}

/** A header block without its Bcc (folded lines too): Bcc goes in the envelope only. */
function withoutBcc(head: string): string {
  const kept: string[] = [];
  let dropping = false;
  for (const line of head.split(/\r?\n/)) {
    if (!/^[ \t]/.test(line)) dropping = /^bcc\s*:/i.test(line);
    if (!dropping) kept.push(line);
  }
  return kept.join("\r\n");
}

export async function sendRaw(accountId: string, raw: string): Promise<void> {
  const access = await accessFor(accountId);
  const { email } = await sender(accountId);
  const split = /\r?\n\r?\n/.exec(raw);
  const head = split ? raw.slice(0, split.index) : raw;
  const headers = parseHeaders(utf8Encode(head));
  const hidden = withoutBcc(head) + raw.slice(head.length);
  const complete = headers["message-id"]
    ? hidden
    : withIds(hidden, newMessageIdHeader(email), new Date());
  await submit(
    accountId,
    access,
    email,
    addressesIn(headers.to, headers.cc, headers.bcc),
    complete,
  );
  await fileSent(accountId, access, complete);
}

/** Every version of a draft in Drafts, oldest first, and the folder's UIDVALIDITY. */
async function draftVersions(accountId: string, draftId: string) {
  return withImap(accountId, async (client) => {
    const drafts = (await foldersOf(accountId, client)).withRole("DRAFT");
    if (!drafts) return null;
    const mailbox = await selectFolder(client, drafts.path);
    const uids = await findByMessageId(client, draftId);
    return { path: drafts.path, uidValidity: mailbox.uidValidity, uids };
  });
}

export async function saveDraft(
  accountId: string,
  draft: DraftSave,
): Promise<{ draftId: string; messageId?: string; threadId?: string }> {
  const { email, from } = await sender(accountId, draft.from);
  const draftId = isMessageIdHeader(draft.draftId) ? draft.draftId : newMessageIdHeader(email);
  const root = referencesFor(draft.threadId);
  const references = root === draftId ? undefined : root;
  const raw = withIds(
    buildMime({
      from,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      body: draft.body,
      bodyHtml: draft.bodyHtml,
      attachments: draft.attachments,
      references,
    }),
    draftId,
    new Date(),
  );
  const saved = await withImap(
    accountId,
    async (client) => {
      const drafts = await ensureFolder(accountId, client, "DRAFT", "Drafts");
      const appended = await client.append(drafts.path, raw, { flags: ["\\Draft", "\\Seen"] });
      const mailbox = await selectFolder(client, drafts.path);
      const versions = await findByMessageId(client, draftId);
      const uid = appended?.uid ?? versions.at(-1);
      // The versions before this one go.
      const older = versions.filter((v) => v !== uid);
      if (older.length > 0) {
        await client.store(older, { add: ["\\Deleted"] });
        await expungeOnly(client, older);
      }
      return { path: drafts.path, uidValidity: mailbox.uidValidity, uid, older };
    },
    { retry: false },
  );
  for (const uid of saved.older) {
    store.deleteMessage(accountId, messageId(saved.uidValidity, uid, saved.path));
  }
  return {
    draftId,
    messageId: saved.uid ? messageId(saved.uidValidity, saved.uid, saved.path) : undefined,
    threadId: threadIdOf(references, null, draftId, draft.subject) ?? undefined,
  };
}

export async function deleteDraft(
  accountId: string,
  draftId: string,
): Promise<{ messageId?: string }> {
  const found = await draftVersions(accountId, draftId);
  if (!found || found.uids.length === 0) return {};
  await withImap(accountId, async (client) => {
    await selectFolder(client, found.path, found.uidValidity);
    await client.store(found.uids, { add: ["\\Deleted"] });
    await expungeOnly(client, found.uids);
  });
  const ids = found.uids.map((uid) => messageId(found.uidValidity, uid, found.path));
  for (const id of ids.slice(0, -1)) store.deleteMessage(accountId, id);
  return { messageId: ids.at(-1) };
}

export async function getDraftVersion(accountId: string, draftId: string): Promise<string | null> {
  const found = await draftVersions(accountId, draftId);
  const uid = found?.uids.at(-1);
  return found && uid !== undefined ? messageId(found.uidValidity, uid, found.path) : null;
}

export async function findDraftId(
  accountId: string,
  id: string,
  threadId?: string,
): Promise<string | null> {
  const isDraft = (m: string) => store.getMessageLabelIds(accountId, m)?.includes("DRAFT");
  const header = (m: string) => store.getStoredReplyHeaders(accountId, m).messageIdHeader;
  if (isDraft(id) && header(id)) return header(id);
  const inThread = threadId
    ? store.getThreadMessages(accountId, threadId).filter((m) => m.labelIds.includes("DRAFT"))
    : [];
  const last = inThread.at(-1);
  if (last && header(last.id)) return header(last.id);
  const { path, uid, uidValidity } = parseMessageId(id);
  return withImap(accountId, async (client) => {
    if ((await foldersOf(accountId, client)).withRole("DRAFT")?.path !== path) return null;
    const mailbox = await selectFolder(client, path);
    if (mailbox.uidValidity !== uidValidity) return null;
    const [message] = await client.fetch([uid], { envelope: true });
    return message?.envelope?.messageId ?? null;
  });
}
