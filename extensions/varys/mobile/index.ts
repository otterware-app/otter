import type { MobileExtension } from "@otter/mobile/extension-kit";

import { manifest } from "../manifest";
import { VarysMark } from "./mark";

export default { manifest, agent: { Mark: VarysMark } } satisfies MobileExtension;
