import { KEEP_MAILBOX, KEEP_RECENT, type SyncPolicy } from "../../platform.ts";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Platform, SqlDatabase } from "../../platform.ts";
import { FakeStream, tagOf } from "../../protocols/test/fake-stream.ts";
import type { MailAccount } from "../../types.ts";

const GMAIL = "gmail.googleapis.com";
const account: MailAccount = { id: "me@gmail.test", email: "me@gmail.test", name: "Me" };

type Mail = {
  id: string;
  threadId: string;
  labelIds: string[];
  date: number;
  subject: string;
  header?: string;
};
type Ref = { message: { id: string; threadId: string; labelIds: string[] } };
type HistoryEntry = {
  id: string;
  messagesAdded?: Ref[];
  messagesDeleted?: Ref[];
  labelsAdded?: (Ref & { labelIds: string[] })[];
  labelsRemoved?: (Ref & { labelIds: string[] })[];
};

const SYSTEM_LABELS = ["INBOX", "UNREAD", "STARRED", "SENT", "SPAM", "TRASH", "DRAFT"];

let labels: { id: string; name: string; type: "system" | "user" }[];
let mail: Map<string, Mail>;
let historyId: number;
let history: HistoryEntry[];
let historyFloor: number;
let fetches: { id: string; format: string }[];
let threadFetches: string[];
let listings: (string | null)[];
let pageSize: number;
let modifies: { threadId: string; body: unknown }[];
let refuse: Set<string>;
let deletedForever: string[];
let drafts: Map<string, string>;
let posted: string[];
let raws: string[];
/** Answers the next matching request with `status`; with `apply`, after doing it anyway. */
let failures: { method: string; path: string; status: number; apply?: boolean }[];
/** While set, the first fetch of each of `ids` answers as of the request, but only once `until` resolves. */
let hold: { ids: string[]; until: Promise<void> } | null;
const held = new Set<string>();

const ref = (m: Mail): Ref => ({
  message: { id: m.id, threadId: m.threadId, labelIds: [...m.labelIds] },
});

function deliver(id: string, labelIds: string[], date = Date.now(), threadId = id): Mail {
  const m: Mail = { id, threadId, labelIds, date, subject: `Subject ${id}` };
  mail.set(id, m);
  history.push({ id: String(++historyId), messagesAdded: [ref(m)] });
  return m;
}

function relabel(id: string, add: string[], remove: string[]): void {
  const m = mail.get(id)!;
  m.labelIds = [...m.labelIds.filter((l) => !remove.includes(l)), ...add];
  history.push({
    id: String(++historyId),
    ...(add.length ? { labelsAdded: [{ ...ref(m), labelIds: add }] } : {}),
    ...(remove.length ? { labelsRemoved: [{ ...ref(m), labelIds: remove }] } : {}),
  });
}

