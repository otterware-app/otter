import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { Platform, SqlDatabase } from "@otter/core";
import { DEMO_ACCOUNTS } from "@otter/shared/demo-mailboxes";

const EMAIL = DEMO_ACCOUNTS[0]!.email;
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

afterEach(() => vi.unstubAllGlobals());

function memoryFiles(): Platform["files"] {
  const files = new Map<string, Uint8Array>();
  return {
    read: async (path) => files.get(path) ?? null,
    write: async (path, data) => {
      files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
    },
    remove: async (path) => {
      files.delete(path);
    },
    list: async () => [],
  };
}

async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 1000; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function boot() {
  vi.resetModules();
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
  const fake = await import("@otter/core/fake");
  const core = await import("@otter/core");
  const sqlite = "node:sqlite";
  const { DatabaseSync } = (await import(/* @vite-ignore */ sqlite)) as {
    DatabaseSync: new (path: string) => SqlDatabase;
  };
  const database = new DatabaseSync(":memory:");
  const unused = () => {
    throw new Error("Not in this test.");
  };
  const platform = await fake.withFakeServices({
    kind: "web",
    appVersion: "test",
    log: () => {},
    database: () => database,
    files: memoryFiles(),
    secrets: { get: async () => null, set: async () => {}, delete: async () => {} },
    userFiles: { open: unused, save: unused, pick: unused },
    google: {} as Platform["google"],
    microsoft: {} as Platform["microsoft"],
    connect: unused,
    relayUrl: "",
    relaySession: "cookie",
    broadcast: () => {},
    notify: () => {},
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
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { webExtensions } = await import("./extensions");
  await core.startCore(platform, webExtensions);
  const invoke = <T>(channel: string, params?: unknown) =>
    core.registeredHandlers().get(channel)!(params) as Promise<T>;
  const gmail = (path: string, init: RequestInit = {}) =>
    fetch(`${GMAIL}${path}`, { ...init, headers: { Authorization: `Bearer demo:${EMAIL}` } });
  return { core, invoke, gmail };
}

describe("core's Gmail provider on the made-up mailbox", { timeout: 20_000 }, () => {
  it("a write to a message deleted elsewhere drops it instead of failing", async () => {
    const { core, invoke, gmail } = await boot();
    const inbox = () => core.mailStore.getMessageIdsForLabel(EMAIL, "INBOX");
    await until(() => inbox().length > 0, "initial mailbox");
    const gone = inbox()[0]!;
    expect((await gmail(`/messages/${gone}`, { method: "DELETE" })).status).toBe(204);

    await invoke("gmail:modifyMessage", {
      accountId: EMAIL,
      messageId: gone,
      removeLabelIds: ["UNREAD"],
    });
    expect(inbox()).not.toContain(gone);

    await expect(
      invoke("gmail:modifyMessage", {
        accountId: EMAIL,
        messageId: inbox()[0],
        addLabelIds: ["NO_SUCH_LABEL"],
      }),
    ).rejects.toThrow(/400/);
  });

  it("deleting a draft already deleted elsewhere succeeds", async () => {
    const { invoke, gmail } = await boot();
    const draft = await invoke<{ draftId: string }>("gmail:saveDraft", {
      accountId: EMAIL,
      to: EMAIL,
      subject: "Deleted elsewhere",
      body: "Gone",
    });
    expect((await gmail(`/drafts/${draft.draftId}`, { method: "DELETE" })).status).toBe(204);

    await expect(
      invoke("gmail:deleteDraft", { accountId: EMAIL, draftId: draft.draftId }),
    ).resolves.toEqual({ ok: true });
  });
});
