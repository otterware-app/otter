import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export type DesktopEntry = {
  id: string;
  name: string;
  exec: string[];
  mimeTypes: string[];
  categories: string[];
  path: string;
};

export function applicationDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dataHome = env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share");
  const dataDirs = (env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":");
  return [dataHome, ...dataDirs].filter(Boolean).map((dir) => path.join(dir, "applications"));
}

export function execWords(value: string): string[] {
  const words: string[] = [];
  let word: string | null = null;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === "\\" && i + 1 < value.length) {
      word = (word ?? "") + value[++i];
    } else if (c === '"') {
      quoted = !quoted;
      word ??= "";
    } else if (/\s/.test(c) && !quoted) {
      if (word !== null) words.push(word);
      word = null;
    } else {
      word = (word ?? "") + c;
    }
  }
  if (word !== null) words.push(word);
  return words.filter((w) => !/^%[a-zA-Z]$/.test(w));
}

export function parseDesktopEntry(id: string, file: string, text: string): DesktopEntry | null {
  const fields = new Map<string, string>();
  let inEntry = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inEntry = trimmed === "[Desktop Entry]";
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (!inEntry || eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!fields.has(key)) fields.set(key, trimmed.slice(eq + 1).trim());
  }
  const list = (key: string) => (fields.get(key) ?? "").split(";").filter(Boolean);
  if (fields.get("Type") !== "Application" || fields.get("Hidden") === "true") return null;
  const exec = execWords(fields.get("Exec") ?? "");
  const name = fields.get("Name");
  if (!name || exec.length === 0) return null;
  return {
    id,
    name,
    exec,
    mimeTypes: list("MimeType"),
    categories: list("Categories"),
    path: file,
  };
}

export async function desktopEntries(dirs = applicationDirs()): Promise<DesktopEntry[]> {
  const seen = new Set<string>();
  const entries: DesktopEntry[] = [];
  for (const dir of dirs) {
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    for (const name of names.filter((n) => n.endsWith(".desktop")).sort()) {
      if (seen.has(name)) continue;
      seen.add(name);
      const file = path.join(dir, name);
      const text = await fs.readFile(file, "utf8").catch(() => null);
      const entry = text === null ? null : parseDesktopEntry(name, file, text);
      if (entry) entries.push(entry);
    }
  }
  return entries;
}
