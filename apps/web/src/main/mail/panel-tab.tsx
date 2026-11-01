import { useEffect, useRef, type ReactNode } from "react";
import { XIcon } from "lucide-react";

import { cn } from "./ui";

/**
 * A pill tab (Codex's): a page in the browser panel, or one of a chat's tabs
 * in the AI workspace.
 * The × closes it (always on the selected tab, on hover otherwise), and so
 * does a middle-click, as in a browser. In a strip too narrow for them all,
 * tabs give way down to a width that still names them, then the strip
 * scrolls, and a tab that gets selected scrolls into view.
 */
export function PanelTab({
  id,
  title,
  tooltip = title,
  icon,
  selected,
  onSelect,
  onClose,
  dragging = false,
  closable = true,
  className,
}: {
  id: string;
  title: string;
  tooltip?: string;
  icon: ReactNode;
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
  dragging?: boolean;
  /** Whether it has a × (the window's last tab doesn't). */
  closable?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);
  // The pill holds the tab and, beside it rather than in it, its ×: a tab's
  // contents are one name to assistive tech, so a × inside couldn't be pressed.
  return (
    <div
      ref={ref}
      data-panel-tab-id={id}
      title={tooltip}
      onAuxClick={(e) => {
        if (e.button === 1 && closable) onClose();
      }}
      className={cn(
        "group/tab relative flex h-7 min-w-32 max-w-44 shrink touch-none cursor-pointer select-none items-center rounded-lg pr-1 text-sm has-[[role=tab]:focus-visible]:ring-2 has-[[role=tab]:focus-visible]:ring-inset has-[[role=tab]:focus-visible]:ring-focus-ring",
        selected || dragging
          ? "bg-foreground/10 text-foreground"
          : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
        dragging && "z-10 cursor-grabbing bg-canvas shadow-sm ring-1 ring-border",
        className,
      )}
    >
      <div
        role="tab"
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch pl-2.5 pr-1.5 outline-none"
      >
        <span className="relative flex size-3.5 shrink-0 items-center justify-center">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </div>
      {closable ? (
        <button
          type="button"
          aria-label={`Close ${title}`}
          onClick={onClose}
          className={cn(
            "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-focus-ring",
            selected ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100",
          )}
        >
          <XIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
