import type { MobileExtension } from "@otter/mobile/extension-kit";

import { manifest } from "../manifest";
import { CodexMark } from "./mark";

export default { manifest, agent: { Mark: CodexMark } } satisfies MobileExtension;
