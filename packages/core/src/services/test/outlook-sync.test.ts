import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Platform, SqlDatabase } from "../../platform.ts";
import type { MailAccount } from "../../types.ts";

const account: MailAccount = {
  id: "me@contoso.test",
  email: "me@contoso.test",
  name: "Me",
  provider: "outlook",
};

const FOLDERS = [
  "inbox",
  "archive",
  "sentitems",
  "drafts",
  "deleteditems",
  "junkemail",
  "scheduled",
];

type Message = {
  id: string;
  folder: string;
  conversationId: string;
  subject: string;
  isRead: boolean;
  flagged: boolean;
  importance: "normal" | "high";
  categories: string[];
  fromMe: boolean;
  date: number;
  version: number;
};

let messages: Map<string, Message>;
let version: number;
let leftFolder: { id: string; folder: string; version: number }[];
let writes: { method: string; path: string; body?: unknown }[];
let searches: { path: string; search: string }[];
let notified: string[];
let sparseDeltas: boolean;
let failedReads: boolean;
let denied: { delta?: string; children?: string; message?: string; status: number };
let subfolders: Record<string, string[]>;
let expired: Set<string>;
let lagging: Set<string>;
let restIds: boolean;
let listing: {
  pageSize?: number;
  failAt?: { folder: string; skip: number };
  removedAt?: (folder: string, skip: number) => string[];
};

function deliver(id: string, folder: string, patch: Partial<Message> = {}): Message {
  const m: Message = {
    id,
    folder,
    conversationId: `conv-${id}`,
    subject: `Subject ${id}`,
    isRead: false,
    flagged: false,
    importance: "normal",
    categories: [],
    fromMe: folder === "sentitems",
    date: Date.now(),
    version: ++version,
    ...patch,
  };
  messages.set(id, m);
  return m;
}

function move(id: string, folder: string): void {
  const m = messages.get(id)!;
  leftFolder.push({ id, folder: m.folder, version: ++version });
  m.folder = folder;
  m.version = version;
}

function remove(id: string): void {
  const m = messages.get(id)!;
  leftFolder.push({ id, folder: m.folder, version: ++version });
  messages.delete(id);
}

const restIdOf = (m: Message) => `AAMk.${m.folder}.${m.id}`;

