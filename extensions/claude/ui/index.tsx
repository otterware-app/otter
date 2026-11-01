/** Claude: the CLI on this computer (the desktop app runs it); its mark and runtime settings. */

import {
  LocalAgentSettings,
  type AgentSettingsProps,
  type LocalAgentRuntime,
  type UiExtension,
} from "@otter-mail/web/extension-kit";

import { manifest } from "../manifest";
import { ClaudeIcon } from "./icon";

const RUNTIME: LocalAgentRuntime = {
  name: "Claude",
  binary: "claude",
  home: {
    title: "CLAUDE_CONFIG_DIR path",
    description: "Custom Claude config directory.",
    placeholder: "~/.claude",
  },
  launchArgs: null,
};

function ClaudeSettings(props: AgentSettingsProps) {
  return <LocalAgentSettings runtime={RUNTIME} {...props} />;
}

export default {
  manifest,
  agent: {
    Icon: ClaudeIcon,
    Settings: ClaudeSettings,
    missing: { headline: "Not found" },
  },
} satisfies UiExtension;
