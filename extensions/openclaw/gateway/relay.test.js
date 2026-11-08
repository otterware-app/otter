import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { RELAY_KEY_FILE, relayKey } from "./relay.js";

describe("the browser relay's key", () => {
  it("is the one OpenClaw keeps, or made as OpenClaw makes it", async () => {
    const dir = path.join(await mkdtemp(path.join(tmpdir(), "otter-relay-")), "credentials");
    const made = await relayKey(dir);
    expect(made).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(path.join(dir, RELAY_KEY_FILE), "utf8")).toBe(`${made}\n`);
    expect((await stat(path.join(dir, RELAY_KEY_FILE))).mode & 0o777).toBe(0o600);
    expect(await relayKey(dir)).toBe(made);

    await writeFile(path.join(dir, RELAY_KEY_FILE), "not a key\n");
    await expect(relayKey(dir)).rejects.toThrow(/isn't one OpenClaw made/);
  });
});
