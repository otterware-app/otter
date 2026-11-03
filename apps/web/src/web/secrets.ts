/**
 * The web app's secrets (IMAP passwords above all), in the origin's private
 * files, each value encrypted with AES-GCM under a key made once per origin
 * and kept in IndexedDB. The key is non-extractable: the app can use it but
 * no script can read it out, so the files alone (a backup, a copied profile)
 * don't give the passwords away. Values written in plain text by earlier
 * builds are encrypted the first time they're read.
 */

import type { Platform } from "@otter-mail/core";

const FILE = "secrets.json";
const SEALED = "aes-gcm:";

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error));
  });

async function loadKey(): Promise<CryptoKey> {
  const open = indexedDB.open("otter-mail-secrets", 1);
  open.addEventListener("upgradeneeded", () => open.result.createObjectStore("keys"));
  const db = await request(open);
  const stored = () =>
    request<CryptoKey | undefined>(db.transaction("keys").objectStore("keys").get("key"));
  try {
    const existing = await stored();
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const added = await request(
      db.transaction("keys", "readwrite").objectStore("keys").add(key, "key"),
    )
      .then(() => true)
      .catch(() => false);
    return added ? key : ((await stored()) ?? key);
  } finally {
    db.close();
  }
}

const toBase64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export function webSecrets(files: Platform["files"]): Platform["secrets"] {
  let key: Promise<CryptoKey> | null = null;
  const keyNow = () => (key ??= loadKey());

  async function seal(value: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(value);
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyNow(), data),
    );
    const out = new Uint8Array(iv.length + sealed.length);
    out.set(iv);
    out.set(sealed, iv.length);
    return SEALED + toBase64(out);
  }

  async function open(value: string): Promise<string | null> {
    const bytes = fromBase64(value.slice(SEALED.length));
    try {
      const data = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.subarray(0, 12) },
        await keyNow(),
        bytes.subarray(12),
      );
      return new TextDecoder().decode(data);
    } catch {
      return null;
    }
  }

  async function readAll(): Promise<Record<string, string>> {
    const bytes = await files.read(FILE);
    const stored = bytes
      ? (JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>)
      : {};
    const values: Record<string, string> = {};
    let plain = false;
    for (const [name, value] of Object.entries(stored)) {
      if (!value.startsWith(SEALED)) plain = true;
      const text = value.startsWith(SEALED) ? await open(value) : value;
      if (text !== null) values[name] = text;
    }
    if (plain) await writeAll(values);
    return values;
  }

  async function writeAll(values: Record<string, string>): Promise<void> {
    const sealed: Record<string, string> = {};
    for (const [name, value] of Object.entries(values)) sealed[name] = await seal(value);
    await files.write(FILE, JSON.stringify(sealed));
  }

  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  return {
    get: (name) => inTurn(async () => (await readAll())[name] ?? null),
    set: (name, value) => inTurn(async () => writeAll({ ...(await readAll()), [name]: value })),
    delete: (name) =>
      inTurn(async () => {
        const { [name]: _removed, ...rest } = await readAll();
        await writeAll(rest);
      }),
  };
}
