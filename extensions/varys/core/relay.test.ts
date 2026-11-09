import type { Varys } from "@generalpursuit/varys";
import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { VarysSettings } from "./settings.js";

vi.mock("../../../packages/core/src/platform.js", () => ({
  platform: () => ({ kind: "web", appVersion: "test", log: () => {} }),
}));
const account = vi.hoisted(() => ({ user: { id: "u1" } as unknown }));
vi.mock("../../../packages/core/src/services/otter-account.js", () => ({
  getOtterUser: () => account.user,
}));
const channels = vi.hoisted(() => ({
  made: [] as string[],
  deleted: [] as string[],
}));
vi.mock("../../../packages/core/src/services/agent/channels.js", () => ({
  makeAgentChannel: async (label: string) => {
    channels.made.push(label);
    return {
      channel: { id: "ch-1", label, createdAt: 0, lastUsedAt: null },
      token: "otter_ch_secret",
      relayUrl: "https://relay.otterware.app",
    };
  },
  deleteAgentChannel: async (id: string) => void channels.deleted.push(id),
}));
const saved = vi.hoisted(() => [] as unknown[]);
vi.mock("../../../packages/core/src/services/agent/service.js", () => ({
  saveAgentSettings: async (_kind: string, change: unknown) => void saved.push(change),
}));

const { registerRelay, removeRelay, revokeGrant } = await import("./relay.js");

const relay = { set: vi.fn(), remove: vi.fn() };
const revoke = vi.fn();
const varys = { relay, revoke } as unknown as Varys;
const settings = { relayChannel: "ch-1" } as VarysSettings;

beforeEach(() => {
  channels.made = [];
  channels.deleted = [];
  saved.length = 0;
  account.user = { id: "u1" };
  relay.set.mockReset();
  relay.remove.mockReset();
  revoke.mockReset();
});

describe("varys's relay", () => {
  it("gives this device's grant a channel of the account's, so the owner copies nothing", async () => {
    relay.set.mockReturnValue(
      okAsync({
        address: "https://relay.otterware.app",
        lastDeliveredAt: null,
        lastFailure: null,
        waiting: 0,
      }),
    );
    await registerRelay(varys, "Otter on the web");
    expect(channels.made).toEqual(["varys · Otter on the web"]);
    expect(relay.set).toHaveBeenCalledWith({
      address: "https://relay.otterware.app",
      token: "otter_ch_secret",
    });
    expect(saved).toEqual([{ relayChannel: "ch-1" }]);
  });

  it("deletes the channel when varys doesn't take it, and says why", async () => {
    relay.set.mockReturnValue(
      errAsync({ code: "RELAY_REFUSED", message: "That relay isn't one varys can reach." }),
    );
    await expect(registerRelay(varys, "Otter on the web")).rejects.toThrow(
      "That relay isn't one varys can reach.",
    );
    expect(channels.deleted).toEqual(["ch-1"]);
    expect(saved).toEqual([]);
  });

  it("needs the Otter account", async () => {
    account.user = null;
    await registerRelay(varys, "Otter on the web");
    expect(channels.made).toEqual([]);
  });

  it("stops varys telling the relay and deletes the channel when the account signs out", async () => {
    relay.remove.mockReturnValue(okAsync(undefined));
    await removeRelay(varys, { ...settings });
    expect(relay.remove).toHaveBeenCalled();
    expect(channels.deleted).toEqual(["ch-1"]);
    expect(saved).toEqual([{ relayChannel: "" }]);
  });
});

describe("disconnecting", () => {
  it("ends this device's grant in varys, and deletes the channel", async () => {
    revoke.mockReturnValue(okAsync(undefined));
    expect(await revokeGrant(varys, { ...settings })).toBe(true);
    expect(revoke).toHaveBeenCalled();
    expect(relay.remove).not.toHaveBeenCalled();
    expect(channels.deleted).toEqual(["ch-1"]);
  });

  it("is done when the grant is gone already", async () => {
    revoke.mockReturnValue(errAsync({ code: "UNAUTHORIZED", message: "Sign in again." }));
    expect(await revokeGrant(varys, { ...settings })).toBe(true);
  });

  it("deletes the channel even when varys can't be reached, and says so", async () => {
    revoke.mockReturnValue(errAsync({ code: "unreachable", message: "varys doesn't answer." }));
    expect(await revokeGrant(varys, { ...settings })).toBe(false);
    expect(channels.deleted).toEqual(["ch-1"]);
  });
});
