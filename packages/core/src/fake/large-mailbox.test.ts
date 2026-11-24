import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { DEMO_ACCOUNTS } from "@otter/shared/demo-mailboxes";
import type { Platform } from "../platform.ts";
import { installFakeGmail } from "./gmail.ts";
import { generatedBody, generatedOpening, largeMailbox } from "./large-mailbox.ts";

const EMAIL = DEMO_ACCOUNTS[0]!.email;
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const me = { name: "Me", email: "me@example.com" };

function memoryFiles(): Platform["files"] & { text(path: string): string } {
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
    text: (path) => new TextDecoder().decode(files.get(path)),
  };
}

async function gmail(path: string, init: RequestInit = {}) {
  const response = await fetch(`${GMAIL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer demo:${EMAIL}` },
  });
  return (response.status === 204 ? {} : await response.json()) as Record<string, any>;
}

afterEach(() => vi.unstubAllGlobals());

describe("largeMailbox", () => {
  const messages = largeMailbox(5000, "19a", me, ["Label_1"], 1_700_000_000_000);

  it("is the same every time, its threads whole", () => {
    expect(largeMailbox(5000, "19a", me, ["Label_1"], 1_700_000_000_000)).toEqual(messages);
    expect(new Set(messages.map((m) => m.id)).size).toBe(5000);
    const ids = new Set(messages.map((m) => m.id));
    expect(messages.every((m) => ids.has(m.threadId))).toBe(true);
    expect(new Set(messages.map((m) => m.threadId)).size).toBeLessThan(4000);
  });

  it("writes a body from its message, starting as its snippet does", () => {
    for (const m of messages.slice(0, 300)) {
      const body = generatedBody(m);
      expect(generatedBody(m)).toEqual(body);
      expect(body.text.startsWith(generatedOpening(m))).toBe(true);
    }
  });
});

describe("the fake Gmail", () => {
  it("saves only a generated message's labels, and keeps them", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    const files = memoryFiles();
    await installFakeGmail(files, { messages: 1000 });

    const first = await gmail("/messages?maxResults=500");
    expect(first.messages).toHaveLength(500);
    const second = await gmail(`/messages?maxResults=500&pageToken=${first.nextPageToken}`);
    expect(second.messages.length).toBeGreaterThan(500 - 50);
    const { id } = first.messages.find((m: { id: string }) => m.id.startsWith("190f"));
    const full = await gmail(`/messages/${id}?format=full`);
    expect(JSON.stringify(full.payload)).toContain('"mimeType":"text/html"');

    const { historyId } = await gmail("/profile");
    await gmail(`/messages/${id}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: ["STARRED"] }),
    });
    await gmail(`/messages/${id}/modify`, {
      method: "POST",
      body: JSON.stringify({ removeLabelIds: ["STARRED"] }),
    });
    const page = await gmail(`/history?startHistoryId=${historyId}&maxResults=1`);
    expect(page.history).toHaveLength(1);
    expect((await gmail(`/history?startHistoryId=${historyId}&pageToken=1`)).history).toHaveLength(
      1,
    );
    await gmail(`/messages/${id}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: ["STARRED"] }),
    });
    await new Promise((resolve) => setTimeout(resolve, 250));

    const saved = JSON.parse(files.text("demo-gmail.json"));
    expect(saved.mailboxes[EMAIL].messages[id]).toEqual({
      generated: expect.any(Number),
      labelIds: expect.arrayContaining(["STARRED"]),
    });
    await installFakeGmail(files, { messages: 1000 });
    expect((await gmail(`/messages/${id}?format=full`)).labelIds).toContain("STARRED");
  });

  it("saves the seed alone as it always has", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    const files = memoryFiles();
    await installFakeGmail(files);
    expect(files.text("demo-gmail.json")).not.toContain('"generated"');
  });
});
