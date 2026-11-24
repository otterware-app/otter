import type { MobileExtension } from "@otter/mobile/extension-kit";

import { manifest } from "../manifest";
import { traits } from "../shared/traits";
import { VarysMark } from "./mark";
import { VarysSettings } from "./settings";

export default {
  manifest,
  agent: { Mark: VarysMark, traits, Settings: VarysSettings },
} satisfies MobileExtension;
