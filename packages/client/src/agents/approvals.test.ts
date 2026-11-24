import { describe, expect, it } from "vite-plus/test";
import type { ApprovalRequest } from "./api.ts";
import { approvalMore, approvalQuestion, basename, fileList } from "./approvals.ts";

const approval = (over: Partial<ApprovalRequest>): ApprovalRequest => ({
  id: "a",
  kind: "command",
  title: "Tool approval",
  choices: ["once", "deny"],
  ...over,
});

describe("approvals", () => {
  it("asks about what the agent would do", () => {
    expect(approvalQuestion("Codex", approval({}))).toBe("Allow Codex to run this command?");
    expect(approvalQuestion("Codex", approval({ kind: "tool" }))).toBe(
      "Allow Codex to use a tool?",
    );
    expect(approvalQuestion("Codex", approval({ kind: "tool", title: "Send the email" }))).toBe(
      "Allow Codex to send the email?",
    );
    expect(approvalQuestion("Codex", approval({ kind: "fileChange" }))).toBe(
      "Allow Codex to edit files?",
    );
  });

  it("names the files it would edit, three at most", () => {
    expect(
      approvalQuestion("Codex", approval({ kind: "fileChange", detail: "src/a.ts\nsrc/b.ts" })),
    ).toBe("Allow Codex to edit a.ts and b.ts?");
    expect(
      approvalQuestion("Codex", approval({ kind: "fileChange", detail: "a\nb/\nc\nd\ne" })),
    ).toBe("Allow Codex to edit a, b, c and 2 more?");
    expect(fileList(["x/one"])).toEqual({
      shown: [{ path: "x/one", name: "one", joiner: "" }],
      more: 0,
    });
    expect(basename("/")).toBe("/");
  });

  it("offers this chat or always only when the agent does, and stopping it", () => {
    expect(approvalMore(approval({})).map((m) => m.decision)).toEqual(["stop"]);
    expect(
      approvalMore(approval({ choices: ["once", "session", "always", "deny"] })).map(
        (m) => m.decision,
      ),
    ).toEqual(["session", "always", "stop"]);
  });
});
