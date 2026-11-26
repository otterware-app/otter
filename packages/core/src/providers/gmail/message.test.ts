import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setPlatform, type Platform } from "../../platform.ts";
import { errorKind, getMessage, mapMessageSummary } from "./api.ts";

let reply: { status: number; body: unknown };

beforeEach(() => {
  let current: unknown;
  setPlatform({
    google: { getAccessToken: async () => "token" },
    log: () => {},
    asyncContext: () => ({
      run: (value: unknown, fn: () => unknown) => {
        current = value;
        return fn();
      },
      get: () => current,
    }),
  } as unknown as Platform);
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify(reply.body), { status: reply.status }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const failure = () => getMessage("me@example.com", "18f0").catch((err: unknown) => err);

describe("Gmail getMessage", () => {
  it("a message Gmail no longer has is notFound", async () => {
    reply = {
      status: 404,
      body: {
        error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" },
      },
    };
    expect(errorKind(await failure())).toBe("notFound");
  });

  it("other refusals are not", async () => {
    reply = { status: 400, body: { error: { code: 400, message: "Invalid id value" } } };
    expect(errorKind(await failure())).toBeNull();
  });
});

describe("Gmail mapMessageSummary", () => {
  it("guesses attachments from a mixed multipart", () => {
    const summary = (mimeType: string) =>
      mapMessageSummary({ id: "1", threadId: "1", payload: { mimeType, headers: [] } });
    expect(summary("multipart/mixed").hasAttachments).toBe(true);
    expect(summary("multipart/alternative").hasAttachments).toBe(false);
  });
});
