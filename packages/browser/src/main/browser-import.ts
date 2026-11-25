import type { CookiesSetDetails } from "electron";
import { installExtension } from "electron-chrome-web-store";
import { createDecipheriv, createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { host } from "./host.ts";
import { browserOS, type ChromiumBrowser } from "./os/index.ts";
import { getBrowserSession } from "./browser.ts";
import { listExtensions } from "./extensions.ts";

export type ImportSource = {
  /** `<browser>/<profile directory>` */
  id: string;
  name: string;
  extensions: { id: string; name: string }[];
};

export type ImportResult = { cookies: number; extensions: number; failed: string[] };

type Profile = { browser: ChromiumBrowser; dir: string; name: string };

const readJson = (file: string): Record<string, any> | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

function profiles(): Profile[] {
  return browserOS.chromiumBrowsers().flatMap((browser) => {
    const cache = readJson(path.join(browser.dataDir, "Local State"))?.profile?.info_cache ?? {};
    return Object.entries(cache as Record<string, { name?: string }>)
      .filter(([dir]) => fs.existsSync(path.join(browser.dataDir, dir)))
      .map(([dir, info]) => ({ browser, dir, name: info.name || dir }));
  });
}

function cookiesFile(profileDir: string): string | null {
  return (
    [path.join(profileDir, "Network", "Cookies"), path.join(profileDir, "Cookies")].find((file) =>
      fs.existsSync(file),
    ) ?? null
  );
}

/** What the user installed from the Chrome Web Store and has on, without what the browser came with. */
function storeExtensions(profileDir: string): { id: string; name: string }[] {
  const settings = {
    ...readJson(path.join(profileDir, "Preferences"))?.extensions?.settings,
    ...readJson(path.join(profileDir, "Secure Preferences"))?.extensions?.settings,
  } as Record<string, Record<string, any>>;
  return Object.entries(settings)
    .filter(
      ([, s]) =>
        s.location === 1 &&
        s.from_webstore === true &&
        !s.was_installed_by_default &&
        !s.disable_reasons?.length &&
        s.state !== 0,
    )
    .map(([id, s]) => ({ id, name: extensionName(profileDir, id, s.manifest?.name) }));
}

function extensionName(profileDir: string, id: string, name: string | undefined): string {
  const message = /^__MSG_(.+)__$/.exec(name ?? "")?.[1];
  if (name && !message) return name;
  const versions = path.join(profileDir, "Extensions", id);
  try {
    const dir = path.join(versions, fs.readdirSync(versions).toSorted().at(-1)!);
    const manifest = readJson(path.join(dir, "manifest.json"));
    const key = message ?? /^__MSG_(.+)__$/.exec(manifest?.name ?? "")?.[1];
    if (!key) return manifest?.name ?? id;
    const messages = readJson(
      path.join(dir, "_locales", manifest?.default_locale ?? "en", "messages.json"),
    );
    const entry = Object.entries(messages ?? {}).find(
      ([k]) => k.toLowerCase() === key.toLowerCase(),
    );
    return (entry?.[1] as { message?: string } | undefined)?.message ?? id;
  } catch {
    return id;
  }
}

export function importSources(): ImportSource[] {
  const all = profiles();
  const installed = new Set(listExtensions().map((e) => e.id));
  return all
    .filter(({ browser, dir }) => cookiesFile(path.join(browser.dataDir, dir)))
    .map(({ browser, dir, name }) => ({
      id: `${browser.id}/${dir}`,
      name:
        all.filter((p) => p.browser.id === browser.id).length > 1
          ? `${browser.name} (${name})`
          : browser.name,
      extensions: storeExtensions(path.join(browser.dataDir, dir)).filter(
        (e) => !installed.has(e.id),
      ),
    }));
}

/** A copy, so a browser that holds its database open doesn't stop the read. */
function readDatabase<T>(file: string, read: (db: DatabaseSync) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "otter-import-"));
  try {
    const copy = path.join(dir, "db");
    fs.copyFileSync(file, copy);
    if (fs.existsSync(`${file}-wal`)) fs.copyFileSync(`${file}-wal`, `${copy}-wal`);
    const db = new DatabaseSync(copy);
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Chromium's AES-128-CBC; since its cookie database's version 24 a cookie starts with its domain's SHA-256. */
export function decryptValue(
  blob: Uint8Array,
  keys: Record<string, Buffer>,
  hostKey?: string,
): string | null {
  const key = keys[Buffer.from(blob.subarray(0, 3)).toString("latin1")];
  if (!key) return null;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
    let plain = Buffer.concat([decipher.update(blob.subarray(3)), decipher.final()]);
    if (
      hostKey !== undefined &&
      plain.length >= 32 &&
      plain.subarray(0, 32).equals(createHash("sha256").update(hostKey).digest())
    ) {
      plain = plain.subarray(32);
    }
    return plain.toString("utf8");
  } catch {
    return null;
  }
}

