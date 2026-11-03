import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { utf8Decode } from "../../bytes.ts";
import { connectImap, type ImapClient, type ImapOptions, type ImapUpdate } from "../imap/client.ts";
import { parseMessage } from "../mime.ts";
import { sendMail } from "../smtp/client.ts";
import { nodeConnect } from "./node-stream.ts";
import { dockerAvailable, startDovecot, startGreenMail, type Container } from "./servers.ts";

const docker = dockerAvailable();

let counter = 0;
function message(subject: string): { id: string; raw: string } {
  const id = `<test-${Date.now()}-${++counter}@otter.test>`;
  const raw = [
    "From: Bob =?UTF-8?Q?Bj=C3=B6rk?= <bob@example.com>",
    "To: Alice <alice@example.com>",
    `Subject: =?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(subject)))}?=`,
    `Message-ID: ${id}`,
    "Date: Tue, 29 Sep 2026 10:00:00 +0000",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b"',
    "",
    "--b",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hello from the tests.",
    ".a line starting with a dot",
    "--b",
    'Content-Type: application/octet-stream; name="data.bin"',
    'Content-Disposition: attachment; filename="data.bin"',
    "Content-Transfer-Encoding: base64",
    "",
    "AAECAw==",
    "--b--",
    "",
  ].join("\r\n");
  return { id, raw };
}

const waitFor = async <T>(check: () => Promise<T | undefined>, ms = 10_000): Promise<T> => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

