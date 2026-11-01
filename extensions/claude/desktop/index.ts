/**
 * Claude (claude.ts): the CLI installed on this computer, run by the
 * desktop backend and pointed at Otter Mail's tools (its MCP server).
 */

import type { CoreExtension } from "@otter-mail/core/extension-kit";

import { manifest } from "../manifest.ts";
import { claudeProvider } from "./claude.js";

export default {
  manifest,
  activate({ registerAgent }) {
    registerAgent(claudeProvider);
  },
} satisfies CoreExtension;
