import type { MobileExtension } from "@otter/mobile/extension-kit";

import { manifest } from "../manifest";
import { OpenClawMark } from "./mark";

export default { manifest, agent: { Mark: OpenClawMark } } satisfies MobileExtension;
