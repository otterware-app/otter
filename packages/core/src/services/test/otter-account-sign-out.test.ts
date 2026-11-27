import { beforeEach, expect, it, vi } from "vite-plus/test";
import { setPlatform, type Platform } from "../../platform.ts";
import {
  getOtterUser,
  loadOtterAccount,
  relayRequest,
  signInWithSession,
  signOut,
} from "../otter-account.ts";

const user = { id: "phone-user", email: "phone@example.test", name: null, picture: null };
const saved = new Map<string, string>();

// The relay as the phone sees it: sessions, the APNs registration each holds, and whether it answers.
const relay = { online: true, sessions: new Set<string>(), devices: new Set<string>() };
const calls: string[] = [];

function fakeRelay(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (!relay.online) return Promise.reject(new TypeError("Network request failed"));
  const route = `${init?.method ?? "GET"} ${new URL(String(url)).pathname}`;
  const token = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
  calls.push(route);
  if (!relay.sessions.has(token)) return Promise.resolve(Response.json({}, { status: 401 }));
  switch (route) {
    case "GET /v1/me":
      return Promise.resolve(Response.json({ user }));
    case "PUT /v1/push/device":
      relay.devices.add(token);
      return Promise.resolve(new Response(null, { status: 204 }));
    case "DELETE /v1/push/device":
      relay.devices.delete(token);
      return Promise.resolve(new Response(null, { status: 204 }));
    case "POST /v1/auth/sign-out":
      relay.sessions.delete(token);
      relay.devices.delete(token);
      return Promise.resolve(Response.json({ success: true }));
  }
  return Promise.resolve(Response.json({}, { status: 404 }));
}

async function signInWithPush(): Promise<void> {
  relay.sessions.add("phone-session");
  await signInWithSession("phone-session");
  await relayRequest("PUT", "/v1/push/device", { token: "ab", mode: "all", mailboxes: [] });
  calls.length = 0;
}

beforeEach(async () => {
  saved.clear();
  relay.online = true;
  relay.sessions.clear();
  relay.devices.clear();
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(fakeRelay));
  setPlatform({
    kind: "mobile",
    relayUrl: "https://relay.phone.test",
    relaySession: "bearer",
    log: () => {},
    secrets: {
      get: async (name: string) => saved.get(name) ?? null,
      set: async (name: string, value: string) => void saved.set(name, value),
      delete: async (name: string) => void saved.delete(name),
    },
  } as unknown as Platform);
  await loadOtterAccount();
});

it("removes the phone's push registration before ending its session", async () => {
  await signInWithPush();
  await signOut();
  expect(calls).toEqual(["DELETE /v1/push/device", "POST /v1/auth/sign-out"]);
  expect(relay.devices.size).toBe(0);
  expect(relay.sessions.size).toBe(0);
  expect(getOtterUser()).toBeNull();
});

it("ends a session signed out offline at the next start", async () => {
  await signInWithPush();
  relay.online = false;
  await signOut();
  expect(getOtterUser()).toBeNull();
  expect(saved.has("otter-session")).toBe(false);
  expect(relay.devices.has("phone-session")).toBe(true);

  relay.online = true;
  await loadOtterAccount();
  await vi.waitFor(() => {
    expect(relay.devices.size).toBe(0);
    expect(relay.sessions.size).toBe(0);
  });
  await vi.waitFor(() => expect(saved.size).toBe(0));
  expect(getOtterUser()).toBeNull();
});
