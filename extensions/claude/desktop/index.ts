import type { CoreExtension } from "@otter-mail/core/extension-kit";

import { manifest } from "../manifest.ts";
import { claudeProvider } from "./claude.js";

export default {
  manifest,
  activate({ registerAgent }) {
    registerAgent(claudeProvider);
  },
} satisfies CoreExtension;
