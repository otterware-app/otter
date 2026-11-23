import {
  useState,
  type ComponentProps,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";
import { ChevronDownIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";

import { cn } from "../lib/utils";
import { IconButton } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { ScrollArea } from "./scroll-area";
import { HintTooltip } from "./tooltip";

/** A sidebar row's box: 28px, the body size, its own hover and pressed tints. */
const sidebarRowClassName =
  "group flex h-7 w-full cursor-pointer items-center gap-2 rounded-md text-left text-body font-medium outline-none focus-visible:ring-2 focus-visible:ring-focus-ring active:bg-sidebar-row-active";

const ROW_STATE = {
  selected: "bg-sidebar-row-selected text-sidebar-foreground",
  idle: "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
};

const ICON_STATE = {
  selected: "text-sidebar-foreground",
  idle: "text-sidebar-muted-foreground group-hover:text-sidebar-foreground",
};

const DROP_TARGET = "bg-sidebar-row-hover ring-1 ring-inset ring-primary/70";

/** The sidebar's scrolling content, under its fixed header. */
function SidebarBody({
  children,
  contentClassName,
  flushBottom = false,
}: {
  children: ReactNode;
  contentClassName?: string;
  flushBottom?: boolean;
}) {
  return (
    <ScrollArea
      className="flex-1"
      viewportClassName={cn(
        "scroll-fade-y px-(--sidebar-content-inset) pt-3",
        flushBottom ? "pb-2" : "pb-8",
      )}
      contentClassName={contentClassName}
    >
      {children}
    </ScrollArea>
  );
}

/** An action at the top of the sidebar (New message, New chat): a row with an icon. */
function SidebarAction({
  icon,
  label,
  selected = false,
  tour,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  icon: ReactNode;
  label: string;
  selected?: boolean;
  tour?: string;
}) {
  return (
    <div className="flex shrink-0 flex-col px-(--sidebar-content-inset)" data-tour={tour}>
      <button
        type="button"
        data-slot="sidebar-action"
        aria-current={selected ? "page" : undefined}
        className={cn(
          sidebarRowClassName,
          "px-(--sidebar-row-content-inset)",
          selected ? ROW_STATE.selected : ROW_STATE.idle,
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5",
            selected ? ICON_STATE.selected : ICON_STATE.idle,
          )}
        >
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </button>
    </div>
  );
}

/** A count at the end of a row. */
function SidebarBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      data-slot="sidebar-badge"
      className="ml-auto shrink-0 text-xs tabular-nums text-sidebar-muted-foreground"
    >
      {count > 999 ? "999+" : count}
    </span>
  );
}

/**
 * A place in the sidebar: an icon, its name, and a count, a dot or actions
 * (`trailing`, shown on hover in the count's place). `depth` indents it under its parent.
 */
