import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { AlarmClockIcon, CheckIcon, Maximize2Icon, MinusIcon } from "lucide-react";
import { AgentAvatar, openClawAgentId } from "./agent-providers";
import { ChatContextButton } from "./chat-context-panel";

import type { ChatChange } from "../mail/api";
import type { MailChatContext } from "./chat-context";
import { isBlank, openChatTab, useChats, watchChat } from "./chat-store";
import { settleChat, SnoozeMenu } from "./chat-shelve-actions";
import { ChatTitle } from "./chat-title";
import { ChatView } from "./chat-view";
import { features } from "../features";
import { isOverlayOpen } from "../mail/keyboard";
import { HintTooltip, IconBtn } from "../mail/ui";

type Size = { width: number; height: number };
type Axis = "width" | "height" | "both";
const SIZE_KEY = "gmail:chat-window-size";

function loadSize(): Size | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "null");
    return saved && saved.width > 0 && saved.height > 0 ? saved : null;
  } catch {
    return null;
  }
}

/** The same margins as the default size's `calc(100% - …)`. */
function fit(size: Size, area: DOMRect | undefined): Size {
  const maxWidth = area ? area.width - 24 : Infinity;
  const maxHeight = area ? area.height - 88 : Infinity;
  return {
    width: Math.round(Math.max(320, Math.min(maxWidth, size.width))),
    height: Math.round(Math.max(280, Math.min(maxHeight, size.height))),
  };
}

export function ChatWindow({
  context,
  onClearQuote,
  onOpenChange,
  onOpenWorkspace,
  onOpenTask,
  onMinimize,
  onShelve,
  inputRef,
}: {
  context: MailChatContext;
  onClearQuote: () => void;
  onOpenChange: (change: ChatChange) => Promise<void>;
  onOpenWorkspace: (chatId: string) => void;
  onOpenTask: (key: string) => void;
  onMinimize: () => void;
  onShelve: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const activeId = useChats((s) => s.activeId);
  const active = useChats((s) => s.conversations.find((c) => c.id === s.activeId));
  const blank = !active || isBlank(active);

  useEffect(() => {
    watchChat(activeId);
    return () => watchChat(null);
  }, [activeId]);
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [inputRef]);

  const panelRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(loadSize);
  const commitSize = (next: Size) => {
    setSize(next);
    localStorage.setItem(SIZE_KEY, JSON.stringify(next));
  };
  const resized = (axis: Axis, dx: number, dy: number) => {
    const panel = panelRef.current!;
    const start = panel.getBoundingClientRect();
    return fit(
      {
        width: start.width + (axis === "height" ? 0 : dx),
        height: start.height + (axis === "width" ? 0 : dy),
      },
      panel.offsetParent?.getBoundingClientRect(),
    );
  };

  const startResize = (event: PointerEvent<HTMLButtonElement>, axis: Axis) => {
    if (event.button !== 0 || !panelRef.current) return;
    event.preventDefault();
    const panel = panelRef.current;
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = resized(axis, 0, 0);
    let latest = startSize;
    const cover = document.createElement("div");
    cover.className = "no-drag fixed inset-0 z-[200] touch-none select-none";
    cover.style.cursor =
      axis === "both" ? "nwse-resize" : axis === "width" ? "ew-resize" : "ns-resize";
    document.body.append(cover);
    const move = (next: globalThis.PointerEvent) => {
      latest = fit(
        {
          width: startSize.width + (axis === "height" ? 0 : startX - next.clientX),
          height: startSize.height + (axis === "width" ? 0 : startY - next.clientY),
        },
        panel.offsetParent?.getBoundingClientRect(),
      );
      panel.style.width = `${latest.width}px`;
      panel.style.height = `${latest.height}px`;
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      cover.remove();
      commitSize(latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
  };

  const resizeWithKeys = (event: KeyboardEvent<HTMLButtonElement>, axis: Axis) => {
    const step = event.shiftKey ? 32 : 16;
    const dx = { ArrowLeft: step, ArrowRight: -step }[event.key] ?? 0;
    const dy = { ArrowUp: step, ArrowDown: -step }[event.key] ?? 0;
    if ((axis === "height" || !dx) && (axis === "width" || !dy)) return;
    event.preventDefault();
    commitSize(resized(axis, dx, dy));
  };

  return (
    <div
      ref={panelRef}
      style={
        size
          ? {
              width: `min(${size.width}px, calc(100% - 1.5rem))`,
              height: `min(${size.height}px, calc(100% - 5.5rem))`,
            }
          : undefined
      }
      role="region"
      aria-label="Agent"
      data-tour="agent"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
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
      className="absolute bottom-10 right-2 z-30 flex h-[min(38rem,calc(100%-5.5rem))] w-[min(25rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-canvas shadow-[0_24px_60px_-20px_rgb(0_0_0/45%)] dark:shadow-[0_24px_60px_-20px_rgb(0_0_0/80%)]"
    >
      <button
        type="button"
        aria-label="Resize agent width"
        className="absolute inset-y-3 left-0 z-20 w-1.5 touch-none cursor-ew-resize outline-none hover:bg-input focus-visible:bg-focus-ring"
        onPointerDown={(event) => startResize(event, "width")}
        onKeyDown={(event) => resizeWithKeys(event, "width")}
      />
      <button
        type="button"
        aria-label="Resize agent height"
        className="absolute inset-x-3 top-0 z-20 h-1.5 touch-none cursor-ns-resize outline-none hover:bg-input focus-visible:bg-focus-ring"
        onPointerDown={(event) => startResize(event, "height")}
        onKeyDown={(event) => resizeWithKeys(event, "height")}
      />
      <button
        type="button"
        aria-label="Resize agent"
        className="absolute left-0 top-0 z-20 size-3 touch-none cursor-nwse-resize outline-none focus-visible:bg-focus-ring"
        onPointerDown={(event) => startResize(event, "both")}
        onKeyDown={(event) => resizeWithKeys(event, "both")}
      />
      <div className="relative flex h-11 shrink-0 items-center gap-1 border-b border-border/60 ps-3.5 pe-1.5">
        {active && !blank ? (
          <AgentAvatar kind={active.provider} agent={openClawAgentId(active.sessionId)} />
        ) : (
          <AgentAvatar />
        )}
        {active && !blank ? (
          <ChatTitle chat={active} className="text-sm font-medium text-foreground" />
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            New chat
          </span>
        )}
        {active && !blank ? (
          <ChatContextButton
            convo={active}
            onOpenTask={onOpenTask}
            // What it opens shows in the workspace, beside the chat.
            onOpen={(tab) => {
              if (tab.ref.kind === "page" && !features.browser) {
                window.open(tab.ref.url, "_blank", "noopener");
                return;
              }
              openChatTab(activeId, tab.ref, tab.title, { id: tab.id });
              onOpenWorkspace(activeId);
            }}
          />
        ) : null}
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
        {active && !blank ? (
          <>
            <SnoozeMenu chatId={activeId} side="bottom" onDone={onShelve}>
              <IconBtn label="Snooze" className="size-7">
                <AlarmClockIcon className="size-4" />
              </IconBtn>
            </SnoozeMenu>
            <HintTooltip label="Settle" side="bottom">
              <IconBtn
                label="Settle"
                className="size-7"
                onClick={() => {
                  settleChat(activeId);
                  onShelve();
                }}
              >
                <CheckIcon className="size-4" />
              </IconBtn>
            </HintTooltip>
          </>
        ) : null}
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
