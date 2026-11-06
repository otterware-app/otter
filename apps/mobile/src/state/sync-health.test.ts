import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./core", () => ({ core: {} }));
vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));

import { lostSignIn, namedRelative, syncLine } from "./sync-health";

const now = Date.UTC(2026, 10, 6, 12);
const ago = (minutes: number) => now - minutes * 60_000;
const health = (fields: Partial<Parameters<typeof syncLine>[0] & object>) => ({
  syncing: false,
  lastSyncAt: null,
  error: null,
  signInNeeded: false,
  ...fields,
});

describe("the sync health line", () => {
  it("says when it last synced", () => {
    expect(syncLine(undefined, now)).toEqual({ text: "Syncing…", warning: false });
    expect(syncLine(health({ lastSyncAt: ago(0.5) }), now).text).toBe("Synced just now");
    expect(syncLine(health({ lastSyncAt: ago(5) }), now).text).toBe("Synced 5 minutes ago");
    expect(syncLine(health({ lastSyncAt: ago(60) }), now).text).toBe("Synced 1 hour ago");
    expect(syncLine(health({ lastSyncAt: ago(26 * 60) }), now).text).toBe("Synced yesterday");
  });

  it("warns of a failure until a sync runs again", () => {
    const failed = health({ lastSyncAt: ago(5), error: "Can't connect" });
    expect(syncLine(failed, now)).toEqual({ text: "Can't connect — will retry", warning: true });
    expect(syncLine({ ...failed, syncing: true }, now).warning).toBe(false);
  });

  it("names relative times as SwiftUI does", () => {
    expect(namedRelative(ago(1), now)).toBe("1 minute ago");
    expect(namedRelative(ago(3 * 24 * 60), now)).toBe("3 days ago");
    expect(namedRelative(ago(8 * 24 * 60), now)).toBe("last week");
  });
});

describe("a lost sign-in", () => {
  const mailbox = { id: "a@b.c", email: "a@b.c" };
  it("is a mailbox that synced here, then was signed out or refused", () => {
    expect(lostSignIn({ ...mailbox, signedOut: true }, health({ lastSyncAt: ago(10) }))).toBe(true);
    expect(lostSignIn(mailbox, health({ lastSyncAt: ago(10), signInNeeded: true }))).toBe(true);
  });
  it("isn't one added elsewhere and never signed in here", () => {
    expect(lostSignIn({ ...mailbox, signedOut: true }, health({}))).toBe(false);
    expect(lostSignIn(mailbox, health({ lastSyncAt: ago(10) }))).toBe(false);
  });
});
