/** Email translation, on the device (translation.ts), and its settings. */

import type { CoreExtension } from "@otter-mail/core/extension-kit";

import { manifest } from "../manifest.ts";
import { registerTranslationHandlers } from "./handlers.js";

export default {
  manifest,
  activate({ handle }) {
    registerTranslationHandlers(handle);
  },
} satisfies CoreExtension;
