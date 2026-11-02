import { linuxOS } from "./linux/index.js";
import { macOS } from "./mac/index.js";
import type { HostOS } from "./types.js";

export const hostOS: HostOS = process.platform === "darwin" ? macOS : linuxOS;
