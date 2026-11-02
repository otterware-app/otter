import { utf8Decode } from "./bytes.js";
import { platform } from "./platform.js";

/** The parsed file, or null when it doesn't exist or isn't JSON. */
export async function readJson<T>(name: string): Promise<T | null> {
  try {
    const bytes = await platform().files.read(name);
    return bytes ? (JSON.parse(utf8Decode(bytes)) as T) : null;
  } catch {
    return null;
  }
}

/** Each file's latest write, which the next one waits for, so an older one never lands last. */
const writes = new Map<string, Promise<void>>();

export async function writeJson(name: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value, null, 2);
  const write = (writes.get(name) ?? Promise.resolve())
    .catch(() => {})
    .then(() => platform().files.write(name, text));
  writes.set(name, write);
  await write;
}