function imapBasics(connect: () => Promise<ImapClient>, folder: string) {
  let client: ImapClient;
  let uids: number[] = [];
  let first: { id: string; raw: string };

  beforeAll(async () => {
    client = await connect();
  });
  afterAll(async () => {
    await client?.logout();
  });

  it("lists, creates, renames and deletes folders", async () => {
    await client.createMailbox(`${folder}-tmp`);
    await client.renameMailbox(`${folder}-tmp`, folder);
    const folders = await client.list();
    expect(folders.find((f) => f.path === "INBOX")?.selectable).toBe(true);
    const created = folders.find((f) => f.path === folder);
    expect(created).toMatchObject({ path: folder, selectable: true });
    expect(folders.some((f) => f.path === `${folder}-tmp`)).toBe(false);
    await client.createMailbox(`${folder}-gone`);
    await client.deleteMailbox(`${folder}-gone`);
    expect((await client.list()).some((f) => f.path === `${folder}-gone`)).toBe(false);
  });

  it("appends and selects", async () => {
    first = message("Café ☕ first");
    const second = message("second");
    const a = await client.append("INBOX", first.raw, {
      flags: ["\\Seen"],
      date: new Date("2026-09-01T12:00:00Z"),
    });
    const b = await client.append("INBOX", second.raw);
    expect(a?.uid).toBeGreaterThan(0);
    expect(b?.uid).toBe(a!.uid + 1);
    uids = [a!.uid, b!.uid];

    const status = await client.status("INBOX");
    expect(status.messages).toBeGreaterThanOrEqual(2);
    const inbox = await client.select("INBOX");
    expect(inbox.exists).toBe(status.messages);
    // Not `a`: Dovecot's first APPEND into an INBOX never opened before
    // reports a UIDVALIDITY the folder then doesn't keep.
    expect(inbox.uidValidity).toBe(b!.uidValidity);
    expect(inbox.uidNext).toBe(b!.uid + 1);
  });

  it("fetches summaries and bodies", async () => {
    const [summary] = await client.fetch([uids[0]!], {
      flags: true,
      envelope: true,
      bodyStructure: true,
      internalDate: true,
      size: true,
      headers: ["Message-ID", "References"],
      textStart: 64,
    });
    expect(summary).toMatchObject({ uid: uids[0], flags: ["\\Seen"] });
    expect(summary!.envelope).toMatchObject({
      subject: "Café ☕ first",
      from: [{ name: "Bob Björk", address: "bob@example.com" }],
      to: [{ name: "Alice", address: "alice@example.com" }],
      messageId: first.id,
    });
    expect(summary!.internalDate?.toISOString().slice(0, 10)).toBe("2026-09-01");
    // GreenMail's RFC822.SIZE counts only the body.
    expect(summary!.size).toBeGreaterThan(0);
    expect(summary!.headers?.["message-id"]).toBe(first.id);
    expect(summary!.bodyStructure?.type).toBe("multipart/mixed");
    expect(summary!.bodyStructure?.childNodes.map((node) => [node.part, node.filename])).toEqual([
      ["1", null],
      ["2", "data.bin"],
    ]);
    expect(utf8Decode(summary!.textStart!)).toContain("--b");

    const [full] = await client.fetch([uids[0]!], { source: true });
    expect(utf8Decode(full!.source!)).toBe(first.raw);
    const parsed = await parseMessage(full!.source!);
    expect(parsed.text).toContain(".a line starting with a dot");
    expect([...parsed.attachments[0]!.bytes]).toEqual([0, 1, 2, 3]);
  });

  it("stores flags and searches", async () => {
    await client.store(uids, { add: ["\\Flagged"], remove: ["\\Seen"] });
    const flags = await client.fetch(uids, { flags: true });
    for (const message of flags) {
      expect(message.flags).toContain("\\Flagged");
      expect(message.flags).not.toContain("\\Seen");
    }
    expect(await client.search({ flagged: true, uids })).toEqual(uids);
    expect(await client.search({ messageId: first.id })).toEqual([uids[0]]);
    expect(await client.search({ seen: true, uids })).toEqual([]);
  });

  it("moves, with the new UIDs", async () => {
    const before = client.mailbox!.exists;
    const moved = await client.move([uids[1]!], folder);
    expect(client.mailbox!.exists).toBe(before - 1);
    const status = await client.status(folder);
    expect(status.messages).toBe(1);
    if (moved) expect(moved.uids.get(uids[1]!)).toBeGreaterThan(0);
  });

  it("hears new mail while idling", async () => {
    const other = await connect();
    try {
      const updates: ImapUpdate[] = [];
      const idle = await client.idle((update) => updates.push(update));
      await other.append("INBOX", message("while idling").raw);
      await waitFor(async () => updates.find((u) => u.type === "exists") ?? undefined);
      await idle.stop();
      await client.noop();
    } finally {
      await other.logout();
    }
  });

  it("expunges", async () => {
    const before = client.mailbox!.exists;
    await client.store([uids[0]!], { add: ["\\Deleted"] });
    await client.expunge([uids[0]!]);
    expect(client.mailbox!.exists).toBe(before - 1);
    expect(await client.search({ uids: [uids[0]!] })).toEqual([]);
  });
}

describe.skipIf(!docker)("GreenMail", () => {
  let server: Container;
  const imap = (extra: Partial<ImapOptions> = {}): ImapOptions => ({
    host: server.host,
    port: server.port(3993),
    security: "tls",
    auth: { user: "alice@example.com", pass: "secret" },
    connect: nodeConnect,
    timeoutMs: 10_000,
    ...extra,
  });

  beforeAll(async () => {
    server = await startGreenMail();
  }, 300_000);
  afterAll(async () => {
    await server?.stop();
  });

  describe("IMAP", () => {
    imapBasics(() => connectImap(imap()), "Reçus/2026");

    it("logs in over plain text too", async () => {
      const client = await connectImap(imap({ port: server.port(3143), security: "none" }));
      expect(client.has("IDLE")).toBe(true);
      await client.logout();
    });

    it("tells a wrong password apart", async () => {
      await expect(
        connectImap(imap({ auth: { user: "alice@example.com", pass: "nope" } })),
      ).rejects.toMatchObject({ name: "ImapError", kind: "auth", status: "NO" });
    });

    it("tells an unreachable server apart", async () => {
      await expect(connectImap(imap({ port: 1 }))).rejects.toMatchObject({ kind: "network" });
    });
  });

  describe("SMTP", () => {
    it("sends, and the mail arrives", async () => {
      const sent = message("Sent over SMTP");
      for (const [port, security] of [
        [3465, "tls"],
        [3025, "none"],
      ] as const) {
        const result = await sendMail(
          {
            host: server.host,
            port: server.port(port),
            security,
            auth: { user: "bob@example.com", pass: "secret" },
            connect: nodeConnect,
          },
          { from: "bob@example.com", to: ["alice@example.com"] },
          sent.raw,
        );
        expect(result.accepted).toEqual(["alice@example.com"]);
      }

      const client = await connectImap(imap());
      try {
        await client.select("INBOX");
        const found = await client.search({ messageId: sent.id });
        expect(found).toHaveLength(2);
        const [received] = await client.fetch(found, { source: true });
        const parsed = await parseMessage(received!.source!);
        expect(parsed.text).toContain(".a line starting with a dot");
      } finally {
        await client.logout();
      }
    });

    it("tells a wrong password apart", async () => {
      await expect(
        sendMail(
          {
            host: server.host,
            port: server.port(3465),
            security: "tls",
            auth: { user: "bob@example.com", pass: "nope" },
            connect: nodeConnect,
          },
          { from: "bob@example.com", to: ["alice@example.com"] },
          "Subject: x\r\n\r\nx",
        ),
      ).rejects.toMatchObject({ name: "SmtpError", kind: "auth", code: 535 });
    });
  });
});

