import { useAgentProviders } from "@otter/client/agents/agent-providers";
import { newChat } from "@otter/client/agents/chat-store";
import { haptics } from "@otter/ui-native/haptics";
import { router } from "expo-router";

/** Opens a chat in the Chats tab, over its list, from wherever you are. */
export const openChat = (id: string) =>
  router.navigate({ pathname: "/chats/[id]", params: { id } });

/** New chat: a chat with the agent new chats go to, ready to type; with none yet, adding one. */
export function useAsk(): () => void {
  const selected = useAgentProviders().data?.selected;
  return () => {
    haptics.tap();
    if (selected) openChat(newChat(selected));
    else router.navigate("/settings/agents/new");
  };
}
