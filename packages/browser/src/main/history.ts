import { app, ipcMain, type WebContents } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

export type Visit = { url: string; title: string; time: number };

/** The pages visited in the browser, newest first: what History lists and the address bar suggests. */
const MAX_VISITS = 5000;

const file = () => path.join(app.getPath("userData"), "Browser History.json");
let visits: Visit[] | null = null;
let saving: NodeJS.Timeout | null = null;

function load(): Visit[] {
  if (visits) return visits;
  try {
    visits = JSON.parse(fs.readFileSync(file(), "utf8")) as Visit[];
  } catch {
    visits = [];
  }
  return visits;
}

function save(): void {
  saving ??= setTimeout(() => {
    saving = null;
    fs.writeFileSync(file(), JSON.stringify(load()));
  }, 2000);
}

function visit(url: string, title: string): void {
  if (!/^https?:\/\//.test(url)) return;
  const all = load();
  // A reload or a title arriving: the same visit.
  if (all[0]?.url === url && Date.now() - all[0].time < 30 * 60_000) {
    all[0] = { url, title: title || all[0].title, time: all[0].time };
  } else {
    all.unshift({ url, title, time: Date.now() });
    if (all.length > MAX_VISITS) all.length = MAX_VISITS;
  }
  save();
}

export function trackHistory(contents: WebContents): void {
  contents.on("did-navigate", (_event, url) => visit(url, contents.getTitle()));
  contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) visit(url, contents.getTitle());
  });
  contents.on("page-title-updated", (_event, title) => visit(contents.getURL(), title));
}

export function clearHistory(): void {
  visits = [];
  fs.rmSync(file(), { force: true });
}

/** Visits matching every word, newest first; with no words, the newest. */
export function searchHistory(query: string, limit: number): Visit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found: Visit[] = [];
  for (const v of load()) {
    const text = `${v.url} ${v.title}`.toLowerCase();
    if (words.every((w) => text.includes(w))) found.push(v);
    if (found.length >= limit) break;
  }
  return found;
}

/** For the address bar: each page once, the most visited and recent first, matching what's typed. */
export function suggestFromHistory(typed: string): Visit[] {
  const text = typed.trim().toLowerCase();
  if (!text) return [];
  const pages = new Map<string, Visit & { count: number }>();
  for (const v of load()) {
    const plain = v.url.replace(/^https?:\/\/(www\.)?/, "").toLowerCase();
    if (!plain.startsWith(text) && !v.title.toLowerCase().includes(text) && !plain.includes(text)) {
      continue;
    }
    const seen = pages.get(v.url);
    if (seen) seen.count++;
    else pages.set(v.url, { ...v, count: 1 });
  }
  return [...pages.values()]
    .toSorted((a, b) => {
      const aStarts = a.url
        .replace(/^https?:\/\/(www\.)?/, "")
        .toLowerCase()
        .startsWith(text);
      const bStarts = b.url
        .replace(/^https?:\/\/(www\.)?/, "")
        .toLowerCase()
        .startsWith(text);
      return Number(bStarts) - Number(aStarts) || b.count - a.count || b.time - a.time;
    })
    .slice(0, 6)
    .map(({ url, title, time }) => ({ url, title, time }));
}

export function setupHistory(): void {
  ipcMain.handle("browser:history", (_event, params: unknown) => {
    const { query } = (params ?? {}) as { query?: unknown };
    return searchHistory(typeof query === "string" ? query : "", 300);
  });
  ipcMain.handle("browser:suggest", (_event, typed: unknown) =>
    typeof typed === "string" ? suggestFromHistory(typed) : [],
  );
  ipcMain.handle("browser:clearHistory", () => clearHistory());
}
