import { setBrowserUIHost } from "@otter/browser/ui/host";
import { openChatTab, useChats } from "@otter/client/agents/chat-store";

import { FindBar, isFindKey } from "../agent/chat-find";
import { appApi } from "../app-api";
import { features } from "../features";
import { shortcutText } from "../keybindings/keys";
import { osNames } from "../os-names";
import { searchableSetting } from "../settings/settings-search";

/** @otter/browser's screens in this app: before the app renders. */
export function startBrowserUI(): void {
  setBrowserUIHost({
    enabled: features.browser,
    systemName: osNames.system,
    openSettings: () => void appApi.openSettings({ pane: "browser" }),
    shortcutText,
    FindBar,
    isFindKey,
    settingProps: searchableSetting,
    addChatPage(chatId, { url, title }) {
      if (!useChats.getState().conversations.some((c) => c.id === chatId)) return "";
      const id = `page:agent:${crypto.randomUUID()}`;
      openChatTab(chatId, { kind: "page", url }, title, { id });
      return id;
    },
  });
}
