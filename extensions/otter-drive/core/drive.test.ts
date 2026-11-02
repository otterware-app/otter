import { describe, expect, it } from "vite-plus/test";

import { documentKind, emailPage, slugFor } from "./drive.js";

describe("slugFor", () => {
  it("makes a valid Otter Drive slug with a random tail", () => {
    const slug = slugFor("Q3 Report — Final (v2).xlsx");
    expect(slug).toMatch(/^q3-report-final-v2-xlsx-[a-z0-9]{3}$/);
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("falls back when the title has no letters or digits", () => {
    expect(slugFor("—")).toMatch(/^email-[a-z0-9]{3}$/);
  });

  it("stays within Otter Drive's 80 characters", () => {
    expect(slugFor("a".repeat(300)).length).toBeLessThanOrEqual(80);
  });
});

describe("emailPage", () => {
  it("escapes a text body and the subject", () => {
    const page = emailPage("<Hi>", null, "a < b & c");
    expect(page).toContain("<title>&lt;Hi&gt;</title>");
    expect(page).toContain("a &lt; b &amp; c");
  });
});

describe("documentKind", () => {
  it("shows each file the way Otter Drive does", () => {
    expect(documentKind("text/markdown", "README.md")).toBe("markdown");
    expect(documentKind("text/plain", "notes.txt")).toBe("text");
    expect(documentKind("text/csv", "q3.csv")).toBe("table");
    expect(documentKind("application/octet-stream", "q3.tsv")).toBe("table");
    expect(
      documentKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "q3"),
    ).toBe("workbook");
    expect(documentKind("video/mp4", "CleanShot.mp4")).toBe("video");
    expect(documentKind("application/octet-stream", "clip.mov")).toBe("video");
    expect(documentKind("image/png", "chart.png")).toBe("image");
  });

  it("frames the rest: pages, sites, PDFs, audio", () => {
    expect(documentKind("text/html; charset=utf-8", "index.html")).toBe("frame");
    expect(documentKind("application/pdf", "deck.pdf")).toBe("frame");
    expect(documentKind("audio/mpeg", "memo.mp3")).toBe("frame");
  });
});
