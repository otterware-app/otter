import type { CoreBridge } from "@otter-mail/client-runtime/connection";
import type { ClientPlatform } from "@otter-mail/client-runtime/platform";

/** What client-runtime's state needs of this window. */
export const clientPlatform: ClientPlatform = {
  storage: {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
  },
  focus: {
    isFocused: () => document.hasFocus(),
    onFocus(listener) {
      window.addEventListener("focus", listener);
      return () => window.removeEventListener("focus", listener);
    },
  },
  newId: () => crypto.randomUUID(),
};

export const core: CoreBridge = {
  invoke: (channel, params) => window.desktopBridge.invoke(channel, params),
  on: (channel, listener) => window.desktopBridge.on(channel, listener),
};
