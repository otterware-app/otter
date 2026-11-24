import { openClawAgentId, useChatProvider } from "@otter/client/agents/agent-providers";
import { agentNameOf } from "@otter/client/agents/chat-list";
import { useChats } from "@otter/client/agents/chat-store";
import { pickedAgent } from "@otter/client/agents/model-picker";

import { agentTraits } from "../agents/registry.ts";

/**
 * Who a chat's footer talks to: its own agent once it has started, else the one new chats start
 * with, and for a gateway the gateway's agent (by name, as the cards say it).
 */
export function useChatAgent(chatId: string) {
  const convo = useChats((s) => s.conversations.find((c) => c.id === chatId));
  const chat = useChatProvider(convo);
  const traits = agentTraits(chat.provider?.kind);
  const blank = !convo || convo.turns.length === 0;
  const gatewayAgent = pickedAgent(
    chat.provider,
    blank ? null : openClawAgentId(convo.sessionId),
    Boolean(traits?.subAgents),
  ).slug;
  return {
    ...chat,
    convo,
    traits,
    blank,
    gatewayAgent,
    label: agentNameOf(chat.state, chat.id ?? "", gatewayAgent),
  };
}
