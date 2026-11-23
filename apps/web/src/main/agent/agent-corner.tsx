import { useLayoutEffect, useRef, type RefObject } from "react";
import { AgentIcon } from "./agent-icon";

import { isBlank, useChats } from "./chat-store";
import { HintTooltip, cn } from "../mail/ui";

export type ChatStatus = "approval" | "input" | "working" | "failed" | "done" | null;

/** What a chat is doing, as the Agent space's list says it. */
export function useChatStatus(id: string): ChatStatus {
  return useChats((s) => {
    const run = s.runs[id];
    const asks = (r: { requestId: string }) => r.requestId === run?.requestId;
    if (run && s.approvals.some(asks)) return "approval";
    if (run && s.questions.some(asks)) return "input";
    if (run) return "working";
    if (s.conversations.find((c) => c.id === id)?.turns.at(-1)?.error) return "failed";
    return s.unseen.has(id) ? "done" : null;
  });
}

/** The list's status colors (agent-sidebar.tsx's `statusOf`). */
const STATUS_DOT: Record<NonNullable<ChatStatus>, string> = {
  approval: "bg-warning-foreground",
  input: "bg-indigo-600 dark:bg-indigo-300",
  working: "animate-pulse bg-info-foreground",
  failed: "bg-destructive-foreground",
  done: "bg-success-foreground",
};

export function StatusDot({ status, className }: { status: ChatStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status ? STATUS_DOT[status] : "bg-muted-foreground/70",
        className,
      )}
    />
  );
}

/** Card corners' radius (rounded-xl) and the frame's gap round them. */
const R = 12;
const GAP = 4;

function notchShape(width: number, height: number) {
  const w = width + 2 * GAP + R;
  const h = height + 2 * GAP + R;
  const bottom = h - GAP - 0.5;
  const right = w - GAP - 0.5;
  const edge = [
    `M 0 ${bottom}`,
    `A ${R} ${R} 0 0 0 ${R} ${bottom - R}`,
    `L ${R} ${2 * R}`,
    `A ${R} ${R} 0 0 1 ${2 * R} ${R}`,
    `L ${right - R} ${R}`,
    `A ${R} ${R} 0 0 0 ${right} 0`,
  ].join(" ");
  return { w, h, edge, fill: `${edge} L ${w} 0 L ${w} ${h} L 0 ${h} Z` };
}

/** How far it reaches above the cards' bottom edge, for the panes' `pb-agent-corner`. */
function setClearance(svg: SVGSVGElement, height: number) {
  svg.parentElement?.style.setProperty("--agent-corner-clearance", `${height + GAP}px`);
}

/**
 * A notch cut from the cards' bottom-right corner, round what sits there (`right-1 bottom-1`,
 * `width` by `height`): the agent's button, or its window in the button's place. Without a
 * size, `drawNotch` sizes it.
 */
export function Notch({
  width,
  height,
  ref,
}: {
  width?: number;
  height?: number;
  ref?: RefObject<SVGSVGElement | null>;
}) {
  const shape = width != null && height != null ? notchShape(width, height) : null;
  const svgRef = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (height != null) setClearance(svg, height);
    const frame = svg.parentElement;
    return () => {
      frame?.style.removeProperty("--agent-corner-clearance");
    };
  }, [height]);
  return (
    <svg
      ref={(el) => {
        svgRef.current = el;
        if (ref) ref.current = el;
      }}
      aria-hidden
      width={shape?.w ?? 0}
      height={shape?.h ?? 0}
      className="pointer-events-none absolute right-0 bottom-0 z-40 overflow-visible"
    >
      <path d={shape?.fill} className="fill-sidebar-surface" />
      <path
        d={shape?.edge}
        className="fill-none stroke-(--panel-edge) [stroke-width:1] dark:[stroke-width:0.5]"
      />
    </svg>
  );
}

export function drawNotch(svg: SVGSVGElement, width: number, height: number) {
  const { w, h, edge, fill } = notchShape(width, height);
  setClearance(svg, height);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  const [fillPath, edgePath] = svg.children;
  fillPath.setAttribute("d", fill);
  edgePath.setAttribute("d", edge);
}

export const BUTTON = 36;

/** The agent's button, in the corner's notch. */
export function AgentCorner({ onOpen }: { onOpen: () => void }) {
  const active = useChats((s) => s.conversations.find((c) => c.id === s.activeId));
  const thread = active && !isBlank(active) ? active : null;
  const status = useChatStatus(thread?.id ?? "");
  return (
    <>
      <Notch width={BUTTON} height={BUTTON} />
      <HintTooltip label="Agent" shortcut="agent.toggle" side="top">
        <button
          type="button"
          aria-label="Agent"
          data-tour="chats"
          onClick={onOpen}
          style={{ width: BUTTON, height: BUTTON }}
          className="absolute right-1 bottom-1 z-40 flex cursor-pointer items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <AgentIcon className="size-4" />
          {thread ? (
            <StatusDot
              status={status}
              className="absolute top-1.5 right-1.5 ring-2 ring-sidebar-surface"
            />
          ) : null}
        </button>
      </HintTooltip>
    </>
  );
}
