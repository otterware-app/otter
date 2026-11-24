export type * from "./types";
export { useOpenWorkspace } from "./workspaces";
export { NavGlyph } from "../mail/app-icons";
export { ChatMarkdown as Markdown } from "../agent/chat-markdown";
export { useCommandHandlers } from "../keybindings/dispatch";
export { ShortcutText, useShortcutLabel } from "../keybindings/store";

export { ipc, task } from "@otter/client/bridge";
export { openLink } from "../browser/store";
export { features } from "../features";
export { isModClick } from "../keybindings/keys";
export { mailApi } from "@otter/client/mail/api";
export { agentApi } from "@otter/client/agents/api";
export type { ProviderSnapshot, ProvidersState, RuntimeMode } from "@otter/client/agents/api";
export { useCapabilities } from "@otter/client/mail/capabilities";
export { useDefaultCalendar } from "../calendar/calendar-view";
export type { MessageDetail } from "@otter/client/mail/types";
export { searchableSetting } from "../settings/settings-search";
export { PictureError, mailboxPicture } from "../settings/mailbox-picture-image";

export { RUNTIME_MODE_OPTIONS } from "../mail/model-picker";
export {
  Command,
  LocalAgentSettings,
  ModelsSection,
  type LocalAgentRuntime,
} from "../settings/agent-settings-kit";
export { osNames } from "../os-names";
export { htmlToText } from "../mail/text";
export { AgentIcon } from "../agent/agent-icon";
export { useSetProvidersState } from "@otter/client/agents/agent-providers";
