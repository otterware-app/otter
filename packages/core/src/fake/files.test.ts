import { describe, expect, it } from "vite-plus/test";

import { fromBase64 } from "../bytes.ts";
import { readFakeFile } from "./files.ts";

describe("the made-up agents' files", () => {
  it("answers by what is asked, without a link's line", () => {
    expect(readFakeFile("notes/q4-agenda.md")).toMatchObject({ mimeType: "text/markdown" });
    const code = readFakeFile("scripts/headcount.py:13");
    expect(code.name).toBe("headcount.py");
    const lines = new TextDecoder().decode(fromBase64(code.data)).split("\n");
    expect(lines.length).toBeGreaterThan(30);
    expect(lines[12]).toContain("overhead");
  });

  it("draws a picture, cuts nothing itself, and refuses what's outside the workspace", () => {
    const image = fromBase64(readFakeFile("headcount-chart.bmp").data);
    expect([...image.subarray(0, 2)]).toEqual([0x42, 0x4d]);
    expect(readFakeFile("logs/sync.log").size).toBeGreaterThan(1024 * 1024);
    expect(readFakeFile("exports/board-deck.key").mimeType).toMatch(/keynote/);
    expect(() => readFakeFile("/tmp/scratch.txt")).toThrow(/outside the agent's workspace/);
  });
});
