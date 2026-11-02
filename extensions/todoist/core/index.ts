import type { CoreExtension } from "@otter-mail/core/extension-kit";

import { manifest } from "../manifest.ts";
import { registerTodoistHandlers } from "./handlers.js";

export default {
  manifest,
  activate({ handle }) {
    registerTodoistHandlers(handle);
  },
} satisfies CoreExtension;
