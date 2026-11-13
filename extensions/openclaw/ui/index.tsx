import type { UiExtension } from "@otter/web/extension-kit";

import { manifest } from "../manifest";
import { OpenClawIcon } from "./icon";
import { OpenClawSettings } from "./settings";

export default {
  manifest,
  agent: {
    Icon: OpenClawIcon,
    Settings: OpenClawSettings,
    missing: { headline: "Not connected" },
    connectedAs: true,
    serverApprovals: true,
    mailReader: "gog",
    ownModelSettings: true,
    subAgents: true,
  },
} satisfies UiExtension;