function remove(id: string): void {
  const m = mail.get(id)!;
  mail.delete(id);
  history.push({ id: String(++historyId), messagesDeleted: [ref(m)] });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const base64url = (text: string) => Buffer.from(text).toString("base64url");

function resource(m: Mail, format: string) {
  const headers = [
    { name: "From", value: "Sender <sender@example.test>" },
    { name: "Subject", value: m.subject },
    { name: "Message-ID", value: `<${m.id}@example.test>` },
  ];
  return {
    id: m.id,
    threadId: m.threadId,
    labelIds: [...m.labelIds],
    internalDate: String(m.date),
    snippet: m.subject,
    payload:
      format === "full"
        ? { mimeType: "text/plain", headers, body: { data: base64url(`Body of ${m.id}`) } }
        : { headers },
  };
}

function newMessage(raw: string | undefined, labelIds: string[], threadId?: string): Mail {
  const text = raw ? Buffer.from(raw, "base64url").toString() : "";
  const id = `m${++historyId}`;
  const m = deliver(id, labelIds, Date.now(), threadId ?? id);
  m.subject = /^Subject: (.*)$/m.exec(text)?.[1] ?? "";
  m.header = /^Message-ID: (.*)$/m.exec(text)?.[1]?.trim();
  raws.push(text);
  return m;
}

function draftsApi(method: string, path: string, body: unknown): Response | null {
  const message = (body as { message?: { raw?: string; threadId?: string } })?.message;
  if (path === "/drafts" && method === "POST") {
    const m = newMessage(message?.raw, ["DRAFT"], message?.threadId);
    const id = `d${historyId}`;
    drafts.set(id, m.id);
    return json({ id, message: { id: m.id, threadId: m.threadId } });
  }
  if (path === "/drafts" && method === "GET") {
    return json({
      drafts: [...drafts].map(([id, messageId]) => ({
        id,
        message: { id: messageId, threadId: mail.get(messageId)?.threadId },
      })),
    });
  }
  if (path === "/drafts/send" && method === "POST") {
    const id = (body as { id: string }).id;
    const old = drafts.get(id);
    if (!old) return json({ error: { message: "Not Found" } }, 404);
    drafts.delete(id);
    remove(old);
    const m = newMessage(message?.raw, ["SENT"], message?.threadId);
    return json({ id: m.id, threadId: m.threadId, labelIds: m.labelIds });
  }
  if (path === "/messages/send" && method === "POST") {
    const m = newMessage(message?.raw, ["SENT"], message?.threadId);
    return json({ id: m.id, threadId: m.threadId, labelIds: m.labelIds });
  }
  const one = /^\/drafts\/([^/]+)$/.exec(path);
  if (!one) return null;
  const old = drafts.get(one[1]!);
  if (!old) return json({ error: { message: "Not Found" } }, 404);
  if (method === "GET") return json({ id: one[1], message: { id: old } });
  remove(old);
  if (method === "DELETE") {
    drafts.delete(one[1]!);
    return new Response(null, { status: 204 });
  }
  const m = newMessage(message?.raw, ["DRAFT"], message?.threadId);
  drafts.set(one[1]!, m.id);
  return json({ id: one[1], message: { id: m.id, threadId: m.threadId } });
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  if (url.host !== GMAIL) return json({ error: "not in this test" }, 404);
  const path = url.pathname.replace("/gmail/v1/users/me", "");
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
  if (method !== "GET") posted.push(`${method} ${path}`);
  const failure = failures.findIndex((f) => f.method === method && f.path === path);
  if (failure >= 0) {
    const [f] = failures.splice(failure, 1);
    if (f!.apply) draftsApi(method, path, body);
    return json({ error: { message: "Lost." } }, f!.status);
  }
  const answer = draftsApi(method, path, body);
  if (answer) return answer;
  const q = /^rfc822msgid:(\S+) in:sent$/.exec(url.searchParams.get("q") ?? "");
  if (path === "/messages" && q) {
    const found = [...mail.values()].filter(
      (m) => m.header === q[1] && m.labelIds.includes("SENT"),
    );
    return json({ messages: found.map((m) => ({ id: m.id, threadId: m.threadId })) });
  }

  if (path === "/messages/batchDelete" && init?.method === "POST") {
    const { ids } = JSON.parse(String(init.body)) as { ids: string[] };
    for (const id of ids) {
      deletedForever.push(id);
      mail.delete(id);
    }
    return new Response(null, { status: 204 });
  }

  const modify = path.match(/^\/threads\/([^/]+)\/modify$/);
  if (modify && init?.method === "POST") {
    const body = JSON.parse(String(init.body)) as {
      addLabelIds: string[];
      removeLabelIds: string[];
    };
    modifies.push({ threadId: modify[1]!, body });
    for (const m of mail.values()) {
      if (m.threadId === modify[1]) relabel(m.id, body.addLabelIds, body.removeLabelIds);
    }
    return json({ id: modify[1] });
  }

  if (path === "/profile") {
    return json({ historyId: String(historyId), messagesTotal: mail.size });
  }
  if (path === "/history") {
    const start = Number(url.searchParams.get("startHistoryId"));
    if (start < historyFloor)
      return json({ error: { message: "Requested entity was not found." } }, 404);
    return json({
      history: history.filter((h) => Number(h.id) > start),
      historyId: String(historyId),
    });
  }
  if (path === "/messages") {
    const labelIds = url.searchParams.getAll("labelIds");
    const search = url.searchParams.get("q");
    if (labelIds.length === 0 && !search) listings.push(url.searchParams.get("pageToken"));
    const all = [...mail.values()]
      .filter((m) => labelIds.every((l) => m.labelIds.includes(l)))
      .filter((m) => !search || m.subject.includes(search))
      .sort((a, b) => b.date - a.date);
    const size = Math.min(pageSize, Number(url.searchParams.get("maxResults") ?? 100));
    const offset = Number(url.searchParams.get("pageToken") ?? 0);
    const page = all.slice(offset, offset + size);
    return json({
      messages: page.map((m) => ({ id: m.id, threadId: m.threadId })),
      nextPageToken: offset + size < all.length ? String(offset + size) : undefined,
      resultSizeEstimate: all.length,
    });
  }
  const message = path.match(/^\/messages\/([^/]+)$/);
  if (message) {
    const id = message[1]!;
    const format = url.searchParams.get("format") ?? "full";
    fetches.push({ id, format });
    if (refuse.delete(id)) return json({ error: { message: "Not now." } }, 403);
    const m = mail.get(id);
    if (!m) return json({ error: { message: "Not Found" } }, 404);
    const body = resource(m, format);
    if (hold?.ids.includes(id) && !held.has(id)) {
      held.add(id);
      await hold.until;
    }
    return json(body);
  }
  const thread = path.match(/^\/threads\/([^/]+)$/);
  if (thread) {
    threadFetches.push(thread[1]!);
    const messages = [...mail.values()].filter((m) => m.threadId === thread[1]);
    const format = url.searchParams.get("format") ?? "full";
    return json({ id: thread[1], messages: messages.map((m) => resource(m, format)) });
  }
  if (path === "/labels") return json({ labels });
  const label = path.match(/^\/labels\/([^/]+)$/);
  if (label) return json({ id: label[1], messagesTotal: 0, messagesUnread: 0 });
  if (path === "/settings/sendAs") return json({ sendAs: [] });
  return json({ error: { message: "not in this test" } }, 404);
}

let imapOpen: boolean;
let imapLogins: number;

const IMAP_NAMES: Record<string, string> = {
  INBOX: "\\\\Inbox",
  SENT: "\\\\Sent",
  STARRED: "\\\\Starred",
  DRAFT: "\\\\Draft",
};

function imapFolder(name: string): Mail[] {
  const inFolder =
    name === "[Gmail]/Spam"
      ? (m: Mail) => m.labelIds.includes("SPAM")
      : name === "[Gmail]/Trash"
        ? (m: Mail) => m.labelIds.includes("TRASH")
        : (m: Mail) => !m.labelIds.includes("SPAM") && !m.labelIds.includes("TRASH");
  return [...mail.values()].filter(inFolder).sort((a, b) => a.date - b.date);
}

function internalDate(ms: number): string {
  const d = new Date(ms);
  const month = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}-${month}-${d.getUTCFullYear()} ${d.toISOString().slice(11, 19)} +0000`;
}

function gmailImap(): FakeStream {
  let selected: Mail[] = [];
  return new FakeStream(
    "* OK [CAPABILITY IMAP4rev1 SASL-IR AUTH=XOAUTH2 X-GM-EXT-1] Gimap\r\n",
    (line) => {
      const tag = tagOf(line);
      const command = line.slice(tag.length + 1).trim();
      if (command.startsWith("AUTHENTICATE")) {
        if (!imapOpen) return `${tag} NO [AUTHENTICATIONFAILED] IMAP access is disabled\r\n`;
        imapLogins++;
        return `${tag} OK [CAPABILITY IMAP4rev1 X-GM-EXT-1] Success\r\n`;
      }
      if (command.startsWith("LIST")) {
        return (
          '* LIST (\\HasNoChildren) "/" "INBOX"\r\n' +
          '* LIST (\\All \\HasNoChildren) "/" "[Gmail]/All Mail"\r\n' +
          '* LIST (\\HasNoChildren \\Junk) "/" "[Gmail]/Spam"\r\n' +
          '* LIST (\\HasNoChildren \\Trash) "/" "[Gmail]/Trash"\r\n' +
          `${tag} OK\r\n`
        );
      }
      if (command.startsWith("EXAMINE")) {
        selected = imapFolder(command.match(/"(.*)"/)![1]!);
        return `* ${selected.length} EXISTS\r\n* OK [UIDVALIDITY 1] UIDs\r\n${tag} OK [READ-ONLY]\r\n`;
      }
      if (command.startsWith("UID SEARCH")) {
        return `* SEARCH ${selected.map((_, i) => i + 1).join(" ")}\r\n${tag} OK\r\n`;
      }
      if (command.startsWith("UID FETCH")) {
        const uids = command
          .split(" ")[2]!
          .split(",")
          .flatMap((part) => {
            const [from, to = from] = part.split(":").map(Number);
            return Array.from({ length: to! - from! + 1 }, (_, i) => from! + i);
          });
        const lines = uids.map((uid) => {
          const m = selected[uid - 1]!;
          const header = `From: Sender <sender@example.test>\r\nSubject: ${m.subject}\r\n\r\n`;
          const names = m.labelIds
            .map((l) => IMAP_NAMES[l] ?? labels.find((x) => x.id === l && x.type === "user")?.name)
            .filter(Boolean)
            .map((name) => `"${name}"`);
          const flags = m.labelIds.includes("UNREAD") ? "()" : "(\\Seen)";
          return (
            `* ${uid} FETCH (UID ${uid} FLAGS ${flags} INTERNALDATE "${internalDate(m.date)}" ` +
            `X-GM-MSGID ${BigInt(`0x${m.id}`)} X-GM-THRID ${BigInt(`0x${m.threadId}`)} ` +
            `X-GM-LABELS (${names.join(" ")}) ` +
            `BODY[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID REFERENCES)] {${header.length}}\r\n${header})\r\n`
          );
        });
        return `${lines.join("")}${tag} OK\r\n`;
      }
      if (command.startsWith("LOGOUT")) return `* BYE\r\n${tag} OK\r\n`;
      return `${tag} OK\r\n`;
    },
  );
}

let notified: string[];

async function until(check: () => boolean, what: string, tries = 400): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function boot(
  seed?: (store: typeof import("../mail-store.ts")) => void,
  opts: { imap?: boolean; policy?: SyncPolicy; inForeground?: () => boolean } = {},
) {
  vi.resetModules();
  const { setPlatform } = await import("../../platform.ts");
  const { startCore } = await import("../../index.ts");
  const mailSync = await import("../mail-sync.ts");
  const mailStore = await import("../mail-store.ts");

  const files = new Map<string, Uint8Array>([
    ["accounts.json", new TextEncoder().encode(JSON.stringify([account]))],
  ]);
  const database = new DatabaseSync(":memory:") as unknown as SqlDatabase;
  const unused = () => {
    throw new Error("Not in this test.");
  };
  const platform: Platform = {
    kind: "desktop",
    appVersion: "test",
    log: () => {},
    database: () => database,
    files: {
      read: async (path) => files.get(path) ?? null,
      write: async (path, data) => {
        files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
      },
      remove: async (path) => {
        files.delete(path);
      },
      list: async () => [],
    },
    secrets: { get: async () => null, set: async () => {}, delete: async () => {} },
    userFiles: { open: unused, save: unused, pick: unused },
    google: {
      load: async () => {},
      addAccount: unused,
      cancelSignIn: () => {},
      isSignedIn: (accountId) => accountId === account.id,
      getAccessToken: async () => "token",
      getIdToken: unused,
      removeTokens: async () => {},
    },
    connect: opts.imap ? async () => gmailImap() : unused,
    relayUrl: "http://relay.test",
    relaySession: "bearer",
    broadcast: () => {},
    notify: ({ body }) => notified.push(body ?? ""),
    setUnreadCount: () => {},
    onResume: () => () => {},
    asyncContext: () => {
      let current: unknown;
      return {
        run: (value, fn) => {
          const before = current;
          current = value;
          try {
            return fn();
          } finally {
            current = before;
          }
        },
        get: () => current as never,
      };
    },
    rawSockets: true,
    crossOriginFetch: true,
    notificationReturn: "desktop",
    syncPolicy: opts.policy ?? { ...KEEP_MAILBOX, bodyPrefetch: true },
    inForeground: opts.inForeground,
  };

  setPlatform(platform);
  seed?.(mailStore);
  await startCore(platform);
  mailSync.configureAutoSync(0);
  const status = () => mailSync.getSyncStatus(account.id);
  const labelsOf = (id: string) => mailStore.getAllMessageLabels(account.id).get(id);
  const { registeredHandlers } = await import("../../ipc.ts");
  const invoke = (channel: string, params: unknown) => registeredHandlers().get(channel)!(params);
  return { mailSync, mailStore, status, labelsOf, invoke };
}

beforeEach(() => {
  mail = new Map();
  historyId = 100;
  history = [];
  historyFloor = 0;
  fetches = [];
  threadFetches = [];
  labels = SYSTEM_LABELS.map((id) => ({ id, name: id, type: "system" }));
  imapOpen = true;
  imapLogins = 0;
  listings = [];
  pageSize = 500;
  modifies = [];
  refuse = new Set();
  deletedForever = [];
  drafts = new Map();
  posted = [];
  raws = [];
  failures = [];
  hold = null;
  held.clear();
  notified = [];
  vi.stubGlobal("fetch", fakeFetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Real background syncs: well under a second alone, seconds on a busy CI runner.
describe("Gmail sync", { timeout: 15_000 }, () => {
  it("brings new mail while the first sync is still filling the mailbox", async () => {
    for (let i = 1; i <= 8; i++) deliver(`old${i}`, ["INBOX"], Date.now() - i * 60_000);
    let release!: () => void;
    hold = { ids: [...mail.keys()], until: new Promise((resolve) => (release = resolve)) };

    const { mailSync, mailStore, status } = await boot();
    await until(() => fetches.length > 0, "the fill to start");
    expect(status()).toMatchObject({ syncing: true, phase: "full", fullSyncDone: false });

    const progress = status().total;
    for (const id of ["new1", "new2", "new3"]) {
      deliver(id, ["INBOX", "UNREAD"]);
      mailSync.syncAccount(account.id, { force: true, trigger: "push" });
      await until(() => mailStore.getMessageDetail(account.id, id) !== null, `mail ${id}`);
      expect(status()).toMatchObject({ syncing: true, phase: "full", total: progress });
    }
    expect(notified).toEqual(["Subject new1", "Subject new2", "Subject new3"]);

    release();
    await until(() => status().fullSyncDone && !status().syncing, "the fill to finish");
    await until(() => status().download === null, "the downloads to finish");
    expect(listings).toEqual([null]);
    expect(mailStore.countAllMessages(account.id)).toBe(11);
    expect(fetches.every((f) => f.format === "full")).toBe(true);
    expect(new Set(fetches.map((f) => f.id)).size).toBe(fetches.length);
    expect(mailStore.getMessageDetail(account.id, "old8")?.bodyText).toBe("Body of old8");
  });

  it("picks a stopped first sync up where it was when new mail comes in, not from the start", async () => {
    for (let i = 1; i <= 7; i++) deliver(`old${i}`, ["INBOX"], Date.now() - i * 60_000);
    pageSize = 3;
    refuse.add("old5");

    const { mailSync, mailStore, status } = await boot();
    await until(() => status().error !== null && !status().syncing, "the fill to stop");
    expect(listings).toEqual([null, "3"]);
    expect(mailStore.countAllMessages(account.id)).toBe(3);

    deliver("new", ["INBOX", "UNREAD"]);
    mailSync.syncAccount(account.id, { force: true, trigger: "push" });
    await until(() => mailStore.getMessageDetail(account.id, "new") !== null, "the new mail");
    expect(listings).toEqual([null, "3"]);

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 60_000 });
    deliver("later", ["INBOX", "UNREAD"]);
    mailSync.syncAccount(account.id, { force: true, trigger: "push" });
    await until(() => status().fullSyncDone && !status().syncing, "the fill to finish");
    expect(listings).toEqual([null, "3", "3", "6"]);
    expect(mailStore.countAllMessages(account.id)).toBe(9);
    expect(fetches.filter((f) => f.id === "old1")).toHaveLength(1);
  });

  it("replays what changed during the first sync over what it wrote", async () => {
    deliver("a", ["INBOX", "UNREAD"], Date.now() - 60_000);
    deliver("b", ["INBOX"], Date.now() - 120_000);
    deliver("c", ["INBOX"], Date.now() - 180_000);
    let release!: () => void;
    hold = { ids: ["a", "b", "c"], until: new Promise((resolve) => (release = resolve)) };

    const { mailSync, mailStore, status, labelsOf } = await boot();
    await until(() => held.size === 3, "the fill's fetches");

    relabel("a", [], ["UNREAD"]);
    remove("b");
    relabel("c", ["STARRED"], []);
    mailSync.syncAccount(account.id, { force: true, trigger: "push" });
    await until(
      () => mailStore.getSyncState(account.id).historyId === String(historyId),
      "the push",
    );

    release();
    await until(() => status().fullSyncDone && !status().syncing, "the fill and its replay");
    await until(() => labelsOf("b") === undefined, "the replay");
    expect(labelsOf("a")).toEqual(["INBOX"]);
    expect(labelsOf("c")?.sort()).toEqual(["INBOX", "STARRED"]);
    expect(mailStore.countAllMessages(account.id)).toBe(2);
  });

  it("catches up an expired history feed from Gmail's listings, fetching only what's missing", async () => {
    const earlier = Date.now() - 3_600_000;
    const cached = [
      { id: "read", labelIds: ["INBOX", "UNREAD"] },
      { id: "archived", labelIds: ["INBOX"] },
      { id: "deleted", labelIds: ["INBOX"] },
    ];
    deliver("read", ["INBOX"], earlier);
    deliver("archived", ["STARRED"], earlier - 1);
    deliver("fresh", ["INBOX", "UNREAD"]);
    historyFloor = historyId;

    const { mailStore, status, labelsOf } = await boot((store) => {
      store.upsertMessageDetails(
        account.id,
        cached.map((m, i) => ({
          id: m.id,
          threadId: m.id,
          fromName: "Sender",
          fromEmail: "sender@example.test",
          to: "",
          subject: `Subject ${m.id}`,
          snippet: "",
          date: earlier - i,
          unread: m.labelIds.includes("UNREAD"),
          starred: false,
          labelIds: m.labelIds,
          hasAttachments: false,
          bodyHtml: null,
          bodyText: `Body of ${m.id}`,
          attachments: [],
        })),
      );
      store.setSyncState(account.id, { fullSyncDone: true, historyId: "50" });
      store.setKv(`spamTrashBackfilled:${account.id}`, "1");
    });

    await until(() => labelsOf("fresh") !== undefined, "the missing mail");
    await until(() => !status().syncing, "the refresh to finish");
    expect(labelsOf("read")).toEqual(["INBOX"]);
    expect(labelsOf("archived")).toEqual(["STARRED"]);
    expect(labelsOf("deleted")).toBeUndefined();
    expect(mailStore.getMessageDetail(account.id, "read")?.unread).toBe(false);
    expect(fetches.map((f) => f.id)).toEqual(["fresh"]);
    expect(mailStore.getSyncState(account.id).historyId).toBe(String(historyId));
  });

  it("fills a new mailbox over IMAP at once, then brings bodies inbox first, whole threads together", async () => {
    labels.push(
      { id: "Label_1", name: "Projects/Otter", type: "user" },
      { id: "CATEGORY_UPDATES", name: "CATEGORY_UPDATES", type: "system" },
      { id: "CATEGORY_PROMOTIONS", name: "CATEGORY_PROMOTIONS", type: "system" },
    );
    const hour = 3_600_000;
    deliver("a1", ["INBOX", "UNREAD"], Date.now() - 5 * hour, "a1");
    deliver("a2", ["SENT"], Date.now() - 4 * hour, "a1");
    deliver("b0", ["Label_1", "CATEGORY_UPDATES", "STARRED"], Date.now() - 3 * hour);
    deliver("c0", ["INBOX", "CATEGORY_PROMOTIONS"], Date.now() - 6 * hour);
    deliver("d0", ["SPAM", "UNREAD"], Date.now() - 2 * hour);
    deliver("e0", ["TRASH"], Date.now() - hour);

    const { mailStore, status, labelsOf } = await boot(undefined, { imap: true });
    await until(() => status().fullSyncDone, "the fill");
    expect(imapLogins).toBe(1);
    expect(mailStore.countAllMessages(account.id)).toBe(6);
    expect(labelsOf("a1")?.sort()).toEqual(["INBOX", "UNREAD"]);
    expect(labelsOf("a2")).toEqual(["SENT"]);
    expect(labelsOf("b0")?.sort()).toEqual(["CATEGORY_UPDATES", "Label_1", "STARRED"]);
    expect(labelsOf("c0")?.sort()).toEqual(["CATEGORY_PROMOTIONS", "INBOX"]);
    expect(labelsOf("d0")?.sort()).toEqual(["SPAM", "UNREAD"]);
    expect(labelsOf("e0")).toEqual(["TRASH"]);

    await until(() => status().download === null && threadFetches.length > 0, "the downloads");
    await until(() => mailStore.countUndownloaded(account.id) === 0, "every body");
    expect(threadFetches).toEqual(["a1"]);
    expect(fetches.map((f) => f.id).sort()).toEqual(["b0", "c0", "d0", "e0"]);
    expect(fetches.every((f) => f.format === "full")).toBe(true);
    expect(fetches[0]?.id).toBe("c0");
    expect(mailStore.getMessageDetail(account.id, "b0")?.snippet).toBe("Subject b0");
  });

  it("fills through the API when Gmail won't let the account in over IMAP", async () => {
    imapOpen = false;
    deliver("f1", ["INBOX"], Date.now() - 60_000);
    deliver("f2", ["INBOX", "UNREAD"], Date.now() - 120_000);
    const { mailStore, status } = await boot(undefined, { imap: true });
    await until(() => status().fullSyncDone && !status().syncing, "the fill");
    expect(imapLogins).toBe(0);
    expect(mailStore.countAllMessages(account.id)).toBe(2);
    expect(status().error).toBeNull();
  });

  it("archives by taking INBOX off the conversation: into All Mail, no Archive folder", async () => {
    deliver("a", ["INBOX", "UNREAD"], Date.now() - 60_000, "t");
    deliver("b", ["SENT"], Date.now(), "t");
    const { mailStore, status, labelsOf, invoke } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");

    await invoke("gmail:modifyThread", {
      accountId: account.id,
      threadId: "t",
      removeLabelIds: ["INBOX"],
    });
    expect(modifies).toEqual([
      { threadId: "t", body: { addLabelIds: [], removeLabelIds: ["INBOX"] } },
    ]);
    expect(labelsOf("a")).toEqual(["UNREAD"]);
    expect(labelsOf("b")).toEqual(["SENT"]);
    expect(mailStore.getLabels(account.id).map((l) => l.id)).not.toContain("ARCHIVE");
    const listed = (labelId: string) =>
      mailStore.getThreadsPage(account.id, labelId, 0, 10).messages.map((m) => m.threadId);
    expect(listed("ALL_MAIL")).toEqual(["t"]);
    expect(listed("INBOX")).toEqual([]);

    await invoke("gmail:modifyThread", {
      accountId: account.id,
      threadId: "t",
      addLabelIds: ["INBOX"],
    });
    expect(modifies.at(-1)).toEqual({
      threadId: "t",
      body: { addLabelIds: ["INBOX"], removeLabelIds: [] },
    });
    expect(listed("INBOX")).toEqual(["t"]);
  });

  it("empties Trash of what Gmail lists there, never mail restored elsewhere", async () => {
    deliver("trashed", ["TRASH"]);
    deliver("restored", ["TRASH"]);
    const { status, labelsOf, invoke } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");

    mail.get("restored")!.labelIds = ["INBOX"];
    await invoke("gmail:emptyFolder", { accountId: account.id, labelId: "TRASH" });
    expect(deletedForever).toEqual(["trashed"]);
    expect(mail.has("restored")).toBe(true);
    expect(labelsOf("trashed")).toBeUndefined();
  });

  it("never opens another draft of the same thread as the one asked for", async () => {
    deliver("mine", ["DRAFT"], Date.now(), "t");
    deliver("phone", ["DRAFT"], Date.now(), "t");
    const { status, invoke } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");

    drafts = new Map([["r-phone", "phone"]]);
    const draftFor = (messageId: string) =>
      invoke("gmail:getDraftForMessage", { accountId: account.id, messageId, threadId: "t" });
    expect(await draftFor("phone")).toEqual({ draftId: "r-phone" });

    mail.set("mine-saved-again", { ...mail.get("mine")!, id: "mine-saved-again" });
    drafts = new Map([
      ["r-mine", "mine-saved-again"],
      ["r-phone", "phone"],
    ]);
    expect(await draftFor("mine")).toEqual({ draftId: null, gone: true });

    drafts = new Map([["r-mine", "mine-saved-again"]]);
    expect(await draftFor("mine")).toEqual({ draftId: "r-mine" });
  });

  it("saves a reply draft with the headers that keep it in its conversation", async () => {
    deliver("first", ["INBOX"], Date.now() - 120_000, "t");
    deliver("answer", ["INBOX"], Date.now() - 60_000, "t");
    const { status, invoke } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");

    await invoke("gmail:saveDraft", {
      accountId: account.id,
      threadId: "t",
      to: "sender@example.test",
      subject: "Re: Subject answer",
      body: "Thanks",
    });
    expect(raws).toHaveLength(1);
    expect(raws[0]).toMatch(/^In-Reply-To: <answer@example\.test>/m);
    expect(raws[0]).toMatch(/^References: .*<answer@example\.test>/m);
  });

  describe("sending", () => {
    const compose = { accountId: account.id, to: "you@example.test", subject: "Plans", body: "Hi" };
    async function saved(sessionKey: string) {
      const booted = await boot();
      await until(() => booted.status().fullSyncDone && !booted.status().syncing, "the sync");
      const draft = (await booted.invoke("gmail:saveDraft", { ...compose, sessionKey })) as {
        draftId: string;
      };
      posted = [];
      return { ...booted, draftId: draft.draftId };
    }
    const sent = () => [...mail.values()].filter((m) => m.labelIds.includes("SENT"));

    it("sends the saved draft with drafts.send, with its own Message-ID, leaving no draft", async () => {
      const { invoke } = await saved("s1");
      await invoke("gmail:sendMessage", { ...compose, sessionKey: "s1" });
      expect(posted).toEqual(["POST /drafts/send"]);
      expect(drafts.size).toBe(0);
      expect(sent()).toHaveLength(1);
      expect(sent()[0]!.header).toMatch(/^<[0-9a-f]+@gmail\.test>$/);
    });

    it("sends directly when saving the final draft fails, then deletes the draft", async () => {
      const { invoke, draftId } = await saved("s2");
      failures.push({ method: "PUT", path: `/drafts/${draftId}`, status: 400 });
      await invoke("gmail:sendMessage", { ...compose, body: "Changed", sessionKey: "s2" });
      expect(posted).toEqual([
        `PUT /drafts/${draftId}`,
        "POST /messages/send",
        `DELETE /drafts/${draftId}`,
      ]);
      expect(drafts.size).toBe(0);
      expect(sent()).toHaveLength(1);
    });

    it("finds a send whose answer was lost in Sent, by its Message-ID", async () => {
      const { invoke } = await saved("s3");
      failures.push({ method: "POST", path: "/drafts/send", status: 500, apply: true });
      expect(await invoke("gmail:sendMessage", { ...compose, sessionKey: "s3" })).toMatchObject({
        ok: true,
        uncertain: false,
      });
      expect(sent()).toHaveLength(1);
      expect(drafts.size).toBe(0);
    });

    it("keeps an uncertain send for review, and deletes nothing", async () => {
      const { invoke, draftId } = await saved("s4");
      failures.push({ method: "POST", path: "/drafts/send", status: 500 });
      expect(await invoke("gmail:sendMessage", { ...compose, sessionKey: "s4" })).toMatchObject({
        ok: true,
        uncertain: true,
      });
      expect([...drafts.keys()]).toEqual([draftId]);
      expect(posted.some((p) => p.startsWith("DELETE"))).toBe(false);
      expect(await invoke("gmail:listSchedules", {})).toMatchObject([
        { state: "failed", error: "May have been sent — check Sent before sending again." },
      ]);
    });

    it("fails a refused send, keeping the one draft", async () => {
      const { invoke, draftId } = await saved("s5");
      failures.push({ method: "POST", path: "/drafts/send", status: 400 });
      await expect(invoke("gmail:sendMessage", { ...compose, sessionKey: "s5" })).rejects.toThrow(
        "400",
      );
      expect([...drafts.keys()]).toEqual([draftId]);
      expect(sent()).toEqual([]);
    });
  });
});

describe("Gmail sync with a window", { timeout: 15_000 }, () => {
  const DAY = 86_400_000;
  let front = true;
  const phone = (initialCoverage: { days: number; minThreads: number }, more = {}) => ({
    policy: { ...KEEP_RECENT, initialCoverage, ...more },
    inForeground: () => front,
  });
  /** A conversation a day, newest first: d0 today, d1 yesterday… */
  function mailbox(days: number): void {
    const now = Date.now();
    for (let d = days - 1; d >= 0; d--) deliver(`d${d}`, ["INBOX"], now - d * DAY - 60_000);
  }
  const filled = (mailStore: typeof import("../mail-store.ts")) =>
    mailStore.getKv(`syncCoverage:${account.id}`)?.includes('"done":true') === true;
  const uncached = (mailStore: typeof import("../mail-store.ts"), ids: string[]) =>
    mailStore.filterUnknownIds(account.id, ids);

  beforeEach(() => {
    front = true;
    pageSize = 10;
  });

  it("fills the window's newest pages, reads no bodies, and never counts as fully synced", async () => {
    mailbox(40);
    const { mailStore, status } = await boot(undefined, phone({ days: 10, minThreads: 5 }));
    await until(() => filled(mailStore) && !status().syncing, "the window");
    expect(listings).toEqual([null, "10"]);
    expect(fetches.every((f) => f.format === "metadata")).toBe(true);
    expect(status().fullSyncDone).toBe(false);
    // The last page's mail past the window leaves again.
    await until(() => mailStore.countAllMessages(account.id) === 10, "the eviction");
    expect(uncached(mailStore, ["d9", "d10"])).toEqual(["d10"]);
  });

  it("never keeps fewer than the newest `minThreads`, however old", async () => {
    mailbox(40);
    const { mailStore, status } = await boot(undefined, phone({ days: 2, minThreads: 15 }));
    await until(() => filled(mailStore) && !status().syncing, "the window");
    expect(listings).toEqual([null, "10"]);
    await until(() => mailStore.countAllMessages(account.id) === 15, "the eviction");
    expect(uncached(mailStore, ["d14", "d15"])).toEqual(["d15"]);
  });

  it("evicts conversations past the window, but not a starred one or one with a draft", async () => {
    mailbox(40);
    relabel("d15", ["STARRED"], []);
    deliver("draft16", ["DRAFT"], Date.now() - 15.5 * DAY, "d16");
    drafts.set("r16", "draft16");
    const { mailStore, status } = await boot(undefined, phone({ days: 10, minThreads: 5 }));
    await until(() => filled(mailStore) && !status().syncing, "the window");
    await until(() => uncached(mailStore, ["d17"]).length === 1, "the eviction");
    expect(uncached(mailStore, ["d9", "d15", "d16", "draft16", "d17", "d10"])).toEqual([
      "d17",
      "d10",
    ]);
  });

  it("pages lists past the cache from Gmail, and search finds what isn't cached", async () => {
    mailbox(40);
    const { mailStore, status, invoke } = await boot(undefined, phone({ days: 10, minThreads: 5 }));
    await until(() => mailStore.countAllMessages(account.id) === 10, "the window");
    const older = (await invoke("gmail:listMessages", {
      accountId: account.id,
      labelIds: ["INBOX"],
      pageToken: "10",
      maxResults: 10,
    })) as { messages: { id: string }[] };
    expect(older.messages.map((m) => m.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `d${10 + i}`),
    );
    expect(status().fullSyncDone).toBe(false);

    const found = (await invoke("gmail:search", {
      q: "Subject d35",
      accountIds: [account.id],
    })) as { messages: { id: string }[]; offline?: boolean };
    expect(found.messages.map((m) => m.id)).toEqual(["d35"]);
    expect(found.offline).toBeUndefined();
  });

  it("behind the app, replays a bounded part of the feed and the rest once in front", async () => {
    mailbox(10);
    const { mailSync, mailStore, status } = await boot(
      undefined,
      phone({ days: 90, minThreads: 5 }),
    );
    await until(() => filled(mailStore) && !status().syncing, "the window");
    front = false;
    for (let i = 0; i < 60; i++) deliver(`new${i}`, ["INBOX", "UNREAD"], Date.now() + i);
    mailSync.syncAccount(account.id, { force: true, trigger: "push" });
    // Gmail's quota paces it: a few seconds.
    await until(
      () => uncached(mailStore, ["new49"]).length === 0 && !status().syncing,
      "the bounded sync",
      2000,
    );
    expect(mailStore.countAllMessages(account.id)).toBe(60);
    expect(uncached(mailStore, ["new49", "new50"])).toEqual(["new50"]);
    expect(notified).toHaveLength(1);

    front = true;
    mailSync.syncAccount(account.id, { force: true });
    await until(() => mailStore.countAllMessages(account.id) === 70, "the rest", 2000);
  }, 60_000);

  it("after the history feed expired, reads the cache again and fills the window anew", async () => {
    mailbox(40);
    const { mailSync, mailStore, status, labelsOf } = await boot(
      undefined,
      phone({ days: 10, minThreads: 5 }),
    );
    await until(() => mailStore.countAllMessages(account.id) === 10, "the window");
    // Changes the feed can no longer tell.
    mail.delete("d3");
    mail.get("d4")!.labelIds.push("STARRED");
    mail.set("n1", {
      id: "n1",
      threadId: "n1",
      labelIds: ["INBOX"],
      date: Date.now(),
      subject: "n1",
    });
    historyFloor = historyId + 1;
    historyId += 1;

    mailSync.syncAccount(account.id, { force: true });
    await until(() => labelsOf("n1") !== undefined && !status().syncing, "the refresh", 1500);
    expect(labelsOf("d3")).toBeUndefined();
    expect(labelsOf("d4")).toContain("STARRED");
    expect(mailStore.getKv(`fullSyncRefresh:${account.id}`)).toBe("");
    expect(status().fullSyncDone).toBe(false);
  });

  it("keeps bodies under the retention bytes, least recently read first, never the open thread's", async () => {
    mailbox(10);
    const { mailStore, status, invoke } = await boot(
      undefined,
      phone({ days: 90, minThreads: 5 }, { retentionBytes: 30 }),
    );
    await until(() => filled(mailStore) && !status().syncing, "the window");
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    for (const id of ["d1", "d2", "d3"]) {
      vi.advanceTimersByTime(1000);
      await invoke("gmail:getMessage", { accountId: account.id, messageId: id });
    }
    vi.advanceTimersByTime(1000);
    await invoke("gmail:getThread", { accountId: account.id, threadId: "d1" });
    const { keepWithinRetention } = await import("../retention.ts");
    await keepWithinRetention();
    const kept = (id: string) => mailStore.getMessageDetail(account.id, id) !== null;
    expect(["d1", "d2", "d3"].map(kept)).toEqual([true, false, true]);
  });

  it("without a window (desktop, web), keeps no coverage and syncs behind the app too", async () => {
    mailbox(30);
    pageSize = 500;
    front = false;
    const { mailStore, status } = await boot(undefined, {
      policy: { ...KEEP_MAILBOX, bodyPrefetch: false },
      inForeground: () => front,
    });
    await until(() => status().fullSyncDone && !status().syncing, "the fill");
    expect(mailStore.countAllMessages(account.id)).toBe(30);
    expect(mailStore.getKv(`syncCoverage:${account.id}`)).toBeNull();
  });
});
