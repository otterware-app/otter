import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const log = vi.hoisted(() => vi.fn());
vi.mock("../platform.js", () => ({
  platform: () => ({
    log,
    relayUrl: "https://relay.demo.invalid",
    relaySession: "bearer",
    secrets: { get: async () => null, set: async () => {}, delete: async () => {} },
  }),
}));

import { logger } from "../logger.js";
import {
  deleteOtterAccount,
  listDevices,
  loadOtterAccount,
  OTTER_SIGNED_OUT_MESSAGE,
  signOutDevice,
} from "./otter-account.js";

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