function SidebarRow({
  icon,
  title,
  selected = false,
  badge,
  trailing,
  depth = 0,
  dropActive = false,
  dot = false,
  className,
  style,
  ...props
}: Omit<ComponentProps<"button">, "children" | "title"> & {
  icon: ReactNode;
  title: string;
  selected?: boolean;
  badge?: number;
  trailing?: ReactNode;
  depth?: number;
  dropActive?: boolean;
  dot?: boolean;
}) {
  return (
    <button
      type="button"
      data-slot="sidebar-row"
      style={{ paddingLeft: 10 + depth * 16, ...style }}
      className={cn(
        sidebarRowClassName,
        "pr-(--sidebar-row-content-inset)",
        selected ? ROW_STATE.selected : ROW_STATE.idle,
        dropActive && DROP_TARGET,
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "flex min-w-4 shrink-0 items-center justify-center [&>svg.lucide]:size-3.5",
          selected ? ICON_STATE.selected : ICON_STATE.idle,
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {trailing ? (
        <span className="relative ml-auto flex h-5 min-w-5 shrink-0 items-center justify-end">
          {badge != null && badge > 0 ? (
            <span className="group-hover:invisible group-focus-within:invisible">
              <SidebarBadge count={badge} />
            </span>
          ) : null}
          <span className="absolute inset-y-0 right-0 flex items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            {trailing}
          </span>
        </span>
      ) : badge != null ? (
        <SidebarBadge count={badge} />
      ) : dot ? (
        <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-primary" />
      ) : null}
    </button>
  );
}

/** Opens and closes by sliding (rows 0fr ⇄ 1fr), so no height is measured. */
function SidebarCollapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** A group of rows under a small muted heading with its caret after it (Linear's "Workspace ▾"). */
function SidebarSection({
  title,
  count,
  action,
  children,
  dropZone,
  tour,
  depth = 0,
  defaultOpen = true,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  depth?: number;
  tour?: string;
  dropZone?: {
    active: boolean;
    onDragOver: (e: ReactDragEvent<HTMLDivElement>) => void;
    onDragLeave: (e: ReactDragEvent<HTMLDivElement>) => void;
    onDrop: (e: ReactDragEvent<HTMLDivElement>) => void;
  };
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div data-slot="sidebar-section" className={depth > 0 ? "mt-1" : "mt-4"} data-tour={tour}>
      <div
        className={cn(
          "group flex h-7 items-center gap-1 rounded-md pr-1",
          dropZone?.active && DROP_TARGET,
        )}
        onDragOver={dropZone?.onDragOver}
        onDragLeave={dropZone?.onDragLeave}
        onDrop={dropZone?.onDrop}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={depth > 0 ? { paddingLeft: 10 + depth * 16 } : undefined}
          className="flex h-7 items-center gap-1 rounded-md px-(--sidebar-row-content-inset) text-xs font-medium text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
          aria-label={`Toggle ${title}`}
        >
          {title}
          {count != null ? (
            <span className="ms-0.5 tabular-nums text-sidebar-muted-foreground/70">{count}</span>
          ) : null}
          <ChevronDownIcon className={cn("size-3 transition-transform", !open && "-rotate-90")} />
        </button>
        <span className="flex-1" />
        <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          {action}
        </span>
      </div>
      <SidebarCollapse open={open}>{children}</SidebarCollapse>
    </div>
  );
}

/** The + at the end of a section's heading. */
function SidebarSectionAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <HintTooltip label={label}>
      <IconButton
        label={label}
        size="icon-xs"
        onClick={onClick}
        className="hover:bg-sidebar-row-hover"
      >
        <PlusIcon className="size-4" />
      </IconButton>
    </HintTooltip>
  );
}

type SidebarSwitcherItem = {
  id: string;
  label: string;
  /** A picture or mark, `size-5 rounded-md`. */
  icon: ReactNode;
  /** After the name in the menu, muted: an alias's address. */
  detail?: string;
  accelerator?: string;
  /** Something new there: a dot in the menu, and on the button when it isn't the one shown. */
  dot?: boolean;
};

/** The switcher between mailboxes, drives…: the one shown, and a menu of the rest. */
function SidebarSwitcher({
  items,
  selectedId,
  onSelect,
  tour,
}: {
  items: SidebarSwitcherItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  tour?: string;
}) {
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  if (!selected) return null;
  const elsewhere = items.some((item) => item.id !== selected.id && item.dot);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            data-tour={tour}
            data-slot="sidebar-switcher"
            className={cn(
              sidebarRowClassName,
              "h-8 px-1.5 text-sidebar-foreground hover:bg-sidebar-row-hover data-popup-open:bg-sidebar-row-hover",
            )}
          />
        }
      >
        {selected.icon}
        <span className="min-w-0 truncate">{selected.label}</span>
        {elsewhere ? (
          <span
            aria-label="New elsewhere"
            className="size-1.5 shrink-0 rounded-full bg-sidebar-foreground"
          />
        ) : null}
        <ChevronsUpDownIcon className="ms-auto size-3.5 shrink-0 text-sidebar-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-(--anchor-width)">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            icon={item.icon}
            accelerator={item.accelerator}
            onClick={() => onSelect(item.id)}
          >
            <span className={item.id === selected.id ? "font-medium" : undefined}>
              {item.label}
            </span>
            {item.detail ? (
              <span className="ms-1.5 text-muted-foreground">{item.detail}</span>
            ) : null}
            {item.dot ? (
              <span
                aria-label="New"
                className="ms-1.5 inline-block size-1.5 rounded-full bg-foreground align-middle"
              />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type SidebarPickerItem = {
  id: string;
  label: string;
  icon: ReactNode;
  /** After the label in its tooltip (a shortcut). */
  hint?: ReactNode;
  /** Added to the tooltip: "Mail · in iCloud". */
  detail?: string;
  dot?: boolean | "attention";
};

/** The row of spaces at the sidebar's top (Mail, Calendar, Agents…): icons, the chosen one named. */
function SidebarPicker({
  items,
  selectedId,
  onSelect,
  onMove,
  itemProps,
  tour,
}: {
  items: readonly SidebarPickerItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Given, the items drag into order: `id` goes before or after `target`. */
  onMove?: (id: string, target: string, after: boolean) => void;
  /** Spread on each item's button. */
  itemProps?: ComponentProps<"button"> & { [data: `data-${string}`]: string | undefined };
  tour?: string;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const endDrag = () => {
    setDragged(null);
    setDrop(null);
  };
  return (
    <div
      data-slot="sidebar-picker"
      className="flex min-w-0 flex-wrap items-center gap-0.5"
      data-tour={tour}
    >
      {items.map(({ id, label, icon, hint, detail, dot = false }) => {
        const selected = id === selectedId;
        const dropHere = drop?.id === id ? drop : null;
        return (
          <HintTooltip
            key={id}
            label={detail ? `${label} · ${detail}` : label}
            hint={hint}
            disabled={selected || dragged !== null}
            // Above it are the title bar and the window's buttons.
            side="bottom"
          >
            <button
              type="button"
              aria-label={label}
              aria-current={selected ? "page" : undefined}
              onClick={() => onSelect(id)}
              {...itemProps}
              draggable={onMove ? true : undefined}
              onDragStart={
                onMove
                  ? (e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", label);
                      setDragged(id);
                    }
                  : undefined
              }
              onDragOver={(e) => {
                if (!dragged) return;
                e.preventDefault();
                if (dragged === id) {
                  setDrop(null);
                  return;
                }
                const box = e.currentTarget.getBoundingClientRect();
                setDrop({ id, after: e.clientX > box.left + box.width / 2 });
              }}
              onDrop={(e) => {
                if (!dragged) return;
                e.preventDefault();
                if (drop) onMove?.(dragged, drop.id, drop.after);
                endDrag();
              }}
              onDragEnd={endDrag}
              className={cn(
                "relative flex h-8 min-w-0 shrink-0 cursor-pointer items-center rounded-lg px-1.5 text-sm font-medium outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none",
                selected
                  ? "max-w-full shrink bg-sidebar-row-selected text-sidebar-foreground"
                  : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                dragged === id && "opacity-40",
              )}
            >
              {dropHere ? (
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-primary",
                    dropHere.after ? "-right-0.5" : "-left-0.5",
                  )}
                />
              ) : null}
              <span className="relative flex size-5 shrink-0 items-center justify-center [&>svg]:size-4">
                {icon}
                {dot && !selected ? (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-sidebar-surface",
                      dot === "attention" ? "bg-warning" : "bg-sidebar-foreground",
                    )}
                  />
                ) : null}
              </span>
              {/* Its width opens from nothing (a grid track 0fr → 1fr, its padding
                  clipped while folded), and it fades in. */}
              <span
                aria-hidden
                className={cn(
                  "grid min-w-0 overflow-hidden transition-[grid-template-columns,opacity] duration-200 ease-out motion-reduce:transition-none",
                  selected
                    ? "grid-cols-[minmax(0,1fr)] opacity-100"
                    : "grid-cols-[minmax(0,0fr)] opacity-0",
                )}
              >
                <span className="truncate ps-2 pe-1">{label}</span>
              </span>
            </button>
          </HintTooltip>
        );
      })}
    </div>
  );
}

export {
  SidebarAction,
  SidebarBadge,
  SidebarBody,
  SidebarCollapse,
  SidebarPicker,
  SidebarRow,
  SidebarSection,
  SidebarSectionAction,
  SidebarSwitcher,
  sidebarRowClassName,
  type SidebarPickerItem,
  type SidebarSwitcherItem,
};
