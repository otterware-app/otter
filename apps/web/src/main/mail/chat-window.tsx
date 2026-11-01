/**
 * The agent over the mail (⌘I): a small window at the workspace's bottom
 * right, over the bottom bar (chat-bar.tsx), showing one chat with the mail on
 * screen as its context. Linear's: minimize keeps the chat as a tab in the
 * bar, close takes it out (it stays in history), and open in workspace takes
 * it to the AI workspace, where what it used and made are tabs.
 */

import { useEffect, type RefObject } from "react";
import { Maximize2Icon, MinusIcon, XIcon } from "lucide-react";
import { AgentAvatar, openClawAgentId } from "./agent-providers";

import type { ChatChange } from "./api";
import type { MailChatContext } from "./chat-context";
import { dockChat, isBlank, useChats, watchChat } from "./chat-store";
import { ChatView } from "./chat-view";
import { isOverlayOpen } from "./keyboard";
import { HintTooltip, IconBtn } from "./ui";

export function ChatWindow({
  context,
  onClearQuote,
  onOpenChange,
  onOpenWorkspace,
  onMinimize,
  onClose,
  inputRef,
}: {
  context: MailChatContext;
  onClearQuote: () => void;
  onOpenChange: (change: ChatChange) => Promise<void>;
  onOpenWorkspace: (chatId: string) => void;
  /** Hides the window; the chat stays a tab in the bar. */
  onMinimize: () => void;
  /** Hides the window and takes the chat's tab out of the bar. */
  onClose: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const activeId = useChats((s) => s.activeId);
  const active = useChats((s) => s.conversations.find((c) => c.id === s.activeId));
  const blank = !active || isBlank(active);

  // Its replies are seen while it's open.
  useEffect(() => {
    watchChat(activeId);
    return () => watchChat(null);
  }, [activeId]);
  // A chat showing here is a tab in the bar, once it has a first message.
  useEffect(() => {
    if (!blank) dockChat(activeId);
  }, [activeId, blank]);
  // Opening it puts you in its composer.
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [inputRef]);

  return (
    // Not a dialog: it sits beside the mail, whose shortcuts (and ⌘I to hide it) keep working.
    <div
      role="region"
      aria-label="Agent"
      data-tour="agent"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // Escape in here minimizes it, unless something in it (a menu, the skills list) took it.
          if (!e.defaultPrevented && !isOverlayOpen()) {
            e.preventDefault();
            onMinimize();
          }
          e.stopPropagation();
          return;
        }
        // The mail's one-key shortcuts don't act from in here; ⌘ and Ctrl ones do.
        if (!e.metaKey && !e.ctrlKey && !e.altKey) e.stopPropagation();
      }}
      className="absolute bottom-10 right-2 z-30 flex h-[min(38rem,calc(100%-5.5rem))] w-[min(27rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-canvas shadow-[0_24px_60px_-20px_rgb(0_0_0/45%)] dark:shadow-[0_24px_60px_-20px_rgb(0_0_0/80%)]"
    >
      <div className="relative flex h-11 shrink-0 items-center gap-1 border-b border-border/60 ps-3.5 pe-1.5">
        {active && !blank ? (
          <AgentAvatar kind={active.provider} agent={openClawAgentId(active.sessionId)} />
        ) : (
          <AgentAvatar />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {active && !blank ? active.title : "New chat"}
        </span>
        <HintTooltip label="Minimize" shortcut="agent.toggle" side="bottom">
          <IconBtn label="Minimize" className="size-7" onClick={onMinimize}>
            <MinusIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
        <HintTooltip label="Open in workspace" shortcut="agent.openWorkspace" side="bottom">
          <IconBtn
            label="Open in workspace"
            className="size-7"
            onClick={() => onOpenWorkspace(activeId)}
          >
            <Maximize2Icon className="size-4" />
          </IconBtn>
        </HintTooltip>
        <HintTooltip label="Close" side="bottom">
          <IconBtn label="Close" className="size-7" onClick={onClose}>
            <XIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
      </div>
      {activeId ? (
        <ChatView
          compact
          chatId={activeId}
          context={context}
          onClearQuote={onClearQuote}
          inputRef={inputRef}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </div>
  );
}
