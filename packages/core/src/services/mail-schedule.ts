import { landLabelChange, type MailSchedule } from "@otter-mail/contracts";
import { broadcast } from "../ipc.js";
import { platform } from "../platform.js";
import { capabilitiesOf, providerFor } from "../providers/index.js";
import { SendUncertain, type OutgoingMail, type ScheduleOutcome } from "../providers/provider.js";
import { getAccount } from "./account-store.js";
import * as store from "./mail-store.js";
import { updateDockBadge } from "./notifier.js";

// The backend is single-owner (a utility process, or the elected web worker).
// SQLite commits the claim before a send: a crash must never automatically resend it.
// `serverId`: the message a server holds and sends itself (Outlook).
let migrated = false;
function db() {
  const db = platform().database();
  db.exec(`CREATE TABLE IF NOT EXISTS mail_schedule (
    id TEXT PRIMARY KEY, accountId TEXT NOT NULL, kind TEXT NOT NULL,
    dueAt INTEGER NOT NULL, state TEXT NOT NULL, subject TEXT NOT NULL,
    threadId TEXT, payload TEXT, error TEXT, serverId TEXT
  )`);
  if (!migrated) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('mail_schedule')").all();
    if (!columns.some((c) => c.name === "serverId")) {
      db.exec("ALTER TABLE mail_schedule ADD COLUMN serverId TEXT");
    }
    migrated = true;
  }
  return db;
}

function mirror(accountId: string, messageId: string, add: string[], remove: string[]): void {
  const prior = store.getMessageLabelIds(accountId, messageId);
  if (!prior) return;
  const archiveFolder = capabilitiesOf(accountId)?.archiveFolder;
  const landed = landLabelChange(prior, add, remove, { archiveFolder });
  store.applyLabelChange(accountId, messageId, landed.add, landed.remove);
}

function changed() {
  broadcast("gmail:schedule-changed");
  broadcast("gmail:mail-changed");
  updateDockBadge();
}

export function futureTime(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(new Date(value).getTime()) ||
    value <= Date.now()
  ) {
    throw new Error("Choose a date and time in the future.");
  }
  return value;
}

export function listSchedules(): MailSchedule[] {
  const rows = db()
    .prepare(
      "SELECT id, accountId, kind, dueAt, state, subject, threadId, error, serverId FROM mail_schedule ORDER BY dueAt",
    )
    .all() as unknown as (Omit<MailSchedule, "onServer"> & { serverId: string | null })[];
  return rows.map(({ serverId, ...entry }) => ({ ...entry, onServer: serverId !== null }));
}

/** Queues a send; true when the server holds it (with `draftId`, that draft became it). */
export async function scheduleSend(
  accountId: string,
  mail: OutgoingMail,
  dueAt: number,
  draftId?: string,
): Promise<boolean> {
  futureTime(dueAt);
  const provider = providerFor(accountId);
  const held =
    provider.scheduleSend && (await provider.scheduleSend(accountId, mail, dueAt, draftId));
  db()
    .prepare("INSERT INTO mail_schedule VALUES (?, ?, 'send', ?, 'pending', ?, ?, ?, NULL, ?)")
    .run(
      crypto.randomUUID(),
      accountId,
      dueAt,
      mail.subject,
      mail.threadId ?? null,
      JSON.stringify(mail),
      held ? held.messageId : null,
    );
  changed();
  return !!held;
}

/** A send that may have gone out stays here for review, beside its draft (never a second one). */
export function holdForReview(accountId: string, mail: OutgoingMail, draftId?: string): void {
  db()
    .prepare("INSERT INTO mail_schedule VALUES (?, ?, 'send', ?, 'failed', ?, ?, ?, ?, NULL)")
    .run(
      crypto.randomUUID(),
      accountId,
      Date.now(),
      mail.subject,
      mail.threadId ?? null,
      JSON.stringify({ ...mail, draftId }),
      new SendUncertain().message,
    );
  changed();
}

function failed(id: string, error: unknown) {
  db()
    .prepare("UPDATE mail_schedule SET state = 'failed', error = ? WHERE id = ?")
    .run(error instanceof Error ? error.message : String(error), id);
  changed();
  broadcast("gmail:schedule-failed");
}

export async function snoozeThread(
  accountId: string,
  threadId: string,
  dueAt: number,
): Promise<void> {
  futureTime(dueAt);
  if (!(await getAccount(accountId))) throw new Error("Mailbox no longer exists.");
  if (
    listSchedules().some(
      (s) => s.accountId === accountId && s.threadId === threadId && s.kind === "snooze",
    )
  ) {
    throw new Error("This conversation is already snoozed. Manage it in Scheduled & snoozed.");
  }
  const rows = store.getThreadMessages(accountId, threadId);
  if (
    !rows.some((m) => m.labelIds.includes("INBOX")) ||
    rows.some((m) => m.labelIds.some((l) => l === "TRASH" || l === "SPAM"))
  ) {
    throw new Error("Only conversations in the inbox can be snoozed.");
  }
  const id = crypto.randomUUID();
  db()
    .prepare("INSERT INTO mail_schedule VALUES (?, ?, 'snooze', ?, 'running', ?, ?, ?, NULL, NULL)")
    .run(
      id,
      accountId,
      dueAt,
      rows[0].subject,
      threadId,
      JSON.stringify(rows.filter((m) => m.labelIds.includes("INBOX")).map((m) => m.id)),
    );
  changed();
  try {
    await providerFor(accountId).modifyThread(accountId, threadId, { removeLabelIds: ["INBOX"] });
    for (const m of store.getThreadMessages(accountId, threadId)) {
      mirror(accountId, m.id, [], ["INBOX"]);
    }
    db().prepare("UPDATE mail_schedule SET state = 'pending' WHERE id = ?").run(id);
    changed();
  } catch (error) {
    failed(id, error);
    throw error;
  }
}

