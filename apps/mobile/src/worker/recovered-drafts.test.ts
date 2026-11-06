import { describe, expect, it } from "vite-plus/test";

import {
  importRecoveredDrafts,
  parseRecoveredDraft,
  recoveryNamespace,
  type RecoveryIO,
} from "./recovered-drafts";

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const utf8 = (text: string) => new TextEncoder().encode(text);

/** What the Swift app's JSONEncoder writes for a RecoveredDraft (DraftFiles.swift, Draft.swift). */
const swiftJson = (draft: Record<string, unknown>, updated = 784_000_000) =>
  JSON.stringify({
    draft: { to: "", cc: "", bcc: "", files: [], subject: "", body: "", ...draft },
    updated,
  });

function fakeIO(entries: Record<string, string>, files: Record<string, string> = {}) {
  const saved: Record<string, unknown>[] = [];
  const done = new Set<string>();
  const io: RecoveryIO & { saved: typeof saved; doneIds: typeof done } = {
    saved,
    doneIds: done,
    entries: async () => Object.entries(entries).map(([name, text]) => ({ name, text })),
    localFile: async (file, filename) => {
      const text = files[`${file}/${filename}`];
      return text === undefined ? null : new TextEncoder().encode(text);
    },
    originalFile: async (accountId, messageId, attachmentId) =>
      new TextEncoder().encode(`${accountId}:${messageId}:${attachmentId}`),
    signedIn: async () => new Map([["me@example.com", "me@example.com"]]),
    saveDraft: async (params) => {
      saved.push(params);
      return { draftId: `d${saved.length}` };
    },
    done: async () => new Set(done),
    markDone: async (ids) => ids.forEach((id) => done.add(id)),
  };
  return io;
}

describe("recovered drafts", () => {
  it("reads the Swift app's JSON and ignores what isn't a draft", () => {
    const entry = parseRecoveredDraft(
      swiftJson({ id: "A", from: "me@example.com", subject: "Hi", address: "Alias@example.com" }),
    );
    expect(entry?.draft).toMatchObject({ id: "A", from: "me@example.com", subject: "Hi" });
    expect(parseRecoveredDraft("{")).toBeNull();
    expect(parseRecoveredDraft(JSON.stringify({ draft: { id: "B" } }))).toBeNull();
  });

  it("names the namespace as Session.swift does", () => {
    expect(recoveryNamespace("user/1?", toBase64)).toBe(
      toBase64(utf8("user/1?")).replaceAll("/", "_"),
    );
  });

  it("saves each as a draft once, with its attachments, and keeps waiting ones", async () => {
    const io = fakeIO(
      {
        "a.json": swiftJson(
          {
            id: "A",
            from: "Me@example.com",
            address: "alias@example.com",
            to: "you@example.com",
            subject: "Plans",
            body: "See attached",
            threadID: "t1",
            files: [
              { id: "f1", filename: "notes.txt", mimeType: "text/plain", size: 5, file: "F1" },
              {
                id: "f2",
                filename: "old.pdf",
                mimeType: "application/pdf",
                size: 3,
                original: { id: "att", filename: "old.pdf", mimeType: "application/pdf", size: 3 },
                messageID: "m0",
              },
            ],
          },
          2,
        ),
        "b.json": swiftJson({ id: "B", from: "other@example.com", body: "Later" }, 1),
        "c.json": swiftJson({ id: "C", from: "me@example.com" }, 3),
      },
      { "F1/notes.txt": "hello" },
    );

    const first = await importRecoveredDrafts(io, toBase64);
    expect(first).toEqual({ imported: ["A"], waiting: ["B"], failed: [] });
    expect(io.saved).toEqual([
      {
        accountId: "me@example.com",
        from: "alias@example.com",
        to: "you@example.com",
        cc: "",
        bcc: "",
        subject: "Plans",
        body: "See attached",
        threadId: "t1",
        attachments: [
          { name: "notes.txt", mimeType: "text/plain", size: 5, base64: toBase64(utf8("hello")) },
          {
            name: "old.pdf",
            mimeType: "application/pdf",
            size: 21,
            base64: toBase64(utf8("me@example.com:m0:att")),
          },
        ],
      },
    ]);
    // The empty one is done too, so neither is looked at again.
    expect([...io.doneIds].sort()).toEqual(["A", "C"]);

    const again = await importRecoveredDrafts(io, toBase64);
    expect(again).toEqual({ imported: [], waiting: ["B"], failed: [] });
    expect(io.saved).toHaveLength(1);
  });

  it("saves one that was editing a draft as a draft of its own, never over it", async () => {
    // No revision in the file: a newer edit of that draft (an Outlook draft keeps its id) can't be told apart.
    const io = fakeIO({
      "a.json": swiftJson({
        id: "A",
        from: "me@example.com",
        body: "x",
        threadID: "t1",
        messageID: "m-draft",
      }),
    });
    expect(await importRecoveredDrafts(io, toBase64)).toEqual({
      imported: ["A"],
      waiting: [],
      failed: [],
    });
    expect(io.saved).toHaveLength(1);
    expect(io.saved[0]).toMatchObject({ body: "x", threadId: "t1" });
    expect(io.saved[0]).not.toHaveProperty("draftId");
    expect(io.saved[0]).not.toHaveProperty("expectMessageId");
  });

  it("leaves one whose attachment is missing to try again", async () => {
    const io = fakeIO({
      "a.json": swiftJson({
        id: "A",
        from: "me@example.com",
        files: [{ id: "f", filename: "gone.txt", mimeType: "text/plain", size: 1, file: "X" }],
      }),
    });
    expect(await importRecoveredDrafts(io, toBase64)).toEqual({
      imported: [],
      waiting: [],
      failed: ["A"],
    });
    expect(io.doneIds.size).toBe(0);
  });
});
