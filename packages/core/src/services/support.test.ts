import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixtures = vi.hoisted(() => ({
  accounts: vi.fn(),
  settings: vi.fn(),
  environment: vi.fn(),
  sync: vi.fn(),
}));
vi.mock("../platform.ts", () => ({
  platform: () => ({ kind: "web", appVersion: "0.5.13", supportDiagnostics: fixtures.environment }),
}));
vi.mock("./account-store.ts", () => ({ listAccounts: fixtures.accounts }));
vi.mock("./settings-store.ts", () => ({ getSettings: fixtures.settings }));
vi.mock("./mail-sync.ts", () => ({
  getSyncStatus: fixtures.sync,
  turnedOffMailboxes: () => new Set(["private-imap-id"]),
}));
vi.mock("../providers/index.ts", () => ({ isSignedIn: () => true }));

const { collectSupportDiagnostics } = await import("./support.ts");
const { recordSupportError } = await import("./support-errors.ts");

beforeEach(() => {
  fixtures.accounts.mockResolvedValue([
    {
      id: "private-gmail-id",
      provider: "gmail",
      email: "private@gmail.example",
      displayName: "Private Person",
      signature: "Private signature",
    },
    {
      id: "private-imap-id",
      provider: "imap",
      email: "private@imap.example",
      imap: { username: "Private username", password: "SECRET_PASSWORD", host: "private.host" },
    },
  ]);
  fixtures.settings.mockResolvedValue({
    syncIntervalSeconds: 60,
    extraPrivateField: "Private settings",
  });
  fixtures.environment.mockResolvedValue({ environment: "Test Browser" });
  fixtures.sync.mockReturnValue({
    syncing: false,
    phase: "idle",
    synced: 42,
    total: 100,
    lastSyncAt: 1_000,
    fullSyncDone: true,
    error: "HTTP 429 rate limited for private@gmail.example SECRET_TOKEN",
    accountId: "private-gmail-id",
    body: "Private mail",
    historyId: "PRIVATE_HISTORY",
  });
});

describe("support snapshot", () => {
  it("reads only diagnostic fields from real-shaped account and sync metadata", async () => {
    recordSupportError(
      "error",
      "mail-sync",
      "sync failed for private@gmail.example: HTTP 429 SECRET_TOKEN",
      { body: "Private mail" },
    );
    const snapshot = await collectSupportDiagnostics();
    expect(
      snapshot.mailboxes.map(({ mailbox, provider, enabled }) => ({ mailbox, provider, enabled })),
    ).toEqual([
      { mailbox: "Mailbox 1", provider: "gmail", enabled: true },
      { mailbox: "Mailbox 2", provider: "imap", enabled: false },
    ]);
    expect(snapshot.mailboxes[0]?.sync?.error).toBe("rate limit");
    expect(snapshot.errors.at(-1)?.httpStatus).toBe(429);
    expect(snapshot.syncIntervalSeconds).toBe(60);
    const exported = JSON.stringify(snapshot);
    for (const privateValue of [
      "private-gmail-id",
      "private-imap-id",
      "private@",
      "Private",
      "SECRET",
      "private.host",
      "PRIVATE_HISTORY",
    ])
      expect(exported).not.toContain(privateValue);
  });

  it("reads a tagged failure's error, not the wrapper around it", async () => {
    recordSupportError("error", "handlers", "gmail:listLabels failed", {
      error: new Error("HTTP 503 from the server"),
      tags: { provider: "imap", server: "other" },
    });
    expect((await collectSupportDiagnostics()).errors.at(-1)?.httpStatus).toBe(503);
  });

  it("still prepares app details when metadata or the cache cannot be read", async () => {
    fixtures.sync.mockImplementation(() => {
      throw new Error("Private database error");
    });
    fixtures.settings.mockRejectedValue(new Error("Private settings failure"));
    fixtures.environment.mockRejectedValue(new Error("Private environment failure"));
    const snapshot = await collectSupportDiagnostics();
    expect(snapshot.version).toBe("0.5.13");
    expect(snapshot.mailboxes.every((mailbox) => mailbox.sync === null)).toBe(true);
    expect(snapshot.unavailable).toContain("Mailbox 1 sync status");
    expect(snapshot.syncIntervalSeconds).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain("Private");
  });
});
