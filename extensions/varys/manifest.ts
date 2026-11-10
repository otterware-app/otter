import { extensionManifest } from "@otter/contracts/extensions";

import pkg from "./package.json" with { type: "json" };

export const manifest = extensionManifest(pkg);
