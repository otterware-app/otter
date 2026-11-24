import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  calls: vi.fn(),
  apps: [
    { id: "com.mitchellh.ghostty", name: "Ghostty" },
    { id: "com.apple.Terminal", name: "Terminal" },
  ],
}));
vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: async (file: string, args: string[]) => {
      fixture.calls(file, args);
      return {
        stdout:
          file === "/usr/bin/osascript"
            ? JSON.stringify({ apps: fixture.apps, defaultName: "Terminal" })
            : "",
        stderr: "",
      };
    },
  }),
}));
const support = await import("./support-terminal.ts");
const { macTerminals } = await import("../os/mac/terminals.ts");
const getSupportTerminals = (home: string) => support.getSupportTerminals(home, macTerminals);
const setSupportTerminal = (home: string, id: unknown) =>
  support.setSupportTerminal(home, macTerminals, id);
const openSupportTerminal = (home: string, launcher: string) =>
  support.openSupportTerminal(home, macTerminals, launcher);
let home: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "otter-terminal-test-"));
  fixture.calls.mockClear();
});
afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

describe("support terminal preference (macOS)", () => {
  it("follows macOS's file association until a terminal is chosen", async () => {
    const launcher = path.join(home, "Investigate Otter.command");
    await openSupportTerminal(home, launcher);
    expect(fixture.calls).toHaveBeenCalledExactlyOnceWith("/usr/bin/open", [launcher]);
    expect((await getSupportTerminals(home)).selectedId).toBeNull();
  });

  it("remembers Ghostty locally and sends the launcher as a literal file argument", async () => {
    const selected = await setSupportTerminal(home, "com.mitchellh.ghostty");
    expect(selected.selectedId).toBe("com.mitchellh.ghostty");
    expect((await getSupportTerminals(home)).selectedId).toBe("com.mitchellh.ghostty");
    expect((await fs.stat(path.join(home, "support-terminal.json"))).mode & 0o777).toBe(0o600);
    const launcher = path.join(home, "a 'quoted' $(touch PWNED).command");
    await openSupportTerminal(home, launcher);
    expect(fixture.calls).toHaveBeenLastCalledWith("/usr/bin/open", [
      "-b",
      "com.mitchellh.ghostty",
      launcher,
    ]);
    await setSupportTerminal(home, null);
    await openSupportTerminal(home, launcher);
    expect(fixture.calls).toHaveBeenLastCalledWith("/usr/bin/open", [launcher]);
  });

  it("rejects arbitrary selections and falls back to the system default if a terminal was removed", async () => {
    await expect(setSupportTerminal(home, "arbitrary.app")).rejects.toThrow("installed terminal");
    await expect(setSupportTerminal(home, undefined)).rejects.toThrow("installed terminal");
    await fs.writeFile(
      path.join(home, "support-terminal.json"),
      JSON.stringify("removed.terminal"),
    );
    expect((await getSupportTerminals(home)).selectedId).toBeNull();
    await openSupportTerminal(home, "launcher.command");
    expect(fixture.calls).toHaveBeenLastCalledWith("/usr/bin/open", ["launcher.command"]);
  });
});
