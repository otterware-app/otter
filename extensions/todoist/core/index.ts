import type { CoreExtension } from "@otter/core/extension-kit";

import { manifest } from "../manifest.ts";
import { registerTodoistHandlers } from "./handlers.ts";

export default {
  manifest,
  activate({ handle }) {
    registerTodoistHandlers(handle);
  },
} satisfies CoreExtension;
