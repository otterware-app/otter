import type { CoreExtension } from "@otter/core/extension-kit";

import { manifest } from "../manifest.ts";
import { registerTranslationHandlers } from "./handlers.ts";

export default {
  manifest,
  activate({ handle }) {
    registerTranslationHandlers(handle);
  },
} satisfies CoreExtension;
