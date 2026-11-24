import type { MobileExtension } from "@otter/mobile/extension-kit";

import { manifest } from "../manifest";
import { traits } from "../shared/traits";
import { HermesMark } from "./mark";
import { HermesSettings } from "./settings";

export default {
  manifest,
  agent: { Mark: HermesMark, traits, Settings: HermesSettings },
} satisfies MobileExtension;
