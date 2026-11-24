import { useChats } from "@otter/client/agents/chat-store";
import { runRequests } from "@otter/client/agents/composer";
import { memo, use, useEffect, type ComponentRef, type RefObject } from "react";
import { View, type TextInput } from "react-native";

import { ApprovalCard, QuestionCard } from "./ask-cards.tsx";
import { useChatAgent } from "./chat-agent.ts";
import { Composer } from "./composer.tsx";
import { ComposerPanelContext } from "./composer-panel.ts";
import { WorkingControl } from "./working-control.tsx";

/**
 * Under a chat's transcript: the composer, what the agent asks of you and the queue
 * (Composer.swift, AskCards.swift). The chat screen places it, keeps it over the keyboard and
 * pads it from the bottom edge; it draws from its top edge to the end of its own content.
 */
export const ChatFooter = memo(function ChatFooter({
  chatId,
  input,
}: {
  chatId: string;
  input: RefObject<ComponentRef<typeof TextInput> | null>;
}) {
  const run = useChats((s) => s.runs[chatId]) ?? null;
  const approvals = useChats((s) => s.approvals);
  const questions = useChats((s) => s.questions);
  const asks = runRequests(run, { approvals, questions });
  const agent = useChatAgent(chatId).label;
  const approval = asks.approvals[0]?.approval;
  const question = asks.questions[0]?.question;
  const asking = Boolean(approval || question);
  const { setOpen } = use(ComposerPanelContext);
  useEffect(() => {
    if (asking) setOpen(false);
  }, [asking, setOpen]);
  return (
    <View>
      <WorkingControl chatId={chatId} />
      {approval ? (
        <ApprovalCard
          key={approval.id}
          chatId={chatId}
          agent={agent}
          approval={approval}
          count={asks.approvals.length}
        />
      ) : question ? (
        <QuestionCard
          key={question.id}
          agent={agent}
          question={question}
          count={asks.questions.length}
        />
      ) : (
        <Composer chatId={chatId} input={input} />
      )}
    </View>
  );
});
