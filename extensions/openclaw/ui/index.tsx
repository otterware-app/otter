import type { UiExtension } from "@otter/web/extension-kit";

import { manifest } from "../manifest";
import { traits } from "../shared/traits";
import { OpenClawIcon } from "./icon";
import { OpenClawSettings } from "./settings";

export default {
  manifest,
  agent: {
    ...traits,
    Icon: OpenClawIcon,
    Settings: OpenClawSettings,
  },
} satisfies UiExtension;
