import {
  broadcast,
  getAttachmentBytes,
  getOtterUser,
  handle,
  logger,
  readJson,
  toBase64,
  writeJson,
  type MailAccount,
} from "@otter-mail/core";
import type { WorkerHost } from "@otter-mail/mobile-worker";

import { call } from "./call";
import { keepCopy, localCopySummaries, type LocalCopy } from "./local-drafts";
import {
  importRecoveredDrafts,
  parseRecoveredDraft,
  recoveryNamespace,
  saveDraftParams,
  type RecoveryIO,
  type SwiftRecoveredDraft,
} from "./recovered-drafts";

/** Where apps/ios kept them: Application Support itself, beside core's data directory. */
const SWIFT_SUPPORT = "..";
const DONE_FILE = "recovered-drafts.json";
const COPIES_FILE = "local-drafts.json";
export const LOCAL_COPIES_CHANGED = "drafts:localCopiesChanged";

/**
 * `drafts:importRecovered`: apps/ios's recovery copies for the Otter account
 * signed in (the demo's in the made-up mailbox, as apps/ios's demo kept its
 * own), each saved as a draft once.
 */
export function registerRecoveryHandlers(host: WorkerHost, demo: boolean): void {
  const bytes = (path: string) => {
    const buffer = host.readFile(path);
    return buffer ? new Uint8Array(buffer) : null;
  };
  let running: Promise<unknown> | null = null;

  const legacyIO = (): RecoveryIO | null => {
    const user = getOtterUser();
    if (!demo && !user) return null;
    const namespace = demo ? "demo" : recoveryNamespace(user!.id, toBase64);
    const directory = `${SWIFT_SUPPORT}/draft-recovery/${namespace}`;
    return {
      async entries() {
        return host
          .listFiles(directory)
          .filter((f) => f.name.endsWith(".json"))
          .flatMap((f) => {
            const data = bytes(`${directory}/${f.name}`);
            return data ? [{ name: f.name, text: new TextDecoder().decode(data) }] : [];
          });
      },
      localFile: async (file, filename) =>
        bytes(`${SWIFT_SUPPORT}/draft-files/${file}/${filename}`),
      originalFile: getAttachmentBytes,
      async signedIn() {
        const accounts = await call<MailAccount[]>("gmail:listAccounts");
        return new Map(
          accounts.filter((a) => !a.signedOut).map((a) => [a.email.toLowerCase(), a.id]),
        );
      },
      saveDraft: (params) => call("gmail:saveDraft", params),
      done: async () => new Set((await readJson<string[]>(DONE_FILE)) ?? []),
      async markDone(ids) {
        const done = (await readJson<string[]>(DONE_FILE)) ?? [];
        await writeJson(DONE_FILE, [...new Set([...done, ...ids])]);
      },
    };
  };
  const legacyEntries = async (io: RecoveryIO | null): Promise<SwiftRecoveredDraft[]> =>
    io
      ? (await io.entries())
          .map((e) => parseRecoveredDraft(e.text))
          .filter((e): e is SwiftRecoveredDraft => e !== null)
      : [];
  const copies = async () => (await readJson<LocalCopy[]>(COPIES_FILE)) ?? [];
  const changed = () => broadcast(LOCAL_COPIES_CHANGED, {});

  handle("drafts:localCopies", async (params: unknown) => {
    const accountId = String((params as { accountId?: unknown })?.accountId ?? "");
    const accounts = await call<MailAccount[]>("gmail:listAccounts");
    const email = accounts.find((a) => a.id === accountId)?.email ?? accountId;
    const io = legacyIO();
    return localCopySummaries(
      accountId,
      email,
      await copies(),
      await legacyEntries(io),
      io ? await io.done() : new Set(),
    );
  });

  /** One copy, as the composer opens it (apps/ios's with its attachments read in). */
  handle("drafts:getLocalCopy", async (params: unknown) => {
    const { accountId, id } = params as { accountId: string; id: string };
    const own = (await copies()).find((c) => c.id === id);
    if (own) return own;
    const io = legacyIO();
    const entry = (await legacyEntries(io)).find((e) => e.draft.id === id);
    if (!io || !entry) return null;
    const params_ = await saveDraftParams(accountId, entry.draft, io, toBase64);
    return { ...params_, id, updated: Date.now() } as unknown as LocalCopy;
  });

  handle("drafts:keepLocalCopy", async (params: unknown) => {
    const copy = params as LocalCopy;
    await writeJson(COPIES_FILE, keepCopy(await copies(), { ...copy, updated: Date.now() }));
    changed();
    return { ok: true };
  });

  /** apps/ios's copy is left where it was, and never imported. */
  handle("drafts:deleteLocalCopy", async (params: unknown) => {
    const id = String((params as { id?: unknown })?.id ?? "");
    await writeJson(
      COPIES_FILE,
      (await copies()).filter((c) => c.id !== id),
    );
    await legacyIO()?.markDone([id]);
    changed();
    return { ok: true };
  });

  handle("drafts:importRecovered", () => {
    const io = legacyIO();
    if (!io) return { imported: [], waiting: [], failed: [] };
    running ??= importRecoveredDrafts(io, toBase64)
      .then((result) => {
        if (result.imported.length || result.failed.length || result.waiting.length)
          logger.info("drafts", `recovered drafts ${JSON.stringify(result)}`);
        return result;
      })
      .finally(() => (running = null));
    return running;
  });
}
