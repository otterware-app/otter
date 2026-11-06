import { useEffect } from "react";
import { useAtomValue } from "@effect/atom-react";
import { makeChatsStore, type ChatsState } from "@otter-mail/client-runtime/state/chats";

import { appAtomRegistry } from "../atom-registry";
import { closeChatPages } from "../browser/store";
import { clientPlatform, core } from "../client-platform";
import { EXTENSIONS } from "../extensions/registry";
import { isProviderUsable, useAgentProviders } from "./agent-providers";
import type { ProviderSnapshot } from "./api";
import { mergeChatChanges } from "./chat-changes";
import { isChatFileLink } from "./chat-links";
import { toast } from "./toast";

export {
  clampTitle,
  isBlank,
  isElsewhere,
  type ChatTab,
  type ChatTurn,
  type Conversation,
  type Outgoing,
  type QueuedMessage,
  type Run,
} from "@otter-mail/client-runtime/state/chats";

const chats = makeChatsStore<ProviderSnapshot>(appAtomRegistry, {
  core,
  platform: clientPlatform,
  providerName: (provider) =>
    EXTENSIONS.find((e) => e.manifest.id === provider)?.manifest.name ?? provider,
  isProviderUsable,
  isFileLink: isChatFileLink,
  mergeChanges: mergeChatChanges,
  closeChatPages,
  showError: (title, description) => toast.error(title, { description }),
  log: (event, data) => console.log(`[AgentChat:${event}]`, ...(data ? [data] : [])),
});

export function useChats<T>(select: (state: ChatsState) => T): T {
  return useAtomValue(chats.stateAtom, select);
}

export const chatsState = chats.get;

export const {
  loadChat,
  sendMessage,
  steerQueued,
  moveQueued,
  removeQueued,
  updateQueued,
  setEditingQueued,
  stopRun,
  respondApproval,
  answerQuestion,
  openChatTab,
  showChatTab,
  closeChatTab,
  reorderChatTabs,
  setDraft,
  setCitations,
  showChat,
  dockChat,
  undockChat,
  watchChat,
  shelveChat,
  newChat,
  deleteConversation,
  openServerSession,
  resumeRuns,
} = chats;

export function useChatEvents(): void {
  const providers = useAgentProviders().data?.providers;
  useEffect(() => (providers ? chats.followProviders(providers) : undefined), [providers]);
  useEffect(() => chats.start(), []);
}
