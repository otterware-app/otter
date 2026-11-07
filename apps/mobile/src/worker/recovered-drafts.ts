import type { ComposeAttachment } from "@otter-mail/core";

/**
 * apps/ios kept each unsent message as a recovery copy: a JSON
 * `RecoveredDraft` per draft in Application Support/draft-recovery/<namespace>/,
 * its attachments in Application Support/draft-files/<file>/<filename>
 * (DraftFiles.swift). Upgrading to this app, each becomes a draft on its
 * mailbox, once; the originals stay where they are.
 */

/** DraftFiles.swift's DraftFile (Codable). */
export type SwiftDraftFile = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** The folder of a file added on the phone. */
  file?: string;
  /** A forwarded message's attachment, still on the server. */
  original?: { id?: string; filename: string; mimeType: string; size: number };
  messageID?: string;
  sourceMailbox?: string;
};

/** Draft.swift's Draft (Codable): `from` is the mailbox, `address` its alias when another. */
export type SwiftDraft = {
  id: string;
  from: string;
  address?: string;
  to: string;
  cc: string;
  bcc: string;
  files: SwiftDraftFile[];
  subject: string;
  body: string;
  threadID?: string;
  messageID?: string;
};

/** `updated`: Foundation's default Date encoding, seconds since 2001-01-01 (oldest import first). */
export type SwiftRecoveredDraft = { draft: SwiftDraft; updated: number };

export function parseRecoveredDraft(text: string): SwiftRecoveredDraft | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const entry = value as Partial<SwiftRecoveredDraft> | null;
  const draft = entry?.draft as Partial<SwiftDraft> | undefined;
  if (typeof draft?.id !== "string" || typeof draft.from !== "string" || !draft.from) return null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    updated: typeof entry?.updated === "number" ? entry.updated : 0,
    draft: {
      id: draft.id,
      from: draft.from,
      ...(typeof draft.address === "string" ? { address: draft.address } : {}),
      to: str(draft.to),
      cc: str(draft.cc),
      bcc: str(draft.bcc),
      subject: str(draft.subject),
      body: str(draft.body),
      files: Array.isArray(draft.files) ? draft.files : [],
      ...(typeof draft.threadID === "string" ? { threadID: draft.threadID } : {}),
      ...(typeof draft.messageID === "string" ? { messageID: draft.messageID } : {}),
    },
  };
}

const isEmpty = (draft: SwiftDraft) =>
  draft.files.length === 0 &&
  [draft.to, draft.cc, draft.bcc, draft.subject, draft.body].every((v) => !v.trim());

/** Session.swift's recovery namespace: the Otter account's id, base64 with `/` as `_`. */
export function recoveryNamespace(userId: string, toBase64: (bytes: Uint8Array) => string): string {
  return toBase64(new TextEncoder().encode(userId)).replaceAll("/", "_");
}

export type RecoveryIO = {
  /** The recovery JSON files' contents, by name. */
  entries(): Promise<{ name: string; text: string }[]>;
  /** A file added on the phone: draft-files/<file>/<filename>. */
  localFile(file: string, filename: string): Promise<Uint8Array | null>;
  /** A forwarded attachment, from the mailbox it came from. */
  originalFile(accountId: string, messageId: string, attachmentId: string): Promise<Uint8Array>;
  /** Mailboxes signed in here: their ids by address, lower-cased. */
  signedIn(): Promise<Map<string, string>>;
  saveDraft(params: Record<string, unknown>): Promise<{ draftId?: string }>;
  done(): Promise<Set<string>>;
  markDone(ids: string[]): Promise<void>;
};

export type ImportResult = { imported: string[]; waiting: string[]; failed: string[] };

export async function saveDraftParams(
  accountId: string,
  draft: SwiftDraft,
  io: Pick<RecoveryIO, "localFile" | "originalFile">,
  toBase64: (bytes: Uint8Array) => string,
): Promise<Record<string, unknown>> {
  const attachments: ComposeAttachment[] = [];
  for (const file of draft.files) {
    const bytes = file.file
      ? await io.localFile(file.file, file.filename)
      : file.original?.id && file.messageID
        ? await io.originalFile(file.sourceMailbox ?? accountId, file.messageID, file.original.id)
        : null;
    if (!bytes) throw new Error(`The attachment ${file.filename} is missing.`);
    attachments.push({
      name: file.filename,
      mimeType: file.mimeType,
      size: bytes.byteLength,
      base64: toBase64(bytes),
    });
  }
  const address = draft.address?.toLowerCase();
  return {
    accountId,
    ...(address && address !== draft.from.toLowerCase() ? { from: address } : {}),
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    body: draft.body,
    ...(draft.threadID ? { threadId: draft.threadID } : {}),
    ...(attachments.length ? { attachments } : {}),
  };
}

/**
 * Saves each recovery not imported yet as a draft of its own. One that was
 * editing a draft never replaces it: the file carries no revision, so a
 * newer edit of that draft elsewhere (an Outlook draft keeps its id) can't be
 * told apart. A mailbox not signed in here waits for a later launch.
 */
export async function importRecoveredDrafts(
  io: RecoveryIO,
  toBase64: (bytes: Uint8Array) => string,
): Promise<ImportResult> {
  const result: ImportResult = { imported: [], waiting: [], failed: [] };
  const done = await io.done();
  const entries = (await io.entries())
    .map((e) => parseRecoveredDraft(e.text))
    .filter((e): e is SwiftRecoveredDraft => e !== null && !done.has(e.draft.id))
    .sort((a, b) => a.updated - b.updated);
  if (!entries.length) return result;
  const signedIn = await io.signedIn();
  const finished: string[] = [];
  for (const { draft } of entries) {
    if (isEmpty(draft)) {
      finished.push(draft.id);
      continue;
    }
    const accountId = signedIn.get(draft.from.toLowerCase());
    if (!accountId) {
      result.waiting.push(draft.id);
      continue;
    }
    try {
      const saved = await io.saveDraft(await saveDraftParams(accountId, draft, io, toBase64));
      if (!saved.draftId) throw new Error("The draft wasn't saved.");
      result.imported.push(draft.id);
      finished.push(draft.id);
    } catch {
      result.failed.push(draft.id);
    }
  }
  if (finished.length) await io.markDone(finished);
  return result;
}
