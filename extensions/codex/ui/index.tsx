import {
  LocalAgentSettings,
  type AgentSettingsProps,
  type LocalAgentRuntime,
  type UiExtension,
} from "@otter-mail/web/extension-kit";

import { manifest } from "../manifest";
import { OpenAIIcon } from "./icon";

const RUNTIME: LocalAgentRuntime = {
  name: "Codex",
  binary: "codex",
  home: {
    title: "CODEX_HOME path",
    description: "Custom Codex home and config directory.",
    placeholder: "~/.codex",
  },
  launchArgs: "Additional CLI arguments passed to codex app-server on session start.",
};

function CodexSettings(props: AgentSettingsProps) {
  return <LocalAgentSettings runtime={RUNTIME} {...props} />;
}

export default {
  manifest,
  agent: {
    Icon: OpenAIIcon,
    Settings: CodexSettings,
    missing: { headline: "Not found", detail: "CLI not detected on PATH." },
  },
} satisfies UiExtension;
