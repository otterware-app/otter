import type { UiExtension } from "@otter/web/extension-kit";

import { manifest } from "../manifest";
import { VarysIcon } from "./icon";
import { VarysSettings } from "./settings";

export default {
  manifest,
  agent: {
    Icon: VarysIcon,
    Settings: VarysSettings,
    missing: { headline: "Not connected" },
    serverApprovals: true,
    mailReader: "your mail connection",
  },
} satisfies UiExtension;
