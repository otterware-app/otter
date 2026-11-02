import type { CoreExtension } from "@otter-mail/core/extension-kit";

import { manifest } from "../manifest.ts";
import { registerInviteHandlers } from "./handlers.js";

export default {
  manifest,
  activate({ handle }) {
    registerInviteHandlers(handle);
  },
} satisfies CoreExtension;
