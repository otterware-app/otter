import type { CoreExtension } from "@otter/core/extension-kit";

import { manifest } from "../manifest.ts";
import { claudeAgent } from "./claude.ts";

export default {
  manifest,
  activate({ registerAgent }) {
    registerAgent(claudeAgent);
  },
} satisfies CoreExtension;
