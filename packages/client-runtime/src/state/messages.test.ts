import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import type { MessageSummary } from "../mail.ts";
import { makeMailOperations, threadChange, without } from "../operations/index.ts";
import { fakeCore, settle } from "../testing.ts";
import { makeThreadLists, type ThreadListKey } from "./messages.ts";

const row = (id: string, labelIds = ["INBOX"]): MessageSummary => ({
  id,
  threadId: `t${id}`,
  fromName: "",
  fromEmail: "a@example.com",
  to: "",
  subject: id,
  snippet: "",
  date: 0,
  unread: labelIds.includes("UNREAD"),
  starred: false,
  labelIds,
  hasAttachments: false,
});

/** A mailbox of `count` inbox rows, served 2 to a page. */
function mailbox(count: number) {
  let rows = Array.from({ length: count }, (_, i) => row(String(i + 1)));
  const fake = fakeCore({
    "gmail:listMessages": ({ pageToken }: { pageToken?: string }) => {
      const start = Number(pageToken ?? 0);
      return {
        messages: rows.slice(start, start + 2),
        ...(start + 2 < rows.length ? { nextPageToken: String(start + 2) } : {}),
      };
    },
    "gmail:modifyThread": ({ threadId, removeLabelIds }) => {
      rows = rows.map((r) =>
        r.threadId === threadId
          ? { ...r, labelIds: r.labelIds.filter((l) => !removeLabelIds.includes(l)) }
          : r,
      );
      rows = rows.filter((r) => r.labelIds.includes("INBOX"));
    },
  });
  const registry = AtomRegistry.make();
  const lists = makeThreadLists(registry, { core: fake.core, pageSize: 2, retries: 0 });
  lists.start();
  return { fake, registry, lists, setRows: (next: MessageSummary[]) => (rows = next) };
}

const INBOX: ThreadListKey = { accountId: "me", labelId: "INBOX" };
const ids = (m: ReturnType<typeof mailbox>, key = INBOX) =>
  m.registry.get(m.lists.listAtom(key)).pages.flatMap((p) => p.messages.map((r) => r.id));

describe("thread lists", () => {
  it("loads when shown and pages by cursor", async () => {
    const m = mailbox(5);
    expect(m.registry.get(m.lists.listAtom(INBOX)).isLoading).toBe(false);
    m.lists.show(INBOX);
    expect(m.registry.get(m.lists.listAtom(INBOX)).isLoading).toBe(true);
    await settle();
    expect(ids(m)).toEqual(["1", "2"]);
    expect(m.registry.get(m.lists.listAtom(INBOX)).hasNextPage).toBe(true);
    await m.lists.fetchNextPage(INBOX);
    await m.lists.fetchNextPage(INBOX);
    expect(ids(m)).toEqual(["1", "2", "3", "4", "5"]);
    expect(m.registry.get(m.lists.listAtom(INBOX)).hasNextPage).toBe(false);
    expect(m.fake.called("gmail:listMessages").map((c) => c.params.pageToken)).toEqual([
      undefined,
      "2",
      "4",
    ]);
  });

  it("reloads every page it had when core's mail changes, once per turn", async () => {
    const m = mailbox(4);
    m.lists.show(INBOX);
    await settle();
    await m.lists.fetchNextPage(INBOX);
    m.fake.calls.length = 0;
    m.setRows([row("9"), row("1"), row("2"), row("3")]);
    m.fake.emit("gmail:mail-changed");
    m.lists.invalidate("me");
    await settle();
    await settle();
    expect(m.fake.called("gmail:listMessages").map((c) => c.params.pageToken)).toEqual([
      undefined,
      "2",
    ]);
    expect(ids(m)).toEqual(["9", "1", "2", "3"]);
  });

  it("shows an overlay until the write fails", async () => {
    const m = mailbox(3);
    m.lists.show(INBOX);
    await settle();
    const overlay = m.lists.overlay(
      "me",
      without((r) => r.id === "1"),
    );
    expect(ids(m)).toEqual(["2"]);
    overlay.drop();
    expect(ids(m)).toEqual(["1", "2"]);
  });

  it("keeps a settled overlay until each list it covered loads again", async () => {
    const m = mailbox(3);
    const archive: ThreadListKey = { accountId: "me", labelId: "ARCHIVE" };
    m.lists.show(INBOX);
    const hide = m.lists.show(archive);
    await settle();
    hide();
    const overlay = m.lists.overlay(
      "me",
      without((r) => r.id === "1"),
    );
    overlay.settle();
    // Core still lists it until the write lands: the overlay holds.
    expect(ids(m)).toEqual(["2"]);
    expect(ids(m, archive)).toEqual(["2"]);
    m.setRows([row("2"), row("3")]);
    await settle();
    await settle();
    expect(ids(m)).toEqual(["2", "3"]);
    // Not shown, not reloaded: still covered.
    expect(ids(m, archive)).toEqual(["2"]);
    m.lists.show(archive);
    await settle();
    expect(ids(m, archive)).toEqual(["2", "3"]);
  });

  it("takes an archived thread off the inbox but not off All Mail", async () => {
    const m = mailbox(2);
    const allMail: ThreadListKey = { accountId: "me", labelId: "ALL_MAIL" };
    m.lists.show(INBOX);
    m.lists.show(allMail);
    await settle();
    m.lists.overlay(
      "me",
      threadChange({ accountId: "me", threadId: "t1", removeLabelIds: ["INBOX"] }),
    );
    expect(ids(m)).toEqual(["2"]);
    const archived = m.registry
      .get(m.lists.listAtom(allMail))
      .pages[0].messages.find((r) => r.id === "1");
    expect(archived?.labelIds).toEqual([]);
  });
});

