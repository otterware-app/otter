import type { CoreExtension } from "@otter/core/extension-kit";

import { manifest } from "../manifest.ts";
import { registerInviteHandlers } from "./handlers.ts";

export default {
  manifest,
  activate({ handle }) {
    registerInviteHandlers(handle);
  },
} satisfies CoreExtension;
