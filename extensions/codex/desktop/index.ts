import type { CoreExtension } from "@otter-mail/core/extension-kit";

import { manifest } from "../manifest.ts";
import { codexProvider } from "./codex.js";

export default {
  manifest,
  activate({ registerAgent }) {
    registerAgent(codexProvider);
  },
} satisfies CoreExtension;