describe.skipIf(!docker)("Dovecot", () => {
  let server: Container;
  const imap = (extra: Partial<ImapOptions> = {}): ImapOptions => ({
    host: server.host,
    port: server.port(31143),
    security: "starttls",
    auth: { user: "ann@example.com", pass: "pass" },
    connect: nodeConnect,
    timeoutMs: 10_000,
    ...extra,
  });

  beforeAll(async () => {
    server = await startDovecot();
  }, 300_000);
  afterAll(async () => {
    await server?.stop();
  });

  describe("IMAP", () => {
    imapBasics(() => connectImap(imap()), "Reçus/2026");

    it("logs in with implicit TLS", async () => {
      const client = await connectImap(imap({ port: server.port(31993), security: "tls" }));
      expect(client.has("CONDSTORE")).toBe(true);
      await client.logout();
    });

    it("with UTF8=ACCEPT, sends folder names as UTF-8", async () => {
      const client = await connectImap(imap());
      try {
        await client.enable(["UTF8=ACCEPT"]);
        expect(client.enabled.has("UTF8=ACCEPT")).toBe(true);
        await client.createMailbox("Счета");
        expect((await client.list()).some((f) => f.path === "Счета")).toBe(true);
      } finally {
        await client.logout();
      }
      const plain = await connectImap(imap());
      expect((await plain.list()).some((f) => f.path === "Счета")).toBe(true);
      await plain.logout();
    });

    it("keeps mod-sequences: CONDSTORE and QRESYNC", async () => {
      const client = await connectImap(imap());
      try {
        await client.enable(["CONDSTORE", "QRESYNC"]);
        expect(client.enabled.has("QRESYNC")).toBe(true);
        const a = await client.append("INBOX", message("modseq a").raw);
        const b = await client.append("INBOX", message("modseq b").raw);
        const opened = await client.select("INBOX");
        const since = opened.highestModseq!;
        expect(since).toBeGreaterThan(0n);

        await client.store([a!.uid], { add: ["\\Seen"] });
        await client.store([b!.uid], { add: ["\\Deleted"] });
        await client.expunge([b!.uid]);

        const changes = await client.fetchChanges("1:*", { flags: true, modseq: true }, since);
        expect(changes.messages.map((m) => m.uid)).toEqual([a!.uid]);
        expect(changes.messages[0]!.modseq).toBeGreaterThan(since);
        expect(changes.vanished).toEqual([[b!.uid, b!.uid]]);

        const resynced = await client.select("INBOX", {
          qresync: { uidValidity: opened.uidValidity, modseq: since },
        });
        expect(resynced.vanished).toEqual([[b!.uid, b!.uid]]);
        expect(resynced.changed.map((m) => m.uid)).toEqual([a!.uid]);
      } finally {
        await client.logout();
      }
    });
  });
});