function byRestId(id: string): Message | undefined {
  const [, folder, ...rest] = id.split(".");
  const m = messages.get(rest.join("."));
  return m?.folder === folder ? m : undefined;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const refusal = () =>
  json({ error: { code: "ErrorAccessDenied", message: "Access is denied." } }, denied.status);

const notFound = () => json({ error: { code: "ErrorItemNotFound", message: "Not found." } }, 404);

const resource = (m: Message) => ({
  id: m.id,
  conversationId: m.conversationId,
  subject: m.subject,
  bodyPreview: `Preview of ${m.id}`,
  from: {
    emailAddress: m.fromMe
      ? { name: "Me", address: account.email }
      : { name: "Sender", address: "sender@example.test" },
  },
  toRecipients: [{ emailAddress: { name: "Me", address: account.email } }],
  receivedDateTime: new Date(m.date).toISOString(),
  isRead: m.isRead,
  isDraft: m.folder === "drafts",
  flag: { flagStatus: m.flagged ? "flagged" : "notFlagged" },
  importance: m.importance,
  categories: m.categories,
  hasAttachments: false,
  parentFolderId: m.folder,
  internetMessageId: `<${m.id}@example.test>`,
});

function handle(method: string, url: URL, body: unknown): Response {
  const path = url.pathname.replace(/^\/v1\.0/, "");
  if (method !== "GET") writes.push({ method, path, body });

  const wellKnown = /^\/me\/mailFolders\/([a-z]+)$/.exec(path);
  if (wellKnown && FOLDERS.includes(wellKnown[1]!)) return json({ id: wellKnown[1] });
  if (wellKnown) return notFound();
  const folderInfo = (id: string) => ({
    id,
    displayName: id,
    childFolderCount: subfolders[id]?.length ?? 0,
    unreadItemCount: [...messages.values()].filter((m) => m.folder === id && !m.isRead).length,
    totalItemCount: [...messages.values()].filter((m) => m.folder === id).length,
  });
  const children = /^\/me\/mailFolders\/([a-z]+)\/childFolders$/.exec(path);
  if (children) {
    if (children[1] === denied.children) return refusal();
    return json({ value: (subfolders[children[1]!] ?? []).map(folderInfo) });
  }
  if (path === "/me/mailFolders") {
    return json({
      value: FOLDERS.map((id) => ({
        id,
        displayName: id,
        childFolderCount: subfolders[id]?.length ?? 0,
        unreadItemCount: [...messages.values()].filter((m) => m.folder === id && !m.isRead).length,
        totalItemCount: [...messages.values()].filter((m) => m.folder === id).length,
      })),
    });
  }
  if (path === "/me/outlook/masterCategories") {
    return json({ value: [{ id: "c1", displayName: "Finance", color: "preset4" }] });
  }

  const delta = /^\/me\/mailFolders\/([a-z]+)\/messages\/delta$/.exec(path);
  if (delta) {
    const folder = delta[1]!;
    if (folder === denied.delta) return refusal();
    const since = Number(url.searchParams.get("since") ?? -1);
    const link = (v: number) =>
      `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages/delta?since=${v}`;
    if (since >= 0 && expired.delete(folder)) {
      return json({ error: { code: "SyncStateNotFound", message: "Expired." } }, 410);
    }
    if (since >= 0 && lagging.has(folder))
      return json({ value: [], "@odata.deltaLink": link(since) });
    if (since < 0 && listing.pageSize) {
      const skip = Number(url.searchParams.get("skip") ?? 0);
      if (listing.failAt?.folder === folder && listing.failAt.skip === skip) {
        listing.failAt = undefined;
        return json({ error: { code: "ErrorInternalServerError", message: "Test failure." } }, 500);
      }
      const all = [...messages.values()]
        .filter((m) => m.folder === folder)
        .sort((a, b) => a.id.localeCompare(b.id));
      const end = skip + listing.pageSize;
      const removedHere = (listing.removedAt?.(folder, skip) ?? []).map((id) => ({
        id,
        "@removed": { reason: "deleted" },
      }));
      return json({
        value: [...all.slice(skip, end).map(resource), ...removedHere],
        ...(end < all.length
          ? {
              "@odata.nextLink": `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages/delta?skip=${end}`,
            }
          : { "@odata.deltaLink": link(version) }),
      });
    }
    const present = [...messages.values()]
      .filter((m) => m.folder === folder && m.version > since)
      .map((m) =>
        since >= 0 && sparseDeltas
          ? { id: m.id, parentFolderId: m.folder, isRead: m.isRead }
          : resource(m),
      );
    const removed =
      since < 0
        ? []
        : leftFolder
            .filter((l) => l.folder === folder && l.version > since)
            .map((l) => ({ id: l.id, "@removed": { reason: "deleted" } }));
    return json({
      value: [...present, ...removed],
      "@odata.deltaLink": `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages/delta?since=${version}`,
    });
  }

  const list = /^\/me\/mailFolders\/([a-z]+)\/messages$/.exec(path);
  const search = url.searchParams.get("$search");
  if (search) searches.push({ path, search });
  const asListed = (m: Message) =>
    search && restIds ? { ...resource(m), id: restIdOf(m) } : resource(m);
  if (list) {
    return json({
      value: [...messages.values()]
        .filter((m) => m.folder === list[1])
        .sort((a, b) => b.date - a.date)
        .map(asListed),
    });
  }
  if (path === "/me/translateExchangeIds") {
    const { inputIds } = body as { inputIds: string[] };
    return json({
      value: inputIds.map((id) => {
        const m = id.startsWith("AAMk.") ? byRestId(id) : undefined;
        return m ? { sourceId: id, targetId: m.id } : { sourceId: id };
      }),
    });
  }
  if (path === "/me/messages") {
    const conversation = /conversationId eq '([^']+)'/.exec(url.searchParams.get("$filter") ?? "");
    return json({
      value: [...messages.values()]
        .filter((m) => !conversation || m.conversationId === conversation[1])
        .map(asListed),
    });
  }

  const one = /^\/me\/messages\/([^/]+)(\/move)?$/.exec(path);
  if (one) {
    const asked = decodeURIComponent(one[1]!);
    if (asked.startsWith("AAMk.")) {
      const m = byRestId(asked);
      return m && method === "GET" ? json({ ...resource(m), id: asked }) : notFound();
    }
    const m = messages.get(asked);
    if (!m) return notFound();
    if (method === "GET" && m.id === denied.message) return refusal();
    if (method === "GET" && failedReads)
      return json({ error: { code: "ErrorInternalServerError", message: "Test failure." } }, 500);
    if (one[2]) {
      move(m.id, (body as { destinationId: string }).destinationId);
      return json(resource(m));
    }
    if (method === "PATCH") {
      const patch = body as {
        isRead?: boolean;
        flag?: { flagStatus: string };
        categories?: string[];
      };
      if (patch.isRead !== undefined) m.isRead = patch.isRead;
      if (patch.flag) m.flagged = patch.flag.flagStatus === "flagged";
      if (patch.categories) m.categories = patch.categories;
      m.version = ++version;
    }
    return json(resource(m));
  }
  return json({ error: { code: "NotInThisTest", message: path } }, 400);
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  if (url.host !== "graph.microsoft.com") return json({ error: "not in this test" }, 404);
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
  if (url.pathname === "/v1.0/$batch") {
    const requests = (
      body as { requests: { id: string; method: string; url: string; body?: unknown }[] }
    ).requests;
    const responses = await Promise.all(
      requests.map(async (r) => {
        const answer = handle(
          r.method,
          new URL(`https://graph.microsoft.com/v1.0${r.url}`),
          r.body,
        );
        return { id: r.id, status: answer.status, body: await answer.json() };
      }),
    );
    return json({ responses });
  }
  return handle(init?.method ?? "GET", url, body);
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function boot() {
  vi.resetModules();
  const { setPlatform } = await import("../../platform.ts");
  const { startCore } = await import("../../index.ts");
  const mailSync = await import("../mail-sync.ts");
  const mailStore = await import("../mail-store.ts");
  const { providerFor } = await import("../../providers/index.ts");
  const { registeredHandlers } = await import("../../ipc.ts");

  const files = new Map<string, Uint8Array>([
    ["accounts.json", new TextEncoder().encode(JSON.stringify([account]))],
  ]);
  const database = new DatabaseSync(":memory:") as unknown as SqlDatabase;
  const unused = () => {
    throw new Error("Not in this test.");
  };
  const platform: Platform = {
    kind: "web",
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
      isSignedIn: () => false,
      getAccessToken: unused,
      getIdToken: unused,
      removeTokens: async () => {},
    },
    microsoft: {
      available: async () => true,
      load: async () => {},
      addAccount: unused,
      cancelSignIn: () => {},
      isSignedIn: (accountId) => accountId === account.id,
      getAccessToken: async () => "token",
      getIdToken: unused,
      removeTokens: async () => {},
    },
    connect: unused,
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
    offlineDownloads: false,
  };

  setPlatform(platform);
  await startCore(platform);
  mailSync.configureAutoSync(0);
  const status = () => mailSync.getSyncStatus(account.id);
  const labelsOf = (id: string) => mailStore.getAllMessageLabels(account.id).get(id);
  const sync = async () => {
    const before = status().lastSyncAt;
    mailSync.syncAccount(account.id, { force: true, trigger: "push" });
    await until(() => status().lastSyncAt !== before && !status().syncing, "a sync");
  };
  const invoke = (channel: string, params: unknown) => registeredHandlers().get(channel)!(params);
  return { mailStore, status, labelsOf, sync, invoke, provider: providerFor(account.id) };
}

