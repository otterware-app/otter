import { connectImap, type ImapClient } from "@otter-mail/core/imap";
import { afterEach, expect, it } from "vite-plus/test";

import { connectDemoImap, DEMO_IMAP } from "./demo-imap";

let client: ImapClient | null = null;
afterEach(() => client?.close());

const connect = async () =>
  (client = await connectImap({
    host: DEMO_IMAP.imap.imap.host,
    port: 993,
    security: "tls",
    auth: { user: DEMO_IMAP.email, pass: "demo" },
    connect: async () => connectDemoImap(),
  }));

it("serves the demo's folders, with their special uses", async () => {
  const folders = await (await connect()).list();
  expect(folders.map((f) => f.path)).toEqual(
    expect.arrayContaining(["INBOX", "Archive", "Sent Messages", "Deleted Messages", "Receipts"]),
  );
  expect(folders.find((f) => f.path === "Sent Messages")?.specialUse).toBe("\\Sent");
});

it("serves summaries core can file under their alias mailboxes", async () => {
  const imap = await connect();
  await imap.select("INBOX");
  const uids = await imap.search({ since: new Date(0) });
  expect(uids.length).toBeGreaterThan(1);
  const messages = await imap.fetch(uids, {
    flags: true,
    envelope: true,
    bodyStructure: true,
    internalDate: true,
    headers: ["References", "Original-Recipient"],
    textStart: 200,
  });
  const openDay = messages.filter((m) => m.envelope?.subject === "Studio open day: save the date");
  expect(openDay).toHaveLength(2);
  expect(openDay[0]!.envelope?.from[0]).toEqual({
    name: "Inês Duarte",
    address: "ines@duarte.example",
  });
  expect(openDay.map((m) => m.headers?.["original-recipient"])).toEqual([
    "rfc822;mail@robinotter.example",
    "rfc822;me@robinotter.example",
  ]);
  expect(openDay[0]!.flags).not.toContain("\\Seen");
  expect(openDay[0]!.bodyStructure?.type).toBe("text/plain");
  expect(new TextDecoder().decode(openDay[0]!.textStart)).toContain("The open day is on the 14th");
});

it("serves the source, keeps flags and moves mail between connections", async () => {
  const imap = await connect();
  await imap.select("INBOX");
  const [uid] = await imap.search({ since: new Date(0) });
  const [message] = await imap.fetch([uid!], { source: true, flags: true, envelope: true });
  expect(new TextDecoder().decode(message!.source)).toMatch(/^From: /);

  await imap.store([uid!], { remove: ["\\Seen"], add: ["\\Flagged"] });
  await imap.move([uid!], "Archive");
  imap.close();

  const again = await connect();
  await again.select("Archive");
  const archived = await again.fetch("1:*", { flags: true, envelope: true });
  const moved = archived.find((m) => m.envelope?.messageId === message!.envelope?.messageId);
  expect(moved?.flags).toEqual(["\\Flagged"]);
});
