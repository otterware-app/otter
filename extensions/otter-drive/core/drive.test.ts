import { describe, expect, it } from "vite-plus/test";

import { emailPage, slugFor } from "./drive.js";

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
