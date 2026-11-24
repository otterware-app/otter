import { useAgentProviders } from "@otter/client/agents/agent-providers";
import { newChat } from "@otter/client/agents/chat-store";
import { haptics } from "@otter/ui-native/haptics";
import { router, useNavigationContainerRef } from "expo-router";
import { useEffect } from "react";

type Container = ReturnType<typeof useNavigationContainerRef>;

let container: Container | null = null;
const presented = new Set<string>();

/** A tab's stack says which of its routes present (sheets, covers): `TabStack`'s `presented`. */
export function presents(names: string[]): void {
  for (const name of names) presented.add(name);
}

/** The root layout hands over the navigation, for `closeSheets` to look through. */
export function useFollowNavigation(): void {
  const ref = useNavigationContainerRef();
  useEffect(() => {
    container = ref;
  }, [ref]);
}

/**
 * Closes the sheets and covers in front, so what opens next isn't left behind them (a link, a
 * notification's chat, `openChat`): they're the routes on top of the stack in front that
 * present.
 */
export function closeSheets(): void {
  if (!container?.isReady()) return;
  let state = container.getRootState();
  for (;;) {
    const route = state.routes[state.index ?? state.routes.length - 1];
    if (!route?.state) break;
    state = route.state as typeof state;
  }
  let count = 0;
  for (let i = state.routes.length - 1; i > 0 && presented.has(state.routes[i].name); i -= 1)
    count += 1;
  if (count > 0) router.dismiss(count);
}

/** Opens a chat in the Chats tab, over its list, from wherever you are. */
export function openChat(id: string): void {
  closeSheets();
  router.navigate({ pathname: "/agents/[id]", params: { id } });
}

/** New chat: a chat with the agent new chats go to, ready to type; with none yet, adding one. */
export function useAsk(): () => void {
  const selected = useAgentProviders().data?.selected;
  return () => {
    haptics.tap();
    if (selected) openChat(newChat(selected));
    else router.navigate("/settings/agents/new");
  };
}
