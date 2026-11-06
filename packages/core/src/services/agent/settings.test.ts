import { beforeEach, expect, it, vi } from "vite-plus/test";

const secrets = new Map<string, string>();
vi.mock("../../platform.js", () => ({
  platform: () => ({
    secrets: {
      get: async (name: string) => secrets.get(name) ?? null,
      set: async (name: string, value: string) => void secrets.set(name, value),
      delete: async (name: string) => void secrets.delete(name),
    },
  }),
}));

const settings = await import("./settings");

beforeEach(() => secrets.clear());

it("moves the Swift app's Hermes key to its name in core", async () => {
  secrets.set("hermes-key", "hermes-secret");
  expect(await settings.getHermesKey()).toBe("hermes-secret");
  expect(secrets.get("assistant-hermes-key")).toBe("hermes-secret");
  expect(secrets.has("hermes-key")).toBe(false);
});

it("prefers core's Hermes key over the Swift app's", async () => {
  secrets.set("assistant-hermes-key", "new");
  secrets.set("hermes-key", "old");
  expect(await settings.getHermesKey()).toBe("new");
  expect(secrets.get("hermes-key")).toBe("old");
  await settings.clearHermesKey();
  expect(await settings.getHermesKey()).toBe("");
});

it("moves the Swift app's OpenClaw gateway token", async () => {
  secrets.set("openclaw-token", "gateway");
  expect(await settings.getOpenClawToken()).toBe("gateway");
  expect(secrets.get("openclaw-gateway-token")).toBe("gateway");
  expect(secrets.has("openclaw-token")).toBe(false);
});

it("joins the Swift app's bare device token with its scopes", async () => {
  secrets.set("openclaw-device-token", "device");
  secrets.set("openclaw-device-scopes", "operator.read,operator.write");
  const record = { token: "device", scopes: ["operator.read", "operator.write"] };
  expect(JSON.parse(await settings.getOpenClawDeviceToken())).toEqual(record);
  expect(JSON.parse(secrets.get("openclaw-device-token")!)).toEqual(record);
  expect(secrets.has("openclaw-device-scopes")).toBe(false);
});

it("gives a bare device token without scopes none, and leaves a record alone", async () => {
  secrets.set("openclaw-device-token", "device");
  expect(JSON.parse(await settings.getOpenClawDeviceToken())).toEqual({
    token: "device",
    scopes: [],
  });
  const record = JSON.stringify({ token: "other", scopes: ["operator.read"] });
  secrets.set("openclaw-device-token", record);
  expect(await settings.getOpenClawDeviceToken()).toBe(record);
});
