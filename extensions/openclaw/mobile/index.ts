import type { MobileExtension } from "@otter/mobile/extension-kit";

import { manifest } from "../manifest";
import { traits } from "../shared/traits";
import { OpenClawMark } from "./mark";
import { OpenClawRows } from "./rows";
import { OpenClawSettings } from "./settings";

export default {
  manifest,
  agent: { Mark: OpenClawMark, traits, Settings: OpenClawSettings, Rows: OpenClawRows },
} satisfies MobileExtension;
