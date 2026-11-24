import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { AlarmClockIcon, CheckIcon, Maximize2Icon, MinusIcon } from "lucide-react";
import { AgentAvatar, openClawAgentId } from "./agent-providers";
import { BUTTON, drawNotch, Notch } from "./agent-corner";
import { ChatContextButton } from "./chat-context-panel";

import type { ChatChange } from "../mail/api";
import type { MailChatContext } from "./chat-context";
import { isBlank, openChatTab, useChats, watchChat } from "./chat-store";
import { settleChat, SnoozeMenu } from "./chat-shelve-actions";
import { ChatSwitcherItems } from "./chat-switcher";
import { ChatTitle, TitleMenuButton } from "./chat-title";
import { ChatView } from "./chat-view";
import { features } from "../features";
import { isOverlayOpen } from "../mail/keyboard";
import { ShortcutText } from "../keybindings/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { IconButton } from "@otter/ui/components/button";

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
  onNewChat,
  onOpenAgents,
  inputRef,
  animationMs,
  closing,
}: {
  context: MailChatContext;
  onClearQuote: () => void;
  onOpenChange: (change: ChatChange) => Promise<void>;
  onOpenWorkspace: (chatId: string) => void;
  onOpenTask: (key: string) => void;
  onMinimize: () => void;
  onShelve: () => void;
  onNewChat: () => void;
  onOpenAgents: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** Opening and closing take this long: the panel animation setting, or 0 without motion. */
  animationMs: number;
  /** Shrinking back into the agent's button, before it unmounts. */
  closing: boolean;
}) {
  const activeId = useChats((s) => s.activeId);
  const active = useChats((s) => s.conversations.find((c) => c.id === s.activeId));
  const blank = !active || isBlank(active);

  // Closing, it lets go at once: the Agent space it may be closing for watches the chat next.
  useEffect(() => {
    if (closing) return;
    watchChat(activeId);
    return () => watchChat(null);
  }, [activeId, closing]);
  const idleInputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [inputRef]);

  const panelRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(loadSize);
  const commitSize = (next: Size) => {
    setSize(next);
    localStorage.setItem(SIZE_KEY, JSON.stringify(next));
  };
  // The notch round it follows its size, drawn here rather than rendered: opening and closing,
  // it grows from the agent's button and shrinks back into it on every frame.
  const notchRef = useRef<SVGSVGElement>(null);
  const animating = useRef(false);
  /** How open it's drawn, 0 to 1: a reversal starts from there. */
  const progress = useRef(0);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const notch = notchRef.current;
    if (!panel || !notch) return;
    const draw = () => {
      // Only open and still: while it opens or closes, the animation draws it.
      if (!animating.current && progress.current === 1)
        drawNotch(notch, panel.offsetWidth, panel.offsetHeight);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const notch = notchRef.current;
    if (!panel || !notch) return;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const target = closing ? 0 : 1;
    if (closing && progress.current === 0) return;
    if (animationMs <= 0 || progress.current === target) {
      progress.current = target;
      panel.style.clipPath = "";
      panel.style.opacity = "";
      drawNotch(notch, width, height);
      return;
    }
    const from = progress.current;
    // From the first frame painted: mounting the chat can take a few frames itself.
    let start = -1;
    let raf = 0;
    animating.current = true;
    const frame = (now: number) => {
      if (start < 0) start = now;
      const t = Math.min(1, (now - start) / animationMs);
      const eased = 1 - (1 - t) ** 3;
      const k = from + (target - from) * eased;
      progress.current = k;
      const w = BUTTON + (width - BUTTON) * k;
      const h = BUTTON + (height - BUTTON) * k;
      panel.style.clipPath = `inset(${height - h}px 0 0 ${width - w}px round ${8 + 4 * k}px)`;
      panel.style.opacity = String(Math.min(1, k * 2));
      drawNotch(notch, w, h);
      if (t < 1) {
        raf = requestAnimationFrame(frame);
        return;
      }
      animating.current = false;
      if (!closing) {
        panel.style.clipPath = "";
        panel.style.opacity = "";
      }
    };
    frame(performance.now());
    start = -1;
    return () => {
      cancelAnimationFrame(raf);
      animating.current = false;
    };
  }, [animationMs, closing]);

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

  const switcher = <ChatSwitcherItems onNewChat={onNewChat} onOpenAgents={onOpenAgents} />;

  return (
    <>
      <Notch ref={notchRef} />
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
        inert={closing}
        // The frame's own palette: it sits in a notch of the frame, as the sidebar does.
        data-app-sidebar=""
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
        className="absolute right-1 bottom-1 z-40 h-[min(38rem,calc(100%-5.5rem))] w-[min(25rem,calc(100%-1.5rem))] text-sidebar-foreground"
      >
        {/* In the gap round it, outside the clip of its rounded corners. */}
        <button
          type="button"
          aria-label="Resize agent width"
          className="absolute inset-y-3 -left-1 z-20 w-2 touch-none cursor-ew-resize rounded-full outline-none hover:bg-input focus-visible:bg-focus-ring"
          onPointerDown={(event) => startResize(event, "width")}
          onKeyDown={(event) => resizeWithKeys(event, "width")}
        />
        <button
          type="button"
          aria-label="Resize agent height"
          className="absolute inset-x-3 -top-1 z-20 h-2 touch-none cursor-ns-resize rounded-full outline-none hover:bg-input focus-visible:bg-focus-ring"
          onPointerDown={(event) => startResize(event, "height")}
          onKeyDown={(event) => resizeWithKeys(event, "height")}
        />
        <button
          type="button"
          aria-label="Resize agent"
          className="absolute -top-1 -left-1 z-30 size-5 touch-none cursor-nwse-resize rounded-tl-xl outline-none focus-visible:bg-focus-ring"
          onPointerDown={(event) => startResize(event, "both")}
          onKeyDown={(event) => resizeWithKeys(event, "both")}
        />
        <div className="flex size-full flex-col overflow-hidden rounded-xl bg-sidebar-surface">
          <div className="relative flex h-11 shrink-0 items-center gap-1.5 border-b border-border/60 ps-3.5 pe-1.5">
            {active && !blank ? (
              <AgentAvatar id={active.provider} agent={openClawAgentId(active.sessionId)} />
            ) : (
              <AgentAvatar />
            )}
            {active && !blank ? (
              <ChatTitle
                chat={active}
                className="text-sm font-medium text-foreground"
                menu={switcher}
              />
            ) : (
              <span className="flex min-w-0 flex-1">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<TitleMenuButton className="text-sm font-medium text-foreground" />}
                  >
                    New chat
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>{switcher}</DropdownMenuContent>
                </DropdownMenu>
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
            <HintTooltip
              label="Minimize"
              hint={<ShortcutText command="agent.toggle" />}
              side="bottom"
            >
              <IconButton label="Minimize" onClick={onMinimize}>
                <MinusIcon className="size-4" />
              </IconButton>
            </HintTooltip>
            <HintTooltip
              label="Open in workspace"
              hint={<ShortcutText command="agent.openWorkspace" />}
              side="bottom"
            >
              <IconButton label="Open in workspace" onClick={() => onOpenWorkspace(activeId)}>
                <Maximize2Icon className="size-4" />
              </IconButton>
            </HintTooltip>
            {active && !blank ? (
              <>
                <SnoozeMenu chatId={activeId} side="bottom" onDone={onShelve}>
                  <IconButton label="Snooze">
                    <AlarmClockIcon className="size-4" />
                  </IconButton>
                </SnoozeMenu>
                <HintTooltip
                  label="Settle"
                  hint={<ShortcutText command="agent.settle" />}
                  side="bottom"
                >
                  <IconButton
                    label="Settle"
                    onClick={() => {
                      void settleChat(activeId);
                      onShelve();
                    }}
                  >
                    <CheckIcon className="size-4" />
                  </IconButton>
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
              inputRef={closing ? idleInputRef : inputRef}
              onOpenChange={onOpenChange}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
