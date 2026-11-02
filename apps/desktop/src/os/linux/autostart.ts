import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function autostartFile(env: NodeJS.ProcessEnv = process.env): string {
  const configHome = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "autostart", "otter-mail.desktop");
}

function quoteExec(value: string): string {
  return `"${value.replace(/["`$\\]/g, (c) => `\\${c}`)}"`;
}

export function autostartEntry(executable: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Otter Mail",
    `Exec=${quoteExec(executable)}`,
    "Icon=otter-mail",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

export function setAutostart(enabled: boolean, executable: string, file = autostartFile()): void {
  if (!enabled) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, autostartEntry(executable));
}