beforeEach(() => {
  messages = new Map();
  version = 0;
  leftFolder = [];
  writes = [];
  searches = [];
  notified = [];
  sparseDeltas = false;
  failedReads = false;
  denied = { status: 403 };
  subfolders = {};
  expired = new Set();
  lagging = new Set();
  listing = {};
  restIds = false;
  vi.stubGlobal("fetch", fakeFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Outlook sync", () => {
  it("lists every folder of a new mailbox, as labels", async () => {
    deliver("a", "inbox", { flagged: true, categories: ["Finance"] });
    deliver("b", "archive", { isRead: true, importance: "high" });
    deliver("c", "sentitems", { isRead: true });
    deliver("d", "junkemail");

    const { status, labelsOf, mailStore } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");

    expect(labelsOf("a")?.sort()).toEqual(["INBOX", "STARRED", "UNREAD", "category:Finance"]);
    expect(labelsOf("b")?.sort()).toEqual(["ARCHIVE", "IMPORTANT"]);
    expect(labelsOf("c")).toEqual(["SENT"]);
    expect(labelsOf("d")?.sort()).toEqual(["SPAM", "UNREAD"]);
    const labels = mailStore.getLabels(account.id);
    expect(labels.find((l) => l.id === "category:Finance")).toMatchObject({
      name: "Finance",
      type: "user",
      color: { backgroundColor: expect.any(String) },
    });
    expect(labels.find((l) => l.id === "INBOX")).toMatchObject({ type: "system", unread: 1 });
    expect(labels.find((l) => l.id === "ARCHIVE")).toMatchObject({
      type: "system",
      total: 1,
      unread: 0,
    });
  });

  it("skips a folder Outlook refuses instead of signing the mailbox out", async () => {
    denied.delta = "junkemail";
    deliver("a", "inbox");
    deliver("b", "archive", { isRead: true });
    deliver("d", "junkemail");

    const { status, labelsOf, sync } = await boot();
    await until(() => !!labelsOf("b") && !status().syncing, "the first sync");
    expect(status()).toMatchObject({ signInNeeded: false, error: null, fullSyncDone: false });
    expect(labelsOf("a")).toContain("INBOX");
    expect(labelsOf("d")).toBeUndefined();

    deliver("e", "inbox");
    await sync();
    expect(status()).toMatchObject({ signInNeeded: false, error: null });
    expect(labelsOf("e")).toContain("INBOX");
  });

  it("still signs the mailbox out when a folder answers 401", async () => {
    denied = { delta: "junkemail", status: 401 };
    deliver("a", "inbox");

    const { status } = await boot();
    await until(() => status().signInNeeded, "the sign-out");
  });

  it("keeps a folder's subfolders and their mail when Outlook won't list them", async () => {
    subfolders = { inbox: ["projects"] };
    deliver("p", "projects");

    const { status, labelsOf, sync } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");
    expect(labelsOf("p")).toContain("folder:projects");

    denied.children = "inbox";
    const now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now + 5 * 60_000);
    deliver("q", "inbox");
    await sync();
    expect(status()).toMatchObject({ signInNeeded: false, error: null });
    expect(labelsOf("p")).toContain("folder:projects");
  });

  it("files subfolders Outlook won't list under their parent's new place", async () => {
    subfolders = { inbox: ["proj"], proj: ["sub"] };
    deliver("s", "sub");

    const { status, labelsOf, sync } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");
    expect(labelsOf("s")).toContain("folder:sub");

    subfolders = { deleteditems: ["proj"], proj: ["sub"] };
    denied.children = "proj";
    const now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now + 5 * 60_000);
    await sync();
    expect(labelsOf("s")).toContain("TRASH");
    expect(labelsOf("s")).not.toContain("folder:sub");
  });

  it("counts subfolders Outlook won't list from the cache", async () => {
    subfolders = { inbox: ["projects"] };
    deliver("p", "projects");

    const { status, sync, mailStore } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");

    denied.children = "inbox";
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    now += 5 * 60_000;
    await sync();
    deliver("p2", "projects");
    now += 1000;
    await sync();
    now += 5 * 60_000;
    await sync();
    expect(mailStore.getLabels(account.id).find((l) => l.id === "folder:projects")).toMatchObject({
      total: 2,
      unread: 2,
    });
    clock.mockRestore();
  });

  it("fails a write to a message Outlook won't let it read, rather than skip it", async () => {
    deliver("x", "inbox");
    const { status, provider } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");

    denied.message = "x";
    await expect(
      provider.modifyMessage(account.id, "x", { removeLabelIds: ["UNREAD"] }),
    ).rejects.toThrow(/403/);
  });

  it("syncs a folder on when one of its messages can't be read", async () => {
    deliver("x", "archive");

    const { status, labelsOf, sync } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");

    denied.message = "x";
    messages.get("x")!.version = ++version;
    deliver("y", "archive");
    await sync();
    expect(status()).toMatchObject({ signInNeeded: false, error: null });
    expect(labelsOf("y")).toContain("ARCHIVE");
  });

  it("follows each folder's delta: new mail, moves and deletions", async () => {
    deliver("a", "inbox");
    deliver("b", "inbox");
    deliver("c", "archive");
    const { status, labelsOf, sync } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");

    sparseDeltas = true;
    deliver("new", "inbox");
    move("a", "archive");
    remove("c");
    await sync();

    expect(labelsOf("new")).toEqual(["INBOX", "UNREAD"]);
    expect(notified).toEqual(["Subject new"]);
    expect(labelsOf("a")?.sort()).toEqual(["ARCHIVE", "UNREAD"]);
    expect(labelsOf("c")).toBeUndefined();
    expect(labelsOf("b")).toEqual(["INBOX", "UNREAD"]);
  });

  describe("a conversation moved in Outlook into a nested folder", () => {
    const setUp = () => {
      subfolders = { inbox: ["projects"] };
      const date = Date.parse("2026-11-01T08:00:00Z");
      deliver("c1", "inbox", { conversationId: "conv-x", date });
      deliver("c2", "sentitems", { conversationId: "conv-x", date: date + 60_000 });
      deliver("c3", "inbox", { conversationId: "conv-x", date: date + 120_000 });
      deliver("k1", "inbox");
      deliver("k2", "inbox");
    };
    const moveAll = () => ["c1", "c2", "c3"].forEach((id) => move(id, "projects"));

    async function shown(booted: Awaited<ReturnType<typeof boot>>) {
      const { mailStore, invoke } = booted;
      const thread = (await invoke("gmail:getThread", {
        accountId: account.id,
        threadId: "conv-x",
      })) as { id: string; labelIds: string[] }[];
      return {
        ids: thread.map((m) => m.id).sort(),
        badges: [...new Set(thread.flatMap((m) => m.labelIds))].filter(
          (l) => l === "INBOX" || l === "SENT" || l.startsWith("folder:"),
        ),
        inInbox: mailStore
          .getThreadsPage(account.id, "INBOX", 0, 50)
          .messages.some((m) => m.threadId === "conv-x"),
        inboxTotal: mailStore.getLabels(account.id).find((l) => l.id === "INBOX")?.total,
        cached: mailStore.countAllMessages(account.id),
      };
    }

    it("shows only the destination once sync follows the move, in an open reader too", async () => {
      setUp();
      const booted = await boot();
      const { status, sync } = booted;
      await until(() => status().fullSyncDone && !status().syncing, "the first sync");
      expect((await shown(booted)).badges.sort()).toEqual(["INBOX", "SENT"]);

      const revision = status().revision;
      moveAll();
      await sync();
      expect(status().revision).toBeGreaterThan(revision);
      expect(await shown(booted)).toEqual({
        ids: ["c1", "c2", "c3"],
        badges: ["folder:projects"],
        inInbox: false,
        inboxTotal: 2,
        cached: 5,
      });
    });

    it("keeps the Inbox badge while one message is still there", async () => {
      setUp();
      const booted = await boot();
      const { status, sync } = booted;
      await until(() => status().fullSyncDone && !status().syncing, "the first sync");

      move("c1", "projects");
      move("c2", "projects");
      await sync();
      const after = await shown(booted);
      expect(after.badges.sort()).toEqual(["INBOX", "folder:projects"]);
      expect(after).toMatchObject({ inInbox: true, inboxTotal: 3, cached: 5 });
    });

    it.each([
      ["the source's removals first", ["projects"]],
      ["the destination's additions first", ["inbox", "sentitems"]],
    ])("converges without duplicates with %s", async (_, behind) => {
      setUp();
      const booted = await boot();
      const { status, sync } = booted;
      await until(() => status().fullSyncDone && !status().syncing, "the first sync");

      lagging = new Set(behind);
      moveAll();
      await sync();
      expect(await shown(booted)).toMatchObject({ ids: ["c1", "c2", "c3"], cached: 5 });

      lagging.clear();
      await sync();
      expect(await shown(booted)).toEqual({
        ids: ["c1", "c2", "c3"],
        badges: ["folder:projects"],
        inInbox: false,
        inboxTotal: 2,
        cached: 5,
      });
    });

    it("converges after Outlook expired the deltas, reconciling only once a listing completes", async () => {
      setUp();
      deliver("gone", "inbox");
      const booted = await boot();
      const { status, sync, labelsOf } = booted;
      await until(() => status().fullSyncDone && !status().syncing, "the first sync");

      expired = new Set(["inbox", "sentitems", "projects"]);
      moveAll();
      remove("gone");
      listing = { pageSize: 1, failAt: { folder: "inbox", skip: 1 } };
      await sync();
      await until(() => status().error != null && !status().syncing, "the interrupted listing");

      expect(labelsOf("gone")).toContain("INBOX");
      expect(labelsOf("k2")).toContain("INBOX");
      expect((await shown(booted)).cached).toBe(6);

      const now = Date.now();
      vi.spyOn(Date, "now").mockImplementation(() => now + 60 * 60_000);
      await sync();
      await until(() => labelsOf("gone") === undefined && !status().syncing, "the listing");
      expect(await shown(booted)).toEqual({
        ids: ["c1", "c2", "c3"],
        badges: ["folder:projects"],
        inInbox: false,
        inboxTotal: 2,
        cached: 5,
      });
      expect(labelsOf("k1")).toContain("INBOX");
      expect(labelsOf("k2")).toContain("INBOX");
    });

    it("refiles mail moved away while its folder was being listed again", async () => {
      setUp();
      const booted = await boot();
      const { status, sync, labelsOf } = booted;
      await until(() => status().fullSyncDone && !status().syncing, "the first sync");

      expired = new Set(["inbox"]);
      lagging = new Set(["projects"]);
      listing = {
        pageSize: 1,
        removedAt: (folder, skip) => {
          if (folder !== "inbox" || skip !== 1) return [];
          move("c1", "projects");
          return ["c1"];
        },
      };
      await sync();
      await until(
        () => !status().syncing && labelsOf("c1")?.includes("folder:projects") === true,
        "the listing",
      );
      expect(labelsOf("c1")).not.toContain("INBOX");
      expect((await shown(booted)).cached).toBe(5);
    });

    it("refreshes known messages when a destination is listed again", async () => {
      setUp();
      const booted = await boot();
      const { status, sync, labelsOf } = booted;
      await until(() => status().fullSyncDone && !status().syncing, "the first sync");

      expired = new Set(["projects"]);
      lagging = new Set(["inbox", "sentitems"]);
      moveAll();
      await sync();
      await until(
        () => !status().syncing && !labelsOf("c1")?.includes("INBOX"),
        "the destination's listing",
      );
      expect(await shown(booted)).toMatchObject({ badges: ["folder:projects"], cached: 5 });
    });
  });

  describe("regular ids from Outlook's search", () => {
    const restRows = (mailStore: Awaited<ReturnType<typeof boot>>["mailStore"]) =>
      mailStore.getMessageIdsWithPrefix(account.id, "AAMk");

    it("caches search results under their immutable ids, so a later move leaves no copy behind", async () => {
      deliver("h1", "inbox", { conversationId: "conv-h" });
      deliver("h2", "inbox", { conversationId: "conv-h" });
      subfolders = { inbox: ["closures"] };
      const { status, sync, invoke, mailStore, labelsOf } = await boot();
      await until(() => status().fullSyncDone && !status().syncing, "the first sync");

      restIds = true;
      const result = (await invoke("gmail:search", { q: "hera", accountIds: [account.id] })) as {
        messages: { id: string }[];
      };
      expect(result.messages.map((m) => m.id)).not.toContainEqual(expect.stringMatching(/^AAMk/));
      expect(restRows(mailStore)).toEqual([]);

      move("h1", "closures");
      move("h2", "closures");
      await sync();
      expect(restRows(mailStore)).toEqual([]);
      expect(mailStore.countAllMessages(account.id)).toBe(2);
      expect(labelsOf("h1")).toEqual(["folder:closures", "UNREAD"]);
      expect(
        mailStore.getThreadsPage(account.id, "INBOX", 0, 10).messages.map((m) => m.threadId),
      ).not.toContain("conv-h");
    });

    it("repairs copies an earlier search cached under regular ids", async () => {
      deliver("live", "inbox");
      deliver("moved", "inbox");
      deliver("uncached", "inbox");
      deliver("kept", "inbox");
      subfolders = { inbox: ["closures"] };
      const { status, sync, mailStore, labelsOf } = await boot();
      await until(() => status().fullSyncDone && !status().syncing, "the first sync");

      const copy = (id: string, folder: string) => ({
        ...mailStore.getThreadMessages(account.id, `conv-${id}`)[0]!,
        id: `AAMk.${folder}.${id}`,
      });
      const stale = [copy("live", "inbox"), copy("moved", "inbox"), copy("uncached", "inbox")];
      mailStore.applyHistoryChanges(account.id, [{ kind: "deleted", id: "uncached" }]);
      mailStore.upsertMessages(account.id, stale);
      move("moved", "closures");
      lagging = new Set(["inbox", "closures"]);

      await sync();
      expect(restRows(mailStore)).toEqual([]);
      expect(mailStore.countAllMessages(account.id)).toBe(4);
      expect(labelsOf("live")).toEqual(["INBOX", "UNREAD"]);
      expect(labelsOf("uncached")).toEqual(["INBOX", "UNREAD"]);
      expect(labelsOf("kept")).toEqual(["INBOX", "UNREAD"]);
      expect(mailStore.getLabels(account.id).find((l) => l.id === "INBOX")?.total).toBe(4);
    });
  });

  it("keeps headers, conversation and list position when marking read produces a sparse delta", async () => {
    const latest = deliver("latest", "inbox", {
      date: Date.parse("2026-10-13T08:00:00Z"),
      flagged: true,
      categories: ["Finance"],
    });
    deliver("older", "inbox", { date: latest.date - 60_000 });
    const { status, provider, mailStore, sync } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");
    const before = mailStore
      .getThreadsPage(account.id, "INBOX", 0, 10)
      .messages.find((m) => m.id === "latest")!;
    mailStore.upsertMessageDetail(account.id, {
      ...before,
      bodyText: "Cached message body",
      bodyHtml: "<p>Cached message body</p>",
      attachments: [],
    });
    sparseDeltas = true;
    await provider.modifyThread(account.id, latest.conversationId, { removeLabelIds: ["UNREAD"] });
    await sync();
    expect(mailStore.getMessageDetail(account.id, "latest")).toMatchObject({
      subject: before.subject,
      date: before.date,
      threadId: before.threadId,
      fromEmail: before.fromEmail,
      unread: false,
      starred: true,
      labelIds: expect.arrayContaining(["INBOX", "STARRED", "category:Finance"]),
      bodyText: "Cached message body",
    });
    expect(mailStore.getAllMessageLabels(account.id).get("latest")).not.toContain("UNREAD");
    expect(mailStore.getThreadsPage(account.id, "INBOX", 0, 10).messages.map((m) => m.id)).toEqual([
      "latest",
      "older",
    ]);
    expect(notified).toEqual([]);
  });

  it("keeps the cache and delta cursor intact when resolving a sparse update fails", async () => {
    deliver("a", "inbox");
    const { status, provider, mailStore, sync } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");
    const before = mailStore.getThreadsPage(account.id, "INBOX", 0, 10).messages;
    const cursor = mailStore.getKv(`outlookDelta:${account.id}`);
    sparseDeltas = true;
    await provider.modifyMessage(account.id, "a", { removeLabelIds: ["UNREAD"] });
    failedReads = true;
    await expect(
      provider.sync(account.id, {
        update: () => {},
        assertActive: () => {},
        bumpRevision: () => {},
        newMail: async () => {},
      }),
    ).rejects.toThrow("Test failure");
    expect(mailStore.getKv(`outlookDelta:${account.id}`)).toBe(cursor);
    expect(mailStore.getThreadsPage(account.id, "INBOX", 0, 10).messages).toEqual(before);
    failedReads = false;
    await sync();
    expect(mailStore.getThreadsPage(account.id, "INBOX", 0, 10).messages[0]).toMatchObject({
      subject: "Subject a",
      unread: false,
    });
  });

  it("turns label changes into Graph's writes", async () => {
    deliver("in", "inbox", { conversationId: "t" });
    deliver("sent", "sentitems", { conversationId: "t", isRead: true });
    const { status, provider } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");
    writes = [];

    await provider.modifyThread(account.id, "t", { removeLabelIds: ["INBOX"] });
    expect(messages.get("in")?.folder).toBe("archive");
    expect(messages.get("sent")?.folder).toBe("sentitems");

    await provider.modifyMessage(account.id, "in", {
      addLabelIds: ["STARRED", "category:Finance"],
      removeLabelIds: ["UNREAD"],
    });
    expect(messages.get("in")).toMatchObject({
      flagged: true,
      isRead: true,
      categories: ["Finance"],
    });

    await provider.trashThread(account.id, "t");
    expect(messages.get("in")?.folder).toBe("deleteditems");
    expect(messages.get("sent")?.folder).toBe("deleteditems");
    await provider.untrashThread(account.id, "t");
    expect(messages.get("in")?.folder).toBe("inbox");
    expect(messages.get("sent")?.folder).toBe("sentitems");
  });

  it("archives from the app: the inbox's mail lands in the Archive at once, and undo brings it back", async () => {
    deliver("in", "inbox", { conversationId: "t" });
    deliver("sent", "sentitems", { conversationId: "t", isRead: true });
    const { status, labelsOf, invoke, mailStore, sync } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");
    writes = [];

    await invoke("gmail:modifyThread", {
      accountId: account.id,
      threadId: "t",
      removeLabelIds: ["INBOX"],
    });
    expect(writes).toEqual([
      { method: "POST", path: "/me/messages/in/move", body: { destinationId: "archive" } },
    ]);
    expect(messages.get("in")?.folder).toBe("archive");
    expect(messages.get("sent")?.folder).toBe("sentitems");
    expect(labelsOf("in")?.sort()).toEqual(["ARCHIVE", "UNREAD"]);
    expect(labelsOf("sent")).toEqual(["SENT"]);
    const listed = (labelId: string) =>
      mailStore.getThreadsPage(account.id, labelId, 0, 10).messages.map((m) => m.threadId);
    expect(listed("ARCHIVE")).toEqual(["t"]);
    expect(listed("INBOX")).toEqual([]);
    await sync();
    expect(labelsOf("in")?.sort()).toEqual(["ARCHIVE", "UNREAD"]);

    await invoke("gmail:modifyThread", {
      accountId: account.id,
      threadId: "t",
      addLabelIds: ["INBOX"],
    });
    expect(messages.get("in")?.folder).toBe("inbox");
    expect(messages.get("sent")?.folder).toBe("sentitems");
    expect(labelsOf("in")?.sort()).toEqual(["INBOX", "UNREAD"]);
    expect(listed("ARCHIVE")).toEqual([]);
  });

  it("takes mail out of the Archive, and lists and searches it from Outlook", async () => {
    deliver("old", "archive", { conversationId: "o", subject: "Lunch" });
    const { status, labelsOf, provider } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");

    expect((await provider.listIds!(account.id, { labelIds: ["ARCHIVE"] })).ids).toEqual(["old"]);
    await provider.search!(account.id, "in:archive lunch", undefined, 50);
    expect(searches).toEqual([{ path: "/me/mailFolders/archive/messages", search: '"lunch"' }]);

    await provider.modifyThread(account.id, "o", { removeLabelIds: ["ARCHIVE"] });
    expect(messages.get("old")?.folder).toBe("inbox");
    await provider.modifyThread(account.id, "o", { addLabelIds: ["ARCHIVE"] });
    expect(messages.get("old")?.folder).toBe("archive");
    expect(labelsOf("old")).toContain("ARCHIVE");
  });

  it("gives ARCHIVE to archived mail cached before the Archive had a label", async () => {
    deliver("old", "archive", { isRead: true });
    deliver("in", "inbox");
    const { status, labelsOf, mailStore, sync } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");
    mailStore.applyHistoryChanges(account.id, [
      { kind: "labelsRemoved", id: "old", labelIds: ["ARCHIVE"] },
    ]);
    const key = `outlookDelta:${account.id}`;
    const delta = JSON.parse(mailStore.getKv(key)!) as Record<string, { label?: string | null }>;
    for (const folder of Object.values(delta)) delete folder.label;
    mailStore.setKv(key, JSON.stringify(delta));

    await sync();
    expect(labelsOf("old")).toEqual(["ARCHIVE"]);
    expect(labelsOf("in")?.sort()).toEqual(["INBOX", "UNREAD"]);
    expect(mailStore.getThreadsPage(account.id, "ARCHIVE", 0, 10).messages).toHaveLength(1);
  });

  it("shows Outlook's Scheduled folder, where its Snooze keeps mail, as SNOOZED", async () => {
    deliver("later", "scheduled", { conversationId: "s" });
    const { status, labelsOf, provider, mailStore } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");
    expect(labelsOf("later")).toContain("SNOOZED");
    expect(mailStore.getLabels(account.id).find((l) => l.id === "SNOOZED")).toMatchObject({
      type: "system",
      total: 1,
    });
    await provider.modifyThread(account.id, "s", { addLabelIds: ["INBOX"] });
    expect(messages.get("later")?.folder).toBe("inbox");
  });

  it("searches with Outlook's engine, Gmail's operators translated", async () => {
    deliver("unread", "inbox");
    deliver("read", "inbox", { isRead: true });
    const { status, provider } = await boot();
    await until(() => status().fullSyncDone && !status().syncing, "the first sync");

    const page = await provider.search!(
      account.id,
      "invoice from:bob has:attachment in:inbox is:unread",
      undefined,
      50,
    );
    expect(searches).toEqual([
      { path: "/me/mailFolders/inbox/messages", search: '"invoice from:bob hasattachments:true"' },
    ]);
    expect(page.refs.map((r) => r.id)).toEqual(["unread"]);
  });
});