describe("mail operations", () => {
  const setup = () => {
    const m = mailbox(3);
    const errors: unknown[] = [];
    const ops = makeMailOperations({
      core: m.fake.core,
      threadLists: m.lists,
      archiveFolder: () => false,
      onError: (error) => errors.push(error),
    });
    return { ...m, ops, errors };
  };

  it("archives at once, and undo brings the thread back", async () => {
    const m = setup();
    m.lists.show(INBOX);
    await settle();
    const archived = m.ops.archiveThread("me", "t1", "INBOX");
    expect(ids(m)).toEqual(["2"]);
    await archived;
    await settle();
    await settle();
    expect(ids(m)).toEqual(["2", "3"]);
    m.fake.answers["gmail:modifyThread"] = ({ threadId, addLabelIds }) => {
      m.setRows([{ ...row(threadId.slice(1)), labelIds: addLabelIds }, row("2"), row("3")]);
    };
    expect(await m.ops.undo()).toBe(true);
    expect(m.fake.called("gmail:modifyThread").at(-1)?.params).toEqual({
      accountId: "me",
      threadId: "t1",
      addLabelIds: ["INBOX"],
      removeLabelIds: [],
    });
    await settle();
    await settle();
    expect(ids(m)).toEqual(["1", "2"]);
  });

  it("puts the row back and reports when the write fails", async () => {
    const m = setup();
    m.lists.show(INBOX);
    await settle();
    m.fake.answers["gmail:modifyThread"] = () => {
      throw new Error("Gmail API error: 500");
    };
    await expect(m.ops.archiveThread("me", "t1", "INBOX")).rejects.toThrow("500");
    expect(ids(m)).toEqual(["1", "2"]);
    expect(m.errors).toHaveLength(1);
  });

  it("keeps the change when the bridge times out (core finishes it)", async () => {
    const m = setup();
    m.lists.show(INBOX);
    await settle();
    m.fake.answers["gmail:modifyThread"] = () => {
      throw new Error("Request timeout");
    };
    await m.ops.archiveThread("me", "t1", "INBOX");
    expect(ids(m)).toEqual(["2"]);
    expect(m.errors).toHaveLength(0);
  });
});
