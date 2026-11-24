import { beforeEach, describe, expect, it } from "vite-plus/test";

import { setPlatform, type Platform } from "../platform.ts";
import {
  DEMO_ID_TOKEN,
  FAKE_RELAY_URL,
  answerRelay,
  installFakeRelay,
  startSignedIn,
} from "./relay.ts";

const call = async (method: string, path: string, body?: unknown) => {
  const response = await answerRelay(
    new URL(path, FAKE_RELAY_URL),
    method,
    body === undefined ? undefined : JSON.stringify(body),
  );
  return { status: response.status, body: (await response.json().catch(() => null)) as unknown };
};

let files: Platform["files"];

beforeEach(async () => {
  const saved = new Map<string, Uint8Array | string>();
  files = {
    read: async (path: string) => {
      const data = saved.get(path);
      return typeof data === "string" ? new TextEncoder().encode(data) : (data ?? null);
    },
    write: async (path: string, data: Uint8Array | string) => void saved.set(path, data),
  } as unknown as Platform["files"];
  setPlatform({ appVersion: "1.0", deviceName: "Robin's iPad" } as Platform);
  await installFakeRelay(files);
});

describe("the made-up relay's Otter account", () => {
  it("lists this device and two others, and signs one out", async () => {
    const names = async () =>
      ((await call("GET", "/v1/auth/list-sessions")).body as { userAgent: string }[]).map((s) =>
        decodeURIComponent(s.userAgent),
      );
    expect(await names()).toEqual([
      "Otter Mail/1.0 (Robin's iPad)",
      "Otter Mail/0.13.53 (Robin's MacBook Pro)",
      "Otter Mail/1.8.0 (Robin's iPhone)",
    ]);
    await call("POST", "/v1/auth/revoke-session", { token: "demo-mac" });
    expect(await names()).toHaveLength(2);
  });

  it("signs out, and in again with the pretend Google's token only", async () => {
    await call("POST", "/v1/auth/sign-out", {});
    expect((await call("GET", "/v1/me")).status).toBe(401);
    expect(
      (await call("POST", "/v1/auth/sign-in/social", { idToken: { token: "other" } })).status,
    ).toBe(401);
    const signedIn = await answerRelay(
      new URL("/v1/auth/sign-in/social", FAKE_RELAY_URL),
      "POST",
      JSON.stringify({ provider: "google", idToken: { token: DEMO_ID_TOKEN } }),
    );
    expect(signedIn.headers.get("set-auth-token")).toBe("demo");
    expect((await call("GET", "/v1/me")).status).toBe(200);
  });

  it("ends signed out when the account is deleted, until an app with its own session starts", async () => {
    await call("POST", "/v1/auth/delete-user", {});
    expect((await call("GET", "/v1/me")).status).toBe(401);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await installFakeRelay(files);
    expect((await call("GET", "/v1/me")).status).toBe(401);
    startSignedIn();
    expect((await call("GET", "/v1/me")).status).toBe(200);
  });
});
