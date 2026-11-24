import { linuxOS } from "./linux/index.ts";
import { macOS } from "./mac/index.ts";
import type { HostOS } from "./types.ts";

export const hostOS: HostOS = process.platform === "darwin" ? macOS : linuxOS;
