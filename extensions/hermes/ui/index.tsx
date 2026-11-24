import type { UiExtension } from "@otter/web/extension-kit";

import { manifest } from "../manifest";
import { traits } from "../shared/traits";
import { HermesIcon } from "./icon";
import { HermesConnect, HermesSettings } from "./settings";

export default {
  manifest,
  agent: {
    ...traits,
    Icon: HermesIcon,
    Settings: HermesSettings,
    Connect: HermesConnect,
  },
} satisfies UiExtension;
