import { extensionManifest } from "@otter-mail/contracts/extensions";

import pkg from "./package.json" with { type: "json" };

/** Codex's manifest: package.json's `otterMail`. */
export const manifest = extensionManifest(pkg);
