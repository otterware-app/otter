import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { log, secrets } = vi.hoisted(() => ({
  log: vi.fn(),
  secrets: {
    get: vi.fn<() => Promise<string | null>>(async () => null),
    set: vi.fn(async (_name: string, _value: string) => {}),
    delete: vi.fn(async (_name: string) => {}),
  },
}));
vi.mock("../platform.ts", () => ({
  platform: () => ({
    log,
    kind: "mobile",
    relayUrl: "https://relay.demo.invalid",
    relaySession: "bearer",
    secrets,
  }),
}));

import { logger } from "../logger.ts";
import {
  deleteOtterAccount,
  getOtterUser,
  listDevices,
  loadOtterAccount,
  OTTER_SIGNED_OUT_MESSAGE,
  signOutDevice,
} from "./otter-account.ts";

// The demo mailbox's relay (apps/web/src/web/demo/gmail.ts): every request is a 401.
const relay = vi.fn(
  async () =>
    new Response(JSON.stringify({ error: "Demo mode has no Otter account." }), { status: 401 }),
);

describe("the Otter account, signed out", () => {
  beforeEach(async () => {
    relay.mockClear();
    vi.stubGlobal("fetch", relay);
    await loadOtterAccount();
  });

  it("says so without asking the relay", async () => {
    await expect(listDevices()).rejects.toThrow(OTTER_SIGNED_OUT_MESSAGE);
    await expect(signOutDevice("t")).rejects.toThrow(OTTER_SIGNED_OUT_MESSAGE);
    await expect(deleteOtterAccount()).rejects.toThrow(OTTER_SIGNED_OUT_MESSAGE);
    expect(relay).not.toHaveBeenCalled();
  });

  it("isn't reported as a failure", async () => {
    const error = await listDevices().catch((err: unknown) => err);
    logger.failure("handlers", "otter:listDevices failed", error);
    expect(log).toHaveBeenCalledWith("warn", "handlers", "otter:listDevices failed", error);
  });
});

describe("the Swift Otter Agents session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    secrets.get.mockResolvedValueOnce("legacy-session-token");
  });

  it("keeps the existing account and saves it in the current format", async () => {
    const user = { id: "user", email: "fixture@example.test", name: null, picture: null };
    const fetch = vi.fn(async () => Response.json({ user }));
    vi.stubGlobal("fetch", fetch);
    await loadOtterAccount();
    expect(fetch).toHaveBeenCalledWith(
      "https://relay.demo.invalid/v1/me",
      expect.objectContaining({ headers: { Authorization: "Bearer legacy-session-token" } }),
    );
    expect(getOtterUser()).toEqual(user);
    expect(secrets.set).toHaveBeenCalledWith(
      "otter-session",
      JSON.stringify({ token: "legacy-session-token", user }),
    );
  });

  it("keeps the old token on a temporary relay failure", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
    await loadOtterAccount();
    expect(getOtterUser()).toBeNull();
    expect(secrets.delete).not.toHaveBeenCalled();
    expect(secrets.set).not.toHaveBeenCalled();
  });
});
