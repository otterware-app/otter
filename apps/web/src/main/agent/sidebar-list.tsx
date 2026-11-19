/**
 * Adapted from T3 Code (github.com/pingdotgg/t3code at a1e7ac2b2; MIT, see THIRD_PARTY_NOTICES.md):
 * apps/web/src/components/sidebar/SidebarListMarkers.tsx and SortableThreadRow in
 * sidebar/SidebarThreadRow.tsx.
 */
import { useLayoutEffect, type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlarmClockOffIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  PinIcon,
  PinOffIcon,
  Undo2Icon,
} from "lucide-react";
import { animateLayoutChanges, markerId, type DropVerb, type ListMarker } from "./sidebar-drag";
import { cn } from "../mail/ui";

// useSortable memoizes on its `disabled` object, so a fresh one each render re-renders every row.
const DRAG_DISABLED = { draggable: true } as const;
const DRAG_ENABLED = { draggable: false } as const;

/** A chat's row in the list, which a drag picks up. */
export function SortableRow({
  id,
  disabled,
  className,
  children,
}: {
  id: string;
  disabled: boolean;
  className?: string;
  children: (dragging: boolean) => ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: disabled ? DRAG_DISABLED : DRAG_ENABLED,
    animateLayoutChanges,
  });
  return (
    <li
      ref={setNodeRef}
      data-chat-item={id}
      {...listeners}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        // A zero-height boundary also makes dnd-kit scale the source to zero. Only projected
        // peers use scaleY as a visibility sentinel.
        visibility: !isDragging && transform?.scaleY === 0 ? "hidden" : undefined,
      }}
      className={cn("list-none", isDragging && "relative z-20", className)}
    >
      {children(isDragging)}
    </li>
  );
}

function SortableMarker({
  marker,
  className,
  revealOverflow = false,
  children,
}: {
  marker: ListMarker;
  className?: string;
  revealOverflow?: boolean;
  children?: ReactNode;
}) {
  const { node, setNodeRef, transform, transition } = useSortable({
    id: markerId(marker),
    disabled: DRAG_DISABLED,
    animateLayoutChanges,
  });
  // Keeps the projected drop box inside the scroll viewport as the drag moves it.
  useLayoutEffect(() => {
    if (revealOverflow && transform?.y !== undefined)
      node.current?.firstElementChild?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [node, revealOverflow, transform?.y]);
  return (
    <li
      ref={setNodeRef}
      data-marker={marker}
      className={cn("list-none", className)}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: marker.endsWith("-placeholder") ? "none" : transition,
        visibility: transform?.scaleY === 0 ? "hidden" : undefined,
      }}
    >
      {children}
    </li>
  );
}

/** "Pinned" over the pinned chats and "Active" under them, while a chat is dragged. */
export function DragBoundary({
  marker,
  label,
  visible,
  dropTarget,
}: {
  marker: "pinned-header" | "pinned-divider";
  label: string;
  visible: boolean;
  dropTarget: boolean;
}) {
  return (
    <SortableMarker marker={marker} className="pointer-events-none relative -mb-px h-0">
      {visible ? (
        <div className="sidebar-drag-boundary-label absolute inset-x-2 top-1 flex h-4 items-center gap-2">
          <span
            className={cn(
              "shrink-0 text-xs font-medium",
              dropTarget ? "text-primary" : "text-sidebar-foreground/80",
            )}
          >
            {label}
          </span>
          <span
            aria-hidden
            className={cn("h-px flex-1", dropTarget ? "bg-primary/50" : "bg-sidebar-foreground/25")}
          />
        </div>
      ) : null}
    </SortableMarker>
  );
}

/** Where a chat drops on a shelf that has none. */
export function ShelfPlaceholder({
  marker,
  label,
  visible,
  dropTarget,
}: {
  marker: "active-placeholder" | "settled-placeholder";
  label: string;
  visible: boolean;
  dropTarget: boolean;
}) {
  return (
    <SortableMarker
      marker={marker}
      className="relative -mb-px h-0"
      // Revealing on every drag scrolls the list out from under the pointer.
      revealOverflow={marker === "settled-placeholder" && visible && dropTarget}
    >
      {visible ? (
        <div
          className={cn(
            "absolute inset-x-0 top-0 flex h-9 items-center justify-center rounded-lg border border-dashed border-sidebar-foreground/25 text-xs text-sidebar-foreground/80",
            dropTarget && "border-primary/40 bg-primary/5 text-primary",
          )}
        >
          {label}
        </div>
      ) : null}
    </SortableMarker>
  );
}

export function ShelfHeader({
  marker,
  label,
  count,
  open,
  onToggle,
  dragging = false,
  dropTarget = false,
  className,
}: {
  marker: "snoozed-header" | "settled-header";
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  dragging?: boolean;
  dropTarget?: boolean;
  className?: string;
}) {
  return (
    <SortableMarker marker={marker} className={cn("relative h-8", className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-(--sidebar-row-content-inset) text-left text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
          dropTarget
            ? "text-primary"
            : dragging
              ? "text-sidebar-foreground"
              : "text-sidebar-muted-foreground hover:text-sidebar-foreground",
        )}
      >
        <span className="flex-1">{label}</span>
        <span className="font-normal tabular-nums">{count}</span>
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
        />
      </button>
    </SortableMarker>
  );
}

const DROP_VERBS: Record<DropVerb, { icon: typeof PinIcon; label: string }> = {
  pin: { icon: PinIcon, label: "Pin" },
  unpin: { icon: PinOffIcon, label: "Unpin" },
  settle: { icon: CircleCheckIcon, label: "Settle" },
  unsettle: { icon: Undo2Icon, label: "Unsettle" },
  wake: { icon: AlarmClockOffIcon, label: "Wake" },
};

/** What letting go of a dragged chat, or sweeping over one, will do to it. */
export function DropBadge({ verb }: { verb: DropVerb }) {
  const { icon: Icon, label } = DROP_VERBS[verb];
  return (
    <span
      role="status"
      className="pointer-events-none ms-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-primary/40 bg-primary/10 px-1.5 text-2xs font-medium text-primary"
    >
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  );
}
