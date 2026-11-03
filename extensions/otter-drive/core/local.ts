import { platform, sha256Hex, utf8Decode, utf8Encode } from "@otter-mail/core/extension-kit";

const LISTS = "otter-drive/lists";
const DOCUMENTS = "otter-drive/documents";
const MAX_DOCUMENT = 20 * 1024 * 1024;
const MAX_DOCUMENTS = 500 * 1024 * 1024;

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const bytes = await platform().files.read(path);
    return bytes?.length ? (JSON.parse(utf8Decode(bytes)) as T) : null;
  } catch {
    return null;
  }
}

/** A list's file: by the sign-in too, so another account's never shows. */
const listPath = async (token: string, key: string) =>
  `${LISTS}/${await sha256Hex(`${token}\n${key}`)}.json`;

export async function savedList<T>(
  token: string,
  key: string,
): Promise<{ at: number; data: T } | null> {
  return readJson(await listPath(token, key));
}

export function saveList(token: string, key: string, data: unknown): void {
  void (async () => {
    await platform().files.write(
      await listPath(token, key),
      JSON.stringify({ at: Date.now(), data }),
    );
  })().catch(() => {});
}

const documentPath = async (id: string, version: number) =>
  `${DOCUMENTS}/${await sha256Hex(`${id}\n${version}`)}.json`;

export async function savedDocument<T>(id: string, version: number): Promise<T | null> {
  return readJson(await documentPath(id, version));
}

export function saveDocument(id: string, version: number, preview: unknown): void {
  void (async () => {
    const bytes = utf8Encode(JSON.stringify(preview));
    if (bytes.length > MAX_DOCUMENT) return;
    await platform().files.write(await documentPath(id, version), bytes);
    await prune();
  })().catch(() => {});
}

async function prune() {
  const files = await platform().files.list(DOCUMENTS);
  let total = files.reduce((sum, f) => sum + f.size, 0);
  if (total <= MAX_DOCUMENTS) return;
  files.sort((a, b) => a.modifiedAt - b.modifiedAt);
  for (const f of files) {
    if (total <= MAX_DOCUMENTS) break;
    await platform()
      .files.remove(`${DOCUMENTS}/${f.name}`)
      .catch(() => {});
    total -= f.size;
  }
}

export async function forgetAll(): Promise<void> {
  for (const dir of [LISTS, DOCUMENTS])
    for (const f of await platform()
      .files.list(dir)
      .catch(() => []))
      await platform()
        .files.remove(`${dir}/${f.name}`)
        .catch(() => {});
}
