import type { CoreExtension } from "@otter/core/extension-kit";

import { manifest } from "../manifest.ts";
import { codexAgent } from "./codex.js";

export default {
  manifest,
  activate({ registerAgent }) {
    registerAgent(codexAgent);
  },
} satisfies CoreExtension;
