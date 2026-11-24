import type { UiExtension } from "@otter/web/extension-kit";

import { manifest } from "../manifest";
import { traits } from "../shared/traits";
import { VarysIcon } from "./icon";
import { VarysSettings } from "./settings";

export default {
  manifest,
  agent: {
    ...traits,
    Icon: VarysIcon,
    Settings: VarysSettings,
  },
} satisfies UiExtension;
