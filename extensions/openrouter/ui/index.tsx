import { AgentIcon, type UiExtension } from "@otter-mail/web/extension-kit";

import { manifest } from "../manifest";
import { OpenRouterSettings } from "./settings";

export default {
  manifest,
  agent: {
    Icon: AgentIcon,
    Settings: OpenRouterSettings,
    missing: { headline: "Not found" },
    needsSignIn: true,
  },
} satisfies UiExtension;
