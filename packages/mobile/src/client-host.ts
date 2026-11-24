import type { Host } from "@otter/client/host";
import { AppState } from "react-native";

import { showNotice } from "./notices.ts";

/** @otter/client's host on the phone: in front while active, leaving when it goes to the background. */
export function phoneHost(storage: Host["storage"]): Host {
  return {
    storage,
    focused: () => AppState.currentState === "active",
    onFocusChange(listener) {
      const subscription = AppState.addEventListener("change", listener);
      return () => subscription.remove();
    },
    onLeave(listener) {
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "background") listener();
      });
      return () => subscription.remove();
    },
    notice: showNotice,
    agentMark: () => undefined,
  };
}
