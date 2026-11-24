import { host } from "@otter/client/host";
import { mailApi } from "@otter/client/mail/api";
import type { ComposeAttachment } from "@otter/client/mail/types";
import type { DraftAnchor } from "@otter/client/mail/use-draft-autosave";
import { useOtterAccount } from "@otter/client/otter-account";
import { appFiles } from "@otter/mobile/files";
import { native } from "@otter/mobile/native";
import { useQuery } from "@tanstack/react-query";

import { fake } from "../core.ts";

export type DraftFields = { to: string; cc: string; bcc: string; subject: string; body: string };
export type RecoveryDraft = {
  id: string;
  account: string;
  sender: { id: string; address: string };
  fields: DraftFields;
  bodyHtml: string;
  anchor: DraftAnchor;
  reply?: { id: string; threadId: string };
  mode?: "reply" | "replyAll" | "forward";
  updated: number;
};
type LegacyFile = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  file?: string;
  original?: { id?: string };
  messageID?: string;
  sourceMailbox?: string;
};

type Record = RecoveryDraft & {
  attachments?: string;
  fingerprint?: string;
  legacyFiles?: LegacyFile[];
};

const filesFor = (owner: string) =>
  appFiles(`mail-draft-recovery/${fake ? "fake" : "live"}/user-${encodeURIComponent(owner)}`);
const recordFile = (id: string) => `drafts/${id}.json`;
const allowedId = (id: string) => /^[a-f\d-]{36}$/i.test(id);
const decoder = new TextDecoder();
let writing = Promise.resolve();

function serialize(work: () => Promise<void>) {
  const next = writing.then(work);
  writing = next.catch(() => {});
  return next;
}

async function read<T>(owner: string, path: string): Promise<T | null> {
  const bytes = await filesFor(owner).read(path);
  return bytes ? (JSON.parse(decoder.decode(bytes)) as T) : null;
}

export function retainDraft(owner: string, draft: RecoveryDraft, files: ComposeAttachment[]) {
  return serialize(async () => {
    const store = filesFor(owner);
    const before = await read<Record>(owner, recordFile(draft.id));
    const fingerprint = JSON.stringify(files.map(({ key, name, size }) => [key, name, size]));
    let attachments = fingerprint === before?.fingerprint ? before.attachments : undefined;
    if (!attachments && files.length) {
      attachments = `attachments/${draft.id}-${crypto.randomUUID()}.json`;
      await store.write(attachments, JSON.stringify(files));
    }
    await store.write(recordFile(draft.id), JSON.stringify({ ...draft, attachments, fingerprint }));
    if (before?.attachments && before.attachments !== attachments)
      await store.remove(before.attachments).catch(() => {});
  });
}

export function forgetDraft(owner: string, id: string) {
  return serialize(async () => {
    const store = filesFor(owner);
    const before = await read<Record>(owner, recordFile(id));
    await store.remove(recordFile(id));
    if (before?.attachments) await store.remove(before.attachments).catch(() => {});
  });
}

export async function loadRecovery(owner: string, id: string) {
  if (!allowedId(id)) return null;
  await writing;
  const record = await read<Record>(owner, recordFile(id));
  if (!record) return null;
  const files = record.attachments
    ? await read<ComposeAttachment[]>(owner, record.attachments)
    : await Promise.all(
        (record.legacyFiles ?? []).map(async (legacy): Promise<ComposeAttachment> => {
          const {
            id,
            filename: name,
            mimeType,
            size,
            file,
            original,
            messageID,
            sourceMailbox,
          } = legacy;
          if (file)
            return {
              key: id,
              name,
              mimeType,
              size,
              base64: await native.existingMailDraftAttachment(file, name),
            };
          if (!original?.id || !messageID)
            throw new Error("This draft’s attachment is no longer available.");
          const data = await mailApi.getAttachmentData({
            accountId: sourceMailbox ?? record.sender.id,
            messageId: messageID,
            attachmentId: original.id,
          });
          return { key: id, name, mimeType, base64: data.base64, size: data.size };
        }),
      );
  if (!files) throw new Error("This draft’s attachments couldn’t be recovered.");
  return { record, files };
}

export const recoveriesKey = (owner: string) => ["mail:recoveries", owner];

async function importSwiftDrafts(owner: string) {
  const imported = `mail:swift-draft-recovery:${owner}`;
  if (fake || owner === "local" || host().storage.get(imported)) return;
  await serialize(async () => {
    if (host().storage.get(imported)) return;
    const store = filesFor(owner);
    for (const entry of await native.existingMailDrafts(owner)) {
      let saved: {
        draft: DraftFields & {
          id: string;
          from: string;
          address?: string;
          threadID?: string;
          messageID?: string;
          files?: LegacyFile[];
        };
        updated: number;
      };
      try {
        saved = JSON.parse(entry) as typeof saved;
      } catch {
        continue;
      }
      const { draft, updated } = saved;
      if (!draft || !allowedId(draft.id) || typeof draft.from !== "string") continue;
      const path = recordFile(draft.id);
      if (await store.read(path)) continue;
      await store.write(
        path,
        JSON.stringify({
          id: draft.id,
          account: draft.address?.toLowerCase() ?? draft.from.toLowerCase(),
          sender: { id: draft.from.toLowerCase(), address: draft.address ?? draft.from },
          fields: {
            to: draft.to,
            cc: draft.cc,
            bcc: draft.bcc,
            subject: draft.subject,
            body: draft.body,
          },
          bodyHtml: "",
          anchor: {
            sessionKey: crypto.randomUUID(),
            draftId: null,
            messageId: draft.messageID ?? null,
            revision: null,
            threadId: draft.threadID,
          },
          ...(draft.threadID ? { mode: "reply" as const } : {}),
          updated: (updated + 978_307_200) * 1000,
          legacyFiles: draft.files,
        } satisfies Record),
      );
    }
    host().storage.set(imported, "true");
  });
}

export function useRecoveryOwner() {
  const account = useOtterAccount();
  return account ? (account.user?.id ?? "local") : null;
}

export function useRecoveries(owner: string | null, enabled: boolean) {
  return useQuery({
    queryKey: recoveriesKey(owner ?? ""),
    enabled: Boolean(owner && enabled),
    queryFn: async () => {
      await importSwiftDrafts(owner!);
      await writing;
      const paths = await filesFor(owner!).list("drafts");
      const entries = await Promise.all(
        paths.map(({ name }) => {
          const id = name.replace(/\.json$/, "");
          return allowedId(id) ? read<Record>(owner!, recordFile(id)).catch(() => null) : null;
        }),
      );
      return entries
        .flatMap((entry) => (entry ? [entry] : []))
        .sort((a, b) => b.updated - a.updated);
    },
  });
}
