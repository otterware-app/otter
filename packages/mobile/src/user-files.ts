import type { Platform } from "@otter/core";
import { File, Paths } from "expo-file-system";
import { shareAsync } from "expo-sharing";

/** A copy in the app's caches, for Quick Look or the share sheet to take it from. */
async function cached(name: string, bytes: Uint8Array): Promise<File> {
  const file = new File(Paths.cache, name.replace(/[/\\]/g, "_") || "file");
  await file.write(bytes);
  return file;
}

/** Files the user opens (Quick Look), saves (the share sheet: Save to Files and the rest) and picks (Files). */
export const userFiles: Platform["userFiles"] = {
  async open(name, bytes) {
    await (await cached(name, bytes)).preview();
  },
  async save(name, bytes) {
    await shareAsync((await cached(name, bytes)).uri);
    return true;
  },
  async pick() {
    const picked = await File.pickFileAsync({ multipleFiles: true });
    if (picked.canceled) return [];
    return Promise.all(
      picked.result.map(async (file) => ({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: await file.bytes(),
      })),
    );
  },
};
