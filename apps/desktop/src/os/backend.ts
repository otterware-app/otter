import { linuxBackend } from "./linux/backend.js";
import { macBackend } from "./mac/backend.js";
import type { BackendOS } from "./types.js";

export const backendOS: BackendOS = process.platform === "darwin" ? macBackend : linuxBackend;
