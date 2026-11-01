import { extensionManifest } from "@otter-mail/contracts/extensions";

import pkg from "./package.json" with { type: "json" };

/** Calendar invites's manifest: package.json's `otterMail`. */
export const manifest = extensionManifest(pkg);
