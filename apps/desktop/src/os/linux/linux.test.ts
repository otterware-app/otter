import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { autostartEntry, autostartFile, setAutostart } from "./autostart.js";
import {
  applicationDirs,
  desktopEntries,
  execWords,
  parseDesktopEntry,
} from "./desktop-entries.js";
import { terminalCommand } from "./terminals.js";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "otter-linux-test-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("desktop entries", () => {
  it("splits Exec lines like the spec: quotes group, field codes go", () => {
    expect(execWords('"/opt/Otter Mail/otter-mail" %U')).toEqual(["/opt/Otter Mail/otter-mail"]);
    expect(execWords("ptyxis --new-window %f")).toEqual(["ptyxis", "--new-window"]);
    expect(execWords('sh -c "echo \\"hi\\""')).toEqual(["sh", "-c", 'echo "hi"']);
  });

  it("reads only the [Desktop Entry] group, and skips hidden or non-app entries", () => {
    const entry = parseDesktopEntry(
      "org.gnome.Terminal.desktop",
      "/x",
      [
        "[Desktop Entry]",
        "Type=Application",
        "Name=Terminal",
        "Exec=gnome-terminal --window",
        "Categories=GNOME;GTK;System;TerminalEmulator;",
        "[Desktop Action new-window]",
        "Name=New Window",
        "Exec=gnome-terminal --window --new",
      ].join("\n"),
    );
    expect(entry).toMatchObject({
      name: "Terminal",
      exec: ["gnome-terminal", "--window"],
      categories: ["GNOME", "GTK", "System", "TerminalEmulator"],
    });
    expect(parseDesktopEntry("a.desktop", "/a", "[Desktop Entry]\nType=Link\nName=A\nExec=a")).toBe(
      null,
    );
    expect(
      parseDesktopEntry(
        "b.desktop",
        "/b",
        "[Desktop Entry]\nType=Application\nName=B\nExec=b\nHidden=true",
      ),
    ).toBe(null);
  });

  it("lets the user's entries override and hide the system's", async () => {
    const user = path.join(root, "home", "applications");
    const system = path.join(root, "usr", "applications");
    await fs.mkdir(user, { recursive: true });
    await fs.mkdir(system, { recursive: true });
    const app = (name: string, extra = "") =>
      `[Desktop Entry]\nType=Application\nName=${name}\nExec=${name.toLowerCase()}\n${extra}`;
    await fs.writeFile(
      path.join(system, "mail.desktop"),
      app("Mail", "MimeType=x-scheme-handler/mailto;"),
    );
    await fs.writeFile(path.join(system, "old.desktop"), app("Old"));
    await fs.writeFile(path.join(user, "mail.desktop"), app("My Mail"));
    await fs.writeFile(path.join(user, "old.desktop"), app("Old", "Hidden=true"));
    const entries = await desktopEntries([user, system]);
    expect(entries.map((e) => e.name)).toEqual(["My Mail"]);
  });

  it("looks in XDG_DATA_HOME, then XDG_DATA_DIRS", () => {
    expect(applicationDirs({ XDG_DATA_HOME: "/h", XDG_DATA_DIRS: "/a:/b" })).toEqual([
      "/h/applications",
      "/a/applications",
      "/b/applications",
    ]);
  });
});

describe("terminals", () => {
  it("passes the launcher as one argument, after each terminal's own flag", () => {
    const launcher = "/tmp/it's $(here)/investigate-otter.sh";
    expect(terminalCommand(["gnome-terminal", "--window"], launcher)).toEqual([
      "gnome-terminal",
      "--window",
      "--",
      launcher,
    ]);
    expect(terminalCommand(["/usr/bin/konsole"], launcher)).toEqual([
      "/usr/bin/konsole",
      "-e",
      launcher,
    ]);
    expect(terminalCommand(["kitty"], launcher)).toEqual(["kitty", launcher]);
    expect(terminalCommand(["xfce4-terminal"], launcher)).toEqual([
      "xfce4-terminal",
      "-x",
      launcher,
    ]);
  });
});

describe("autostart", () => {
  it("writes an XDG autostart entry that starts hidden, with the executable quoted, and removes it", async () => {
    const file = autostartFile({ XDG_CONFIG_HOME: root });
    expect(file).toBe(path.join(root, "autostart", "otter-mail.desktop"));
    setAutostart(true, '/opt/otter-mail/otter "mail"', file);
    const text = await fs.readFile(file, "utf8");
    expect(text).toBe(autostartEntry('/opt/otter-mail/otter "mail"'));
    expect(text).toContain('Exec="/opt/otter-mail/otter \\"mail\\"" --hidden');
    setAutostart(false, "", file);
    await expect(fs.stat(file)).rejects.toThrow();
  });
});
