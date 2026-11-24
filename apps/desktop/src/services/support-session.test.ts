import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { MAX_SUPPORT_BODY, type SupportSession } from "@otter/shared/support";
import {
  forgetSupportSession,
  readSupportDraft,
  rememberSupportSession,
  resumeSupportSession,
  supportDirectory,
} from "./support-session.ts";

let home: string;
let session: SupportSession;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "otter-support-session-"));
  session = {
    id: randomUUID(),
    agent: "codex",
    report: { title: "Original", happened: "A problem", expected: "", steps: "" },
    body: "Original report",
    diagnostics: null,
    hasScreenshot: false,
  };
  await fs.mkdir(supportDirectory(home, session.id), { recursive: true, mode: 0o700 });
});
afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

describe("agent draft return", () => {
  it("recovers an investigation after restart and returns complete issue or no-issue findings", async () => {
    expect(await resumeSupportSession(home)).toBeNull();
    await rememberSupportSession(home, session);
    expect(await resumeSupportSession(home)).toEqual(session);
    const directory = supportDirectory(home, session.id);
    expect(await readSupportDraft(home, session.id)).toBeNull();
    await fs.writeFile(
      path.join(directory, "issue.tmp"),
      "# Better title\n\nVerified cause and proposed fix.",
    );
    expect(await readSupportDraft(home, session.id)).toBeNull();
    await fs.rename(path.join(directory, "issue.tmp"), path.join(directory, "issue.md"));
    expect(await readSupportDraft(home, session.id)).toEqual({
      title: "Better title",
      body: "Verified cause and proposed fix.",
      kind: "issue",
    });
    await fs.rm(path.join(directory, "issue.md"));
    await fs.writeFile(
      path.join(directory, "findings.md"),
      "# Already fixed\n\nUpdate to the newest release. See existing issue #42.",
    );
    expect(await readSupportDraft(home, session.id)).toEqual({
      title: "Already fixed",
      body: "Update to the newest release. See existing issue #42.",
      kind: "findings",
    });
    await forgetSupportSession(home, randomUUID());
    expect(await resumeSupportSession(home)).toEqual(session);
    await forgetSupportSession(home, session.id);
    expect(await resumeSupportSession(home)).toBeNull();
    expect(await fs.readFile(path.join(directory, "findings.md"), "utf8")).toContain(
      "Already fixed",
    );
  });

  it("rejects path traversal, linked files/directories, incomplete drafts, and oversized content", async () => {
    await expect(readSupportDraft(home, "../../private")).rejects.toThrow(
      "Invalid support session",
    );
    const directory = supportDirectory(home, session.id);
    const file = path.join(directory, "issue.md");
    await fs.writeFile(path.join(home, "private.md"), "# Private\n\nSecret data");
    await fs.symlink(path.join(home, "private.md"), file);
    await expect(readSupportDraft(home, session.id)).rejects.toThrow();
    await fs.rm(file);
    await fs.writeFile(file, "# Title only");
    await expect(readSupportDraft(home, session.id)).rejects.toThrow("needs a # Title");
    await fs.writeFile(file, "# Title\n\n" + "x".repeat(MAX_SUPPORT_BODY));
    await expect(readSupportDraft(home, session.id)).rejects.toThrow("too large");
    await fs.writeFile(file, "x".repeat(MAX_SUPPORT_BODY * 4 + 4_097));
    await expect(readSupportDraft(home, session.id)).rejects.toThrow("too large");
    const linkedId = randomUUID();
    await fs.symlink(directory, supportDirectory(home, linkedId));
    await expect(readSupportDraft(home, linkedId)).rejects.toThrow("Invalid support session");
  });
});
