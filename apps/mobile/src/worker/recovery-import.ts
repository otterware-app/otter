import {
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
import { importRecoveredDrafts, recoveryNamespace, type RecoveryIO } from "./recovered-drafts";

/** Where the Swift app kept them: Application Support itself, beside core's data directory. */
const SWIFT_SUPPORT = "..";
const DONE_FILE = "recovered-drafts.json";

/**
 * `drafts:importRecovered`: the Swift app's recovery copies for the Otter account
 * signed in (the demo's in the made-up mailbox, as the Swift app's demo kept its
 * own), each saved as a draft once.
 */
export function registerRecoveryHandlers(host: WorkerHost, demo: boolean): void {
  const bytes = (path: string) => {
    const buffer = host.readFile(path);
    return buffer ? new Uint8Array(buffer) : null;
  };
  let running: Promise<unknown> | null = null;

  handle("drafts:importRecovered", () => {
    const user = getOtterUser();
    if (!demo && !user) return { imported: [], waiting: [], failed: [] };
    const namespace = demo ? "demo" : recoveryNamespace(user!.id, toBase64);
    const directory = `${SWIFT_SUPPORT}/draft-recovery/${namespace}`;
    const io: RecoveryIO = {
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
