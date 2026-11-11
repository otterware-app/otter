/** From T3 Code (github.com/pingdotgg/t3code, scripts/sync-third-party-license-notices.ts; MIT, see THIRD_PARTY_NOTICES.md). */
import * as NodePath from "node:path";

import { syncThirdPartyLicenseNotices } from "./lib/third-party-licenses.ts";

await syncThirdPartyLicenseNotices(NodePath.resolve("third-party-licenses.config.json"));
