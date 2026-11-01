import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  directory: "",
  binary: "",
  handlers: new Map<string, (_event: unknown, params?: unknown) => Promise<unknown>>(),
  open: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getPath: () => fixture.directory },
  shell: { showItemInFolder: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: (_event: unknown, params?: unknown) => Promise<unknown>) =>
      fixture.handlers.set(channel, handler),
  },
}));
vi.mock("../os/index.js", () => ({
  hostOS: {
    terminals: {
      list: async () => ({ apps: [], defaultName: "Terminal" }),
      open: async (launcher: string, terminalId: string | null) =>
        fixture.open(launcher, terminalId),
      launcher: { fileName: "Investigate Otter Mail.command", shebang: "#!/bin/zsh -l" },
    },
  },
}));
vi.mock("../backend-host.js", () => ({
  invokeBackend: async () => ({
    providers: ["claude", "codex"].map((kind) => ({
      kind,
      settings: { binaryPath: fixture.binary, homePath: "", model: "" },
    })),
  }),
}));
vi.mock("../services/agent/shell-path.js", () => ({ ensureShellPath: async () => {} }));

const { registerSupportHandlers } = await import("./support.js");

beforeEach(async () => {
  fixture.directory = await fs.mkdtemp(path.join(os.tmpdir(), "otter-support-handler-"));
  fixture.binary = path.join(fixture.directory, "fake-agent");
  await fs.writeFile(fixture.binary, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  fixture.open.mockClear();
  fixture.handlers.clear();
  registerSupportHandlers();
});
afterEach(async () => {
  await fs.rm(fixture.directory, { recursive: true, force: true });
});

describe("Terminal support handler", () => {
  it("keeps the feedback type and affected platform through a native handoff and resume", async () => {
    const report = {
      kind: "feature",
      platform: "ios",
      title: "Pin folders on iPhone",
      happened: "Let me pin a folder in the drawer.",
      expected: "",
      steps: "",
    };
    const session = await fixture.handlers.get("support:launchAgent")!(null, {
      agent: "codex",
      report,
      body: "The proposal, without metadata headings.",
    });
    expect(await fixture.handlers.get("support:resumeSession")!(null)).toEqual(session);
    expect((session as { report: unknown }).report).toEqual(report);
    const { id } = session as { id: string };
    const prompt = await fs.readFile(
      path.join(fixture.directory, "support", id, "prompt.md"),
      "utf8",
    );
    expect(prompt).toContain("Feedback type: Feature request\nAffected platform: iPhone");
  });

  it("stages exactly the reviewed report and screenshot in a private folder, then opens Terminal", async () => {
    const body = "The reviewed report contains literal $(touch PWNED) and 'quotes'.";
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    const session = await fixture.handlers.get("support:launchAgent")!(null, {
      agent: "claude",
      report: { title: "Reply disappears", happened: "", expected: "", steps: "" },
      body,
      diagnostics: { schemaVersion: 1, version: "0.5.13", errors: [] },
      screenshot: { mime: "image/png", bytes },
    });
    const sessions = (await fs.readdir(path.join(fixture.directory, "support"))).filter(
      (name) => name !== "active.json",
    );
    expect(sessions).toHaveLength(1);
    const directory = path.join(fixture.directory, "support", sessions[0]!);
    expect(await fs.readFile(path.join(directory, "report.md"), "utf-8")).toBe(body);
    const prompt = await fs.readFile(path.join(directory, "prompt.md"), "utf-8");
    expect(prompt).toContain(body);
    expect(prompt).toContain("This session is connected to Otter Mail.");
    expect(prompt).toContain("Do not submit the issue from Terminal.");
    expect(prompt).toContain("./Otter Mail diagnostics.json");
    expect(prompt).not.toContain('"schemaVersion"');
    expect(
      JSON.parse(await fs.readFile(path.join(directory, "Otter Mail diagnostics.json"), "utf-8")),
    ).toEqual({ schemaVersion: 1, version: "0.5.13", errors: [] });
    expect(await fs.readFile(path.join(directory, "screenshot.png"))).toEqual(Buffer.from(bytes));
    const launcher = path.join(directory, "Investigate Otter Mail.command");
    expect(await fs.readFile(launcher, "utf-8")).toContain("'--permission-mode' 'default'");
    expect(await fs.readFile(launcher, "utf-8")).not.toContain(body);
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(directory, "prompt.md"))).mode & 0o777).toBe(0o600);
    expect(fixture.open).toHaveBeenCalledWith(launcher, null);
    expect(await fixture.handlers.get("support:resumeSession")!(null)).toEqual(session);
    expect(await fixture.handlers.get("support:readDraft")!(null, { id: sessions[0] })).toBeNull();
    await fs.writeFile(
      path.join(directory, "issue.tmp"),
      "# Reply disappears after archiving\n\nVerified findings and suggested fix.",
    );
    await fs.rename(path.join(directory, "issue.tmp"), path.join(directory, "issue.md"));
    expect(await fixture.handlers.get("support:readDraft")!(null, { id: sessions[0] })).toEqual({
      title: "Reply disappears after archiving",
      body: "Verified findings and suggested fix.",
      kind: "issue",
    });
  });

  it("rejects malformed launches and files before writing or opening anything", async () => {
    const launch = fixture.handlers.get("support:launchAgent")!;
    for (const params of [
      null,
      { agent: "other", body: "x" },
      { agent: "codex", body: " " },
      {
        agent: "codex",
        body: "x",
        report: {
          kind: "unexpected",
          platform: "mac",
          title: "x",
          happened: "",
          expected: "",
          steps: "",
        },
      },
      {
        agent: "codex",
        body: "x",
        report: {
          kind: "bug",
          platform: "unexpected",
          title: "x",
          happened: "",
          expected: "",
          steps: "",
        },
      },
      {
        agent: "codex",
        report: { title: "x", happened: "", expected: "", steps: "" },
        body: "x",
        screenshot: { mime: "image/png", bytes: new Uint8Array(12) },
      },
    ]) {
      await expect(launch(null, params)).rejects.toThrow();
    }
    expect(fixture.open).not.toHaveBeenCalled();
    expect(await fs.readdir(fixture.directory)).toEqual(["fake-agent"]);
  });
});
