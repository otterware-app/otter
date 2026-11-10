import { describe, expect, it } from "vite-plus/test";

import { varysStep } from "./steps.ts";

describe("varysStep", () => {
  it("titles varys's steps with its own summary", () => {
    expect(
      varysStep({ tool: "bash", summary: "Lists the invoices", detail: "ls invoices" }),
    ).toEqual({
      kind: "command",
      title: "Lists the invoices",
      detail: "ls invoices",
    });
    expect(varysStep({ tool: "mail_search" })).toEqual({ kind: "search", title: "Mail search" });
    expect(varysStep({ tool: "web_search", summary: "Searches the web" }).kind).toBe("web");
    const long = "x".repeat(3_000);
    expect(varysStep({ tool: "bash", detail: long }).detail).toBe(long);
  });
});
