import { focusManager } from "@tanstack/react-query";
import { makeThreadLists } from "@otter-mail/client-runtime/state/messages";

import { appAtomRegistry } from "../atom-registry";
import { core } from "../client-platform";

/** The main window's mailbox lists, client-runtime's atoms; they refetch on focus as queries do. */
export const threadLists = makeThreadLists(appAtomRegistry, {
  core,
  focus: {
    isFocused: () => focusManager.isFocused(),
    onFocus: (listener) => focusManager.subscribe((focused) => focused && listener()),
  },
  log: (event, data) => console.log(`[threadLists:${event}]`, data ?? ""),
});
