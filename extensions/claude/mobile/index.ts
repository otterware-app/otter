import type { MobileExtension } from "@otter/mobile/extension-kit";

import { manifest } from "../manifest";
import { ClaudeMark } from "./mark";

export default { manifest, agent: { Mark: ClaudeMark } } satisfies MobileExtension;
