import { describe, expect, it } from "vite-plus/test";

import * as XLSX from "@e965/xlsx";

import { delimited, documentKind, emailPage, patchWorkbook, slugFor } from "./drive.js";
import { parseDelimited } from "../ui/table.js";

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

describe("delimited", () => {
  it("quotes only the cells that need it, and reads back the same", () => {
    const rows = [
      ["name", "note"],
      ["Ada", 'said "hi", then left'],
      ["Bob", "two\nlines"],
    ];
    const csv = delimited(rows, ",");
    expect(csv).toBe('name,note\r\nAda,"said ""hi"", then left"\r\nBob,"two\nlines"');
    expect(parseDelimited(csv, ",")).toEqual(rows);
  });

  it("quotes a tab in a TSV cell", () => {
    expect(delimited([["a\tb", "c"]], "\t")).toBe('"a\tb"\tc');
  });
});

describe("patchWorkbook", () => {
  it("rewrites only the cells that changed, keeping the others' types and formats", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["code", "amount", "note"],
      ["00123", 1234.5, "old"],
    ]);
    ws.B2!.z = "#,##0.00";
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, "Data");
    const original = new Uint8Array(XLSX.write(book, { bookType: "xlsx", type: "array" }));
    const shown = XLSX.utils.sheet_to_json<string[]>(
      XLSX.read(original, { type: "array", cellNF: true }).Sheets.Data!,
      { header: 1, defval: "", raw: false },
    );
    expect(shown[1]).toEqual(["00123", "1,234.50", "old"]);
    const rows = shown.map((r) => r.map(String));
    rows[1]![2] = "new";
    rows.push(["", "42", ""]);

    const saved = XLSX.read(await patchWorkbook(original, [{ name: "Data", rows }]), {
      type: "array",
      cellNF: true,
    }).Sheets.Data!;
    expect(saved.A2).toMatchObject({ t: "s", v: "00123" });
    expect(saved.B2).toMatchObject({ t: "n", v: 1234.5, z: "#,##0.00" });
    expect(saved.C2).toMatchObject({ t: "s", v: "new" });
    expect(saved.B3).toMatchObject({ t: "n", v: 42 });
  });
});
