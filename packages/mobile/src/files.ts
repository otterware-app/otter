import type { FileInfo, Platform } from "@otter/core";
import { Directory, File, Paths } from "expo-file-system";

/** Core's files, at paths relative to `root` in the app's documents. */
export function appFiles(root: string): Platform["files"] {
  const at = (path: string) => new File(Paths.document, root, path);
  return {
    async read(path) {
      const file = at(path);
      return file.exists ? file.bytes() : null;
    },
    async write(path, data) {
      const file = at(path);
      file.parentDirectory.create({ intermediates: true, idempotent: true });
      // Written beside it and moved over it, so a quit mid-write leaves the old file whole.
      const next = new File(file.parentDirectory, `${file.name}.next`);
      await next.write(data);
      next.moveSync(file, { overwrite: true });
    },
    async remove(path) {
      const file = at(path);
      if (file.exists) file.delete();
    },
    async list(path) {
      const dir = new Directory(Paths.document, root, path);
      if (!dir.exists) return [];
      return dir
        .list()
        .filter((entry) => entry instanceof File)
        .map((file): FileInfo => ({
          name: file.name,
          size: file.size,
          modifiedAt: file.lastModified ?? 0,
        }));
    },
  };
}
