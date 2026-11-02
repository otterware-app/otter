import type { UiExtension } from "@otter-mail/web/extension-kit";

import { manifest } from "../manifest";
import { HermesIcon } from "./icon";
import { HermesConnect, HermesSettings } from "./settings";

export default {
  manifest,
  agent: {
    Icon: HermesIcon,
    Settings: HermesSettings,
    Connect: HermesConnect,
    missing: { headline: "Not connected" },
    serverApprovals: true,
  },
} satisfies UiExtension;
