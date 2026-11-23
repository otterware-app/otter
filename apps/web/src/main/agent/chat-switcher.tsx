import { CheckIcon, PlusIcon } from "lucide-react";

import { AgentAvatar, openClawAgentId } from "./agent-providers";
import { AgentIcon } from "./agent-icon";
import { StatusDot, useChatStatus } from "./agent-corner";
import { useAutoSettleDays } from "./auto-settle";
import { isBlank, showChat, useChats, type Conversation } from "./chat-store";
import { shelveChats, useNow } from "./chat-shelves";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@otter/ui/components/dropdown-menu";

/** The small window's title menu: the active chats to switch to, a new one, or all of them. */
export function ChatSwitcherItems({
  onNewChat,
  onOpenAgents,
}: {
  onNewChat: () => void;
  onOpenAgents: () => void;
}) {
  const conversations = useChats((s) => s.conversations);
  const runs = useChats((s) => s.runs);
  const approvals = useChats((s) => s.approvals);
  const questions = useChats((s) => s.questions);
  const activeId = useChats((s) => s.activeId);
  const now = useNow(30_000);
  const autoSettleDays = useAutoSettleDays();
  const asked = new Set([...approvals, ...questions].map((r) => r.requestId));
  const needsYou = new Set(
    Object.values(runs).flatMap((r) => (asked.has(r.requestId) ? r.convoId : [])),
  );
  const shelves = shelveChats(
    conversations.filter((c) => !isBlank(c)),
    { working: new Set(Object.keys(runs)), needsYou, now, autoSettleDays },
  );
  const open = [...shelves.pinned, ...shelves.active];
  return (
    <>
      {open.length > 0 ? <DropdownMenuLabel>Active</DropdownMenuLabel> : null}
      {open.map((c) => (
        <SwitcherItem key={c.id} convo={c} current={c.id === activeId} />
      ))}
      {open.length > 0 ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem icon={<PlusIcon />} onClick={onNewChat}>
        New chat
      </DropdownMenuItem>
      <DropdownMenuItem icon={<AgentIcon className="size-4" />} onClick={onOpenAgents}>
        All chats
      </DropdownMenuItem>
    </>
  );
}

function SwitcherItem({ convo, current }: { convo: Conversation; current: boolean }) {
  const status = useChatStatus(convo.id);
  return (
    <DropdownMenuItem
      icon={
        <AgentAvatar
          id={convo.provider}
          agent={openClawAgentId(convo.sessionId)}
          className="size-4"
        />
      }
      onClick={() => showChat(convo.id)}
      className="max-w-80"
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        <span className="min-w-0 truncate">{convo.title}</span>
        {status ? <StatusDot status={status} /> : null}
        {current ? <CheckIcon className="ms-auto size-3.5 text-foreground" /> : null}
      </span>
    </DropdownMenuItem>
  );
}
