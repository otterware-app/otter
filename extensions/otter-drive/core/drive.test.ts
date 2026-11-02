import { describe, expect, it } from "vite-plus/test";

import { emailPage, loadsFromWeb, slugFor } from "./drive.js";

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

describe("loadsFromWeb", () => {
  it("sends pages that load scripts or stylesheets from the web to Otter Drive", () => {
    expect(loadsFromWeb('<script src="https://cdn.example/chart.js"></script>')).toBe(true);
    expect(loadsFromWeb('<link rel="stylesheet" href="//cdn.example/a.css">')).toBe(true);
    expect(loadsFromWeb('<style>@import url("https://cdn.example/a.css");</style>')).toBe(true);
    expect(
      loadsFromWeb('<script type="module">import { h } from "https://esm.sh/preact";</script>'),
    ).toBe(true);
    expect(loadsFromWeb('<script type="module">import "https://esm.sh/x";</script>')).toBe(true);
    expect(loadsFromWeb('<script>await import("https://esm.sh/x")</script>')).toBe(true);
  });

  it("keeps self-contained pages, icons and web fonts", () => {
    expect(loadsFromWeb("<script>draw()</script><style>p{}</style>")).toBe(false);
    expect(loadsFromWeb("<p>import this from the web: http://x</p>")).toBe(false);
    expect(loadsFromWeb('<link rel="icon" href="https://example.com/i.png">')).toBe(false);
    expect(
      loadsFromWeb('<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">'),
    ).toBe(false);
  });
});
