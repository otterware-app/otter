import type { CoreExtension } from "@otter/core/extension-kit";

import { manifest } from "../manifest.ts";
import { codexAgent } from "./codex.ts";

export default {
  manifest,
  activate({ registerAgent }) {
    registerAgent(codexAgent);
  },
} satisfies CoreExtension;
