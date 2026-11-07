import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { KEEP_MAILBOX, KEEP_RECENT } from "../../../platform.ts";
import { FakeStream, tagOf } from "../../../protocols/test/fake-stream.ts";
import * as accounts from "../../../services/account-store.ts";
import { getCoverage } from "../../../services/coverage.ts";
import { setImapPassword } from "../../../services/imap-passwords.ts";
import * as store from "../../../services/mail-store.ts";
import type { SyncContext } from "../../provider.ts";
import { imapProvider } from "../index.ts";
import { useNodePlatform } from "./node-platform.ts";

const platform = useNodePlatform();
const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Message = { uid: number; date: number; root?: number };
type Box = { flags: string; uidValidity: number; uidNext: number; messages: Message[] };

const quoted = (text: string) => `"${text}"`;
const imapDate = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()} ${d.toISOString().slice(11, 19)} +0000`;
};

function inSet(set: string, uid: number, top: number): boolean {
  return set.split(",").some((part) => {
    const [from, to = from] = part.split(":").map((n) => (n === "*" ? top : Number(n)));
    return uid >= Math.min(from!, to!) && uid <= Math.max(from!, to!);
  });
}

/** Just enough IMAP for a sync: folders, STATUS, SELECT, UID SEARCH (UID, SINCE) and UID FETCH. */
class PretendServer {
  readonly boxes = new Map<string, Box>();
  readonly commands: string[] = [];
  private selected: Box | null = null;
  private validity = 100;

  folder(path: string, flags = ""): void {
    this.boxes.set(path, { flags, uidValidity: ++this.validity, uidNext: 1, messages: [] });
  }

  /** With `root`, a reply in the conversation of the message with that UID. */
  deliver(path: string, date: number, root?: number): void {
    const box = this.boxes.get(path)!;
    box.messages.push({ uid: box.uidNext++, date, root });
  }

  connect = async () =>
    new FakeStream("* PREAUTH [CAPABILITY IMAP4rev1 UIDPLUS SPECIAL-USE] ready\r\n", (text) =>
      this.answer(text),
    );

  private answer(text: string): string {
    const tag = tagOf(text);
    const command = text.slice(tag.length + 1).trim();
    this.commands.push(command);
    const words = command.split(" ");
    const verb = words[0] === "UID" ? `UID ${words[1]}` : words[0];
    const path = () => /"([^"]*)"|(\S+)$/.exec(command.split(" ").slice(1).join(" "));
    switch (verb) {
      case "LIST":
        return [
          ...[...this.boxes].map(
            ([name, b]) => `* LIST (\\HasNoChildren${b.flags ? ` ${b.flags}` : ""}) "/" "${name}"`,
          ),
          `${tag} OK done\r\n`,
        ].join("\r\n");
      case "STATUS": {
        const name = /^STATUS "?([^"(]+?)"? \(/.exec(command)![1]!;
        const b = this.boxes.get(name)!;
        return `* STATUS "${name}" (MESSAGES ${b.messages.length} UIDNEXT ${b.uidNext} UIDVALIDITY ${b.uidValidity} UNSEEN 0)\r\n${tag} OK done\r\n`;
      }
      case "SELECT":
      case "EXAMINE": {
        const match = path()!;
        const b = (this.selected = this.boxes.get(match[1] ?? match[2]!)!);
        return `* ${b.messages.length} EXISTS\r\n* OK [UIDVALIDITY ${b.uidValidity}] ok\r\n* OK [UIDNEXT ${b.uidNext}] ok\r\n${tag} OK done\r\n`;
      }
      case "UID SEARCH": {
        const b = this.selected!;
        const uids = /UID (\S+)/.exec(command.slice("UID SEARCH".length))?.[1];
        const since = /SINCE (\d+)-(\w+)-(\d+)/.exec(command);
        const from = since ? Date.UTC(+since[3]!, MONTHS.indexOf(since[2]!), +since[1]!) : 0;
        const found = b.messages
          .filter((m) => !uids || inSet(uids, m.uid, b.uidNext - 1))
          .filter((m) => m.date >= from)
          .map((m) => m.uid);
        return `* SEARCH${found.map((uid) => ` ${uid}`).join("")}\r\n${tag} OK done\r\n`;
      }
      case "UID FETCH": {
        const b = this.selected!;
        const set = words[2]!;
        const items = command.slice(command.indexOf("(") + 1, command.lastIndexOf(")"));
        const lines = b.messages
          .filter((m) => inSet(set, m.uid, b.uidNext - 1))
          .map((m) => {
            const parts = [`UID ${m.uid}`, "FLAGS (\\Seen)"];
            if (items.includes("INTERNALDATE")) parts.push(`INTERNALDATE "${imapDate(m.date)}"`);
            if (items.includes("ENVELOPE")) {
              const subject = quoted(m.root ? `Re: Mail ${m.root}` : `Mail ${m.uid}`);
              const idOf = (uid: number) => quoted(`<${b.uidValidity}.${uid}@example.test>`);
              const inReplyTo = m.root ? idOf(m.root) : "NIL";
              parts.push(
                `ENVELOPE (${quoted(new Date(m.date).toUTCString())} ${subject} ` +
                  `((NIL NIL "bob" "example.test")) NIL NIL ((NIL NIL "me" "example.test")) NIL NIL ${inReplyTo} ${idOf(m.uid)})`,
              );
            }
            if (items.includes("BODYSTRUCTURE")) {
              parts.push('BODYSTRUCTURE ("TEXT" "PLAIN" NIL NIL NIL "7BIT" 3 1 NIL NIL NIL NIL)');
            }
            for (const [, section] of items.matchAll(/BODY\.PEEK\[([^\]]*)\]/g)) {
              const value = section!.startsWith("HEADER") ? "\r\n" : "hi!";
              const name = section!.startsWith("TEXT") ? "BODY[TEXT]<0>" : `BODY[${section}]`;
              parts.push(`${name} {${value.length}}\r\n${value}`);
            }
            return `* ${m.uid} FETCH (${parts.join(" ")})\r\n`;
          });
        return `${lines.join("")}${tag} OK done\r\n`;
      }
      case "LOGOUT":
        return `* BYE bye\r\n${tag} OK done\r\n`;
      default:
        return `${tag} OK done\r\n`;
    }
  }
}

let server: PretendServer;
platform.connect = async () => server.connect();
const ctx: SyncContext = {
  update: () => {},
  bumpRevision: () => {},
  assertActive: () => {},
  newMail: async () => {},
};
let counter = 0;
let accountId: string;

beforeEach(async () => {
  server = new PretendServer();
  server.folder("INBOX");
  server.folder("Sent", "\\Sent");
  const now = Date.now();
  // A message a day, the newest today.
  for (let day = 29; day >= 0; day--) server.deliver("INBOX", now - day * DAY);
  for (let day = 19; day >= 0; day--) server.deliver("Sent", now - day * DAY - DAY / 2);
  accountId = `me${++counter}@example.test`;
  await accounts.addAccount({
    id: accountId,
    email: accountId,
    name: "Me",
    provider: "imap",
    imap: {
      username: accountId,
      imap: { host: "imap.example.test", port: 993, security: "tls" },
      smtp: { host: "smtp.example.test", port: 465, security: "tls" },
    },
  });
  await setImapPassword(accountId, "secret");
});

afterEach(async () => {
  platform.syncPolicy = { ...KEEP_MAILBOX, bodyPrefetch: false };
  delete platform.inForeground;
  for (const account of await accounts.listAccounts()) {
    await imapProvider.removeAccount(account.id);
    await accounts.removeAccount(account.id);
  }
});

const cached = (label: string) => store.countMessagesForLabel(accountId, label);

describe("IMAP sync with a window", () => {
  it("reads every message without one, and is then fully synced", async () => {
    await imapProvider.sync(accountId, ctx);
    expect([cached("INBOX"), cached("SENT")]).toEqual([30, 20]);
    expect(store.getSyncState(accountId).fullSyncDone).toBe(true);
    expect(getCoverage(accountId)).toBeNull();
  });

  it("reads each folder's window, the inbox's newest `minThreads` at least, and never counts as fully synced", async () => {
    platform.syncPolicy = { ...KEEP_RECENT, initialCoverage: { days: 10, minThreads: 15 } };
    await imapProvider.sync(accountId, ctx);
    expect(cached("INBOX")).toBe(15);
    // SINCE goes by the date: the eleventh day back is in or out with the time of day.
    expect(cached("SENT")).toBeGreaterThanOrEqual(10);
    expect(cached("SENT")).toBeLessThanOrEqual(11);
    expect(store.getSyncState(accountId).fullSyncDone).toBe(false);
    expect(getCoverage(accountId)).toMatchObject({ done: true });

    server.commands.length = 0;
    server.deliver("INBOX", Date.now());
    await imapProvider.sync(accountId, ctx);
    expect(cached("INBOX")).toBe(16);
    expect(server.commands.filter((c) => c.startsWith("UID FETCH")).join("\n")).not.toMatch(
      /UID FETCH 1[,:]/,
    );
  });

  it("keeps the inbox's newest `minThreads` conversations, not messages", async () => {
    server.folder("INBOX");
    const now = Date.now();
    // Past the window, two messages a conversation.
    for (let day = 29; day >= 0; day--) {
      const replying = day >= 10 && day % 2 === 0;
      server.deliver("INBOX", now - day * DAY, replying ? 30 - day - 1 : undefined);
    }
    platform.syncPolicy = { ...KEEP_RECENT, initialCoverage: { days: 10, minThreads: 15 } };
    await imapProvider.sync(accountId, ctx);
    expect(store.countThreadsForLabel(accountId, "INBOX")).toBe(15);
  });

  it("stops filling when the app goes behind, and goes on in front", async () => {
    platform.syncPolicy = { ...KEEP_RECENT, initialCoverage: { days: 10, minThreads: 15 } };
    const fetches = () => server.commands.filter((c) => /^UID FETCH .*ENVELOPE/.test(c));
    // The window's page of the inbox, then the app goes behind.
    platform.inForeground = () => fetches().length === 0;
    await imapProvider.sync(accountId, ctx);
    expect(fetches()).toHaveLength(1);
    expect(cached("INBOX")).toBeLessThan(15);
    expect(cached("SENT")).toBe(0);
    expect(getCoverage(accountId)).toMatchObject({ done: false });

    platform.inForeground = () => true;
    await imapProvider.sync(accountId, ctx);
    expect(cached("INBOX")).toBe(15);
    expect(cached("SENT")).toBeGreaterThanOrEqual(10);
    expect(getCoverage(accountId)).toMatchObject({ done: true });
  });

  it("goes on below the window once the policy widens", async () => {
    platform.syncPolicy = { ...KEEP_RECENT, initialCoverage: { days: 10, minThreads: 15 } };
    await imapProvider.sync(accountId, ctx);
    platform.syncPolicy = { ...KEEP_MAILBOX, bodyPrefetch: false };
    await imapProvider.sync(accountId, ctx);
    expect([cached("INBOX"), cached("SENT")]).toEqual([30, 20]);
    expect(store.getSyncState(accountId).fullSyncDone).toBe(true);
  });

  it("fills a widened window anew", async () => {
    platform.syncPolicy = { ...KEEP_RECENT, initialCoverage: { days: 10, minThreads: 15 } };
    await imapProvider.sync(accountId, ctx);
    platform.syncPolicy = { ...KEEP_RECENT, initialCoverage: { days: 25, minThreads: 15 } };
    await imapProvider.sync(accountId, ctx);
    expect(cached("INBOX")).toBeGreaterThanOrEqual(25);
    expect(cached("INBOX")).toBeLessThanOrEqual(26);
    expect(cached("SENT")).toBe(20);
    expect(getCoverage(accountId)).toMatchObject({ done: true, window: { days: 25 } });
  });

  it("behind the app, catches up the inbox only, and no further than a bounded delta", async () => {
    platform.syncPolicy = { ...KEEP_RECENT, initialCoverage: { days: 10, minThreads: 15 } };
    await imapProvider.sync(accountId, ctx);
    const sent = cached("SENT");
    platform.inForeground = () => false;
    server.deliver("INBOX", Date.now());
    server.deliver("Sent", Date.now());
    server.commands.length = 0;
    await imapProvider.sync(accountId, ctx);
    expect([cached("INBOX"), cached("SENT")]).toEqual([16, sent]);
    expect(server.commands.filter((c) => c.includes("Sent") && !c.startsWith("STATUS"))).toEqual(
      [],
    );
    expect(server.commands.some((c) => /^(SELECT|EXAMINE) "?INBOX/.test(c))).toBe(true);

    for (let i = 0; i < 51; i++) server.deliver("INBOX", Date.now());
    await imapProvider.sync(accountId, ctx);
    expect(cached("INBOX")).toBe(16);

    platform.inForeground = () => true;
    await imapProvider.sync(accountId, ctx);
    expect([cached("INBOX"), cached("SENT")]).toEqual([67, sent + 1]);
  });
});
