import { linuxBackend } from "./linux/backend.ts";
import { macBackend } from "./mac/backend.ts";
import type { BackendOS } from "./types.ts";

export const backendOS: BackendOS = process.platform === "darwin" ? macBackend : linuxBackend;