async function wake(entry: MailSchedule): Promise<void> {
  const provider = providerFor(entry.accountId);
  // Read current metadata so trash/deletions elsewhere are never resurrected.
  const cached = store.getThreadMessages(entry.accountId, entry.threadId!);
  const fresh = await provider.getSummaries(
    entry.accountId,
    cached.map((m) => m.id),
  );
  store.upsertMessages(entry.accountId, fresh);
  const payload = db()
    .prepare("SELECT payload FROM mail_schedule WHERE id = ?")
    .get(entry.id)?.payload;
  const inboxIds = new Set<string>(payload ? (JSON.parse(String(payload)) as string[]) : []);
  for (const m of fresh) {
    if (m.labelIds.some((l) => ["TRASH", "SPAM", "DRAFT"].includes(l))) continue;
    if (m.labelIds.includes("SENT") && !inboxIds.has(m.id)) continue;
    await provider.modifyMessage(entry.accountId, m.id, { addLabelIds: ["INBOX"] });
    mirror(entry.accountId, m.id, ["INBOX"], []);
  }
}

function claim(id: string): MailSchedule {
  const entry = listSchedules().find((s) => s.id === id);
  if (!entry) throw new Error("This item is no longer scheduled.");
  if (
    !db()
      .prepare(
        "UPDATE mail_schedule SET state = 'running', error = NULL WHERE id = ? AND state != 'running'",
      )
      .run(id).changes
  ) {
    throw new Error("This item is already being processed.");
  }
  changed();
  return entry;
}

export async function cancelSchedule(id: string): Promise<ScheduleOutcome | undefined> {
  const entry = claim(id);
  let outcome: ScheduleOutcome | undefined;
  try {
    if (entry.kind === "send") {
      const row = db().prepare("SELECT payload, serverId FROM mail_schedule WHERE id = ?").get(id)!;
      const { draftId, ...mail } = JSON.parse(String(row.payload)) as OutgoingMail & {
        draftId?: string;
      };
      const provider = providerFor(entry.accountId);
      outcome = "cancelled";
      if (row.serverId != null) {
        outcome = await provider.cancelScheduledSend!(entry.accountId, String(row.serverId));
        db().prepare("UPDATE mail_schedule SET serverId = NULL WHERE id = ?").run(id);
      }
      const kept =
        draftId !== undefined &&
        (await provider.getDraftVersion(entry.accountId, draftId)) !== null;
      if (outcome === "cancelled" && !kept) {
        const draft = await provider.saveDraft(entry.accountId, mail);
        db().prepare("DELETE FROM mail_schedule WHERE id = ?").run(id);
        if (draft.messageId) {
          try {
            store.upsertMessages(
              entry.accountId,
              await provider.getSummaries(entry.accountId, [draft.messageId]),
            );
            store.setDraftId(entry.accountId, draft.messageId, draft.draftId);
          } catch {
            /* The draft exists; sync will bring it into the cache. */
          }
        }
      }
    } else {
      await wake(entry);
    }
    db().prepare("DELETE FROM mail_schedule WHERE id = ?").run(id);
    changed();
  } catch (error) {
    failed(id, error);
    throw error;
  }
  return outcome;
}

export function removeAccountSchedules(accountId: string): void {
  db().prepare("DELETE FROM mail_schedule WHERE accountId = ?").run(accountId);
  changed();
}

let processing = false;
export async function processSchedules(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    for (const item of listSchedules()) {
      if (item.state !== "pending" || item.dueAt > Date.now()) continue;
      if (item.onServer) {
        db().prepare("DELETE FROM mail_schedule WHERE id = ? AND state = 'pending'").run(item.id);
        changed();
        continue;
      }
      if (!(await getAccount(item.accountId))) {
        removeAccountSchedules(item.accountId);
        continue;
      }
      if (!listSchedules().some((s) => s.id === item.id && s.state === "pending")) continue;
      const entry = claim(item.id);
      try {
        if (entry.kind === "send") {
          const row = db().prepare("SELECT payload FROM mail_schedule WHERE id = ?").get(entry.id)!;
          const provider = providerFor(entry.accountId);
          const result = await provider.send(
            entry.accountId,
            JSON.parse(String(row.payload)) as OutgoingMail,
          );
          // Commit completion before best-effort cache work.
          db().prepare("DELETE FROM mail_schedule WHERE id = ?").run(entry.id);
          if (result.messageId) {
            try {
              store.upsertMessages(
                entry.accountId,
                await provider.getSummaries(entry.accountId, [result.messageId]),
              );
            } catch {
              /* Sync fills this in. */
            }
          }
        } else {
          await wake(entry);
          db().prepare("DELETE FROM mail_schedule WHERE id = ?").run(entry.id);
        }
        changed();
      } catch (error) {
        // A network failure may mean the server accepted a send. Keep its
        // contents for review, never retry an uncertain delivery automatically.
        failed(entry.id, error);
      }
    }
  } finally {
    processing = false;
  }
}

export function startMailSchedule(): void {
  db()
    .prepare("UPDATE mail_schedule SET state = 'failed', error = ? WHERE state = 'running'")
    .run(
      "Interrupted while processing. Check Sent before restoring a scheduled message to Drafts.",
    );
  const run = () => {
    void processSchedules().catch((error) =>
      platform().log("error", "mail-schedule", String(error)),
    );
  };
  run();
  setInterval(run, 15_000);
  platform().onResume(run);
}
