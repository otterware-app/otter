import type { MobileExtension } from "@otter/mobile/extension-kit";

import { manifest } from "../manifest";
import { HermesMark } from "./mark";

export default { manifest, agent: { Mark: HermesMark } } satisfies MobileExtension;
