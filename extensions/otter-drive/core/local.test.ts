import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setPlatform, utf8Encode } from "@otter-mail/core/extension-kit";

import * as drive from "./drive.js";

const files = new Map<string, Uint8Array>();
const secrets = new Map<string, string>();
setPlatform({
  files: {
    read: async (path: string) => files.get(path) ?? null,
    write: async (path: string, data: Uint8Array | string) =>
      void files.set(path, typeof data === "string" ? utf8Encode(data) : data),
    remove: async (path: string) => void files.delete(path),
    list: async (dir: string) =>
      [...files].flatMap(([path, bytes]) =>
        path.startsWith(`${dir}/`)
          ? [{ name: path.slice(dir.length + 1), size: bytes.length, modifiedAt: 0 }]
          : [],
      ),
  },
  secrets: {
    get: async (name: string) => secrets.get(name) ?? null,
    set: async (name: string, value: string) => void secrets.set(name, value),
    delete: async (name: string) => void secrets.delete(name),
  },
} as never);

const folder = {
  id: "f1",
  name: "Mine",
  slug: "mine",
  parentId: null,
  kind: "personal",
  role: "owner",
  shared: false,
};
const notes = {
  id: "a1",
  folderId: "f1",
  slug: "notes",
  title: "Notes",
  description: "",
  updatedAt: "2026-11-01T00:00:00Z",
  archivedAt: null,
  url: "https://drive.otterware.app/a1",
  versionCount: 1,
  currentVersion: {
    number: 3,
    label: "",
    entryPath: "notes.md",
    createdAt: "2026-11-01T00:00:00Z",
    createdBy: null,
    fileCount: 1,
    byteSize: 7,
  },
};

let asked: string[] = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

beforeEach(() => {
  files.clear();
  secrets.clear();
  // A sign-in each: what's kept in memory is by sign-in.
  secrets.set("otter-drive", JSON.stringify({ token: crypto.randomUUID() }));
  asked = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url).pathname;
    asked.push(path);
    if (path === "/api/v1/folders") return Response.json({ data: [folder] });
    if (path === "/api/v1/artifacts")
      return Response.json({ data: [notes], pagination: { nextCursor: null } });
    if (path === "/api/v1/artifacts/a1/content")
      return new Response("# Hello", { headers: { "content-type": "text/markdown" } });
    return new Response(null, { status: 404 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("what this device keeps", () => {
  it("opens a listed document with one request, and again with none", async () => {
    await drive.artifacts("f1");
    asked = [];
    const shown = { kind: "markdown", text: "# Hello", truncated: false };
    expect(await drive.preview("a1", "f1")).toEqual(shown);
    expect(asked).toEqual(["/api/v1/artifacts/a1/content"]);
    await settle();
    asked = [];
    expect(await drive.preview("a1", "f1")).toEqual(shown);
    expect(asked).toEqual([]);
  });

  it("keeps the lists, and leaves out a drive turned off", async () => {
    await drive.artifacts("f1");
    await settle();
    expect((await drive.saved("artifacts", "f1"))?.data).toMatchObject([{ id: "a1" }]);
    expect((await drive.saved("folders"))?.data).toMatchObject([{ id: "f1" }]);
    await drive.setDriveHidden("f1", true);
    expect(await drive.saved("artifacts", "f1")).toBeNull();
    expect((await drive.saved("folders"))?.data).toEqual([]);
  });

  it("forgets it all on signing out", async () => {
    await drive.artifacts("f1");
    await drive.preview("a1", "f1");
    await settle();
    await drive.disconnect();
    expect(files.size).toBe(0);
  });
});