type CookieRow = {
  host_key: string;
  top_frame_site_key: string;
  name: string;
  value: string;
  encrypted_value: Uint8Array;
  path: string;
  expires_utc: number | bigint;
  has_expires: number;
  is_secure: number;
  is_httponly: number;
  samesite: number;
};

const SAME_SITE: Record<number, CookiesSetDetails["sameSite"]> = {
  0: "no_restriction",
  1: "lax",
  2: "strict",
};

/** Seconds from 1601 (Windows' epoch, Chromium's) to 1970. */
const EPOCH_DELTA = 11_644_473_600;

export function toCookie(row: CookieRow, value: string): CookiesSetDetails | null {
  if (row.top_frame_site_key) return null;
  const expires = row.has_expires ? Number(row.expires_utc) / 1e6 - EPOCH_DELTA : undefined;
  if (expires !== undefined && expires * 1000 < Date.now()) return null;
  const host = row.host_key.replace(/^\./, "");
  return {
    url: `${row.is_secure ? "https" : "http"}://${host}${row.path}`,
    name: row.name,
    value,
    ...(row.host_key.startsWith(".") ? { domain: row.host_key } : {}),
    path: row.path,
    secure: row.is_secure === 1,
    httpOnly: row.is_httponly === 1,
    ...(expires !== undefined ? { expirationDate: expires } : {}),
    sameSite: SAME_SITE[row.samesite] ?? "unspecified",
  };
}

async function importCookies(profileDir: string, browser: ChromiumBrowser): Promise<number> {
  const file = cookiesFile(profileDir);
  if (!file) return 0;
  const keys = await browserOS.chromiumKeys(browser);
  const rows = readDatabase(file, (db) => {
    // expires_utc counts microseconds from 1601: past what a Number holds exactly.
    const select = db.prepare(
      "SELECT host_key, top_frame_site_key, name, value, encrypted_value, path, expires_utc, has_expires, is_secure, is_httponly, samesite FROM cookies",
    );
    select.setReadBigInts(true);
    return select.all() as unknown as CookieRow[];
  });
  const ses = getBrowserSession();
  let imported = 0;
  let unreadable = 0;
  await Promise.all(
    rows.map(async (row) => {
      for (const field of ["is_secure", "is_httponly", "has_expires", "samesite"] as const) {
        row[field] = Number(row[field]);
      }
      const value =
        row.encrypted_value.length > 0
          ? decryptValue(row.encrypted_value, keys, row.host_key)
          : row.value;
      if (value === null) {
        unreadable++;
        return;
      }
      const cookie = toCookie(row, value);
      if (!cookie) return;
      try {
        await ses.cookies.set(cookie);
        imported++;
      } catch {
        unreadable++;
      }
    }),
  );
  await ses.cookies.flushStore();
  host().logger.info("browser", "Imported cookies", { browser: browser.id, imported, unreadable });
  return imported;
}

export async function importFromBrowser(
  sourceId: string,
  what: { cookies: boolean; extensions: string[] },
): Promise<ImportResult> {
  const profile = profiles().find((p) => `${p.browser.id}/${p.dir}` === sourceId);
  if (!profile) throw new Error("That browser profile is gone.");
  const profileDir = path.join(profile.browser.dataDir, profile.dir);
  const result: ImportResult = { cookies: 0, extensions: 0, failed: [] };
  if (what.cookies) result.cookies = await importCookies(profileDir, profile.browser);
  const offered = new Map(storeExtensions(profileDir).map((e) => [e.id, e.name]));
  for (const id of what.extensions) {
    if (!offered.has(id)) continue;
    try {
      await installExtension(id, { session: getBrowserSession() });
      result.extensions++;
    } catch (error) {
      host().logger.warn("browser", "Couldn't import an extension", { id, error: String(error) });
      result.failed.push(offered.get(id)!);
    }
  }
  return result;
}
