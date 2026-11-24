import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vite-plus/test";
import { buildSupportLauncher, supportBinary } from "./support-launcher.ts";
import {
  SUPPORT_PLAYBOOK,
  buildSupportIssue,
  buildSupportPrompt,
  parseSupportDraft,
  supportIssueUrl,
  summarizeSupportLog,
  supportError,
} from "@otter/shared/support";

const exec = promisify(execFile);

describe("support handoff", () => {
  it("routes bug and feature feedback through labeled public templates and preserves the affected platform", async () => {
    const report = {
      kind: "feature" as const,
      platform: "ios" as const,
      title: "Pin folders on iPhone",
      happened: "Let me pin a folder in the drawer.",
      expected: "",
      steps: "",
    };
    const body = buildSupportIssue(report, null);
    expect(body).toContain("### Feature request");
    expect(body).toContain("### Platform\n\niPhone");
    expect(body).not.toContain("Steps to reproduce");
    expect(body).not.toContain("Not provided");
    const feature = new URL(supportIssueUrl(report.title, body, report.kind)!);
    expect(feature.searchParams.get("template")).toBe("feature_request.md");
    expect(feature.searchParams.get("body")).toBe(body);
    expect(feature.searchParams.has("labels")).toBe(false);
    const bug = new URL(supportIssueUrl(report.title, body, "bug")!);
    expect(bug.searchParams.get("template")).toBe("bug_report.md");
    for (const [template, label] of [
      ["feature_request", "enhancement"],
      ["bug_report", "bug"],
    ]) {
      const contents = await fs.readFile(
        new URL(`../../../../.github/ISSUE_TEMPLATE/${template}.md`, import.meta.url),
        "utf8",
      );
      expect(contents).toContain(`labels: ${label}\n`);
    }
    const prompt = buildSupportPrompt(
      "# Pin folders\n\nA proposal without metadata headings.",
      true,
      report,
    );
    expect(prompt).toContain("Feedback type: Feature request\nAffected platform: iPhone");
    expect(prompt).toContain("Do not submit the issue from Terminal.");
  });

  it("passes paths and model names literally to the agent, with interactive approvals", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "otter-support-test-"));
    try {
      const directory = path.join(root, "a 'quoted' $(touch PWNED) directory");
      await fs.mkdir(directory);
      const binary = path.join(root, "fake 'agent' $(touch PWNED)");
      const output = path.join(root, "output.txt");
      await fs.writeFile(
        binary,
        '#!/bin/sh\nprintf "%s\\n" "$PWD" "$CODEX_HOME" "$@" > "$OTTER_SUPPORT_TEST_OUTPUT"\n',
        { mode: 0o700 },
      );
      const model = "model 'name' $(touch PWNED) `touch PWNED`";
      const homePath = path.join(root, "config 'quoted' $(touch PWNED)");
      const launcher = path.join(root, "launch.command");
      await fs.writeFile(
        launcher,
        buildSupportLauncher({
          agent: "codex",
          binary,
          directory,
          homePath,
          model,
          searchPath: process.env.PATH ?? "/usr/bin:/bin",
          shebang: "#!/bin/sh",
        }),
      );
      await exec(process.platform === "darwin" ? "/bin/zsh" : "/bin/sh", [launcher], {
        cwd: root,
        env: { ...process.env, OTTER_SUPPORT_TEST_OUTPUT: output },
      });
      const lines = (await fs.readFile(output, "utf-8")).trim().split("\n");
      expect(lines.slice(0, 8)).toEqual([
        directory,
        homePath,
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "on-request",
        "--model",
        model,
      ]);
      expect(await fs.readdir(root)).not.toContain("PWNED");
      expect(await fs.readdir(directory)).not.toContain("PWNED");
      expect(await supportBinary(binary, "codex")).toBe(binary);
      expect(await supportBinary(directory, "codex")).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the packaged offline playbook identical to the public one", async () => {
    expect(
      await fs.readFile(
        new URL("../../../../.github/triage/PLAYBOOK.md", import.meta.url),
        "utf-8",
      ),
    ).toBe(SUPPORT_PLAYBOOK);
  });
});

describe("diagnostics privacy", () => {
  it("keeps useful classifications and source frames while dropping free-form private data", () => {
    const text =
      '2026-09-30T12:00:00.000Z ERROR [mail-sync] sync failed for chris@private.example: HTTP 401 token=TOP_SECRET subject="Private subject" /Users/chris/private at packages/core/src/services/mail-sync.ts:344:4\n' +
      '2026-09-30T12:00:01.000Z INFO [search] offline, using the local index { q: "Private search" }\n' +
      "2026-09-30T12:00:02.000Z ERROR [custom-private-scope] Sensitive custom log\n";
    const summaries = summarizeSupportLog(text);
    expect(summaries).toEqual([
      {
        at: "2026-09-30T12:00:00.000Z",
        scope: "mail-sync",
        category: "authentication",
        httpStatus: 401,
        frames: ["packages/core/src/services/mail-sync.ts:344:4"],
      },
    ]);
    for (const privateText of [
      "chris",
      "private.example",
      "TOP_SECRET",
      "Private subject",
      "Private search",
      "/Users",
      "Sensitive custom",
    ])
      expect(JSON.stringify(summaries)).not.toContain(privateText);
    expect(supportError("now", "gmail", "status: 429 rate limited")?.category).toBe("rate limit");
    expect(supportError("now", "backend", "SQLITE_FULL ENOSPC")?.category).toBe("storage");
  });

  it("bounds recent failures and hands oversized reports to the clipboard flow", () => {
    const log = Array.from(
      { length: 70 },
      (_, index) =>
        `2026-09-30T12:00:${String(index % 60).padStart(2, "0")}.000Z WARN [gmail] rate limited (429)`,
    ).join("\n");
    expect(summarizeSupportLog(log)).toHaveLength(50);
    const report = {
      title: "Reply & archive",
      happened: "A reply disappears.",
      expected: "It stays visible.",
      steps: "1. Reply\n2. Archive",
    };
    const body = buildSupportIssue(report, null);
    expect(new URL(supportIssueUrl(report.title, body)!).searchParams.get("body")).toBe(body);
    expect(supportIssueUrl(report.title, "😅".repeat(1_000))).toBeNull();
    expect(body).not.toContain("Diagnostics");
  });
  it("keeps diagnostic JSON out of the issue body and supports portable draft import", () => {
    const report = { title: "A problem", happened: "", expected: "", steps: "" };
    const body = buildSupportIssue(report, {
      version: "0.5.13",
      platform: "desktop",
      environment: "macOS",
      schemaVersion: 1,
    } as Parameters<typeof buildSupportIssue>[1]);
    expect(body).toContain("Otter diagnostics.json");
    expect(body).not.toContain('"schemaVersion"');
    expect(body).not.toContain("```json");
    expect(parseSupportDraft("# Specific issue title\r\n\r\nConcise findings.")).toEqual({
      title: "Specific issue title",
      body: "Concise findings.",
      kind: "issue",
    });
    expect(() => parseSupportDraft("### What happened\nIncomplete draft")).toThrow();
    expect(() => parseSupportDraft("# Title\n ")).toThrow();
    expect(buildSupportPrompt(body)).toContain("This is a portable session.");
    expect(buildSupportPrompt(body, true)).toContain("Do not submit the issue from Terminal.");
  });
});
