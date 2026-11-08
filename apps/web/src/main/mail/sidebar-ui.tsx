import {
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";
import { ChevronDownIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { ScrollArea } from "~/components/ui/scroll-area";

import type { KeybindingCommand } from "../keybindings/commands";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./menu";
import { HintTooltip, UnreadPill, cn } from "./ui";
import { PLACE } from "../place-menu";

export type RowDragProps = {
  draggable?: boolean;
  onDragStart?: (e: ReactDragEvent<HTMLButtonElement>) => void;
  onDragOver?: (e: ReactDragEvent<HTMLButtonElement>) => void;
  onDragLeave?: (e: ReactDragEvent<HTMLButtonElement>) => void;
  onDrop?: (e: ReactDragEvent<HTMLButtonElement>) => void;
};

export const SIDEBAR_ROW =
  "group flex h-7 w-full cursor-pointer items-center gap-2 rounded-md text-left text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-focus-ring active:bg-sidebar-row-active";

export function NewRow({
  icon,
  label,
  selected = false,
  tour,
  place = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  selected?: boolean;
  tour?: string;
  /** Goes to a place (not a dialog): it opens in a new window too. */
  place?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col px-(--sidebar-content-inset)" data-tour={tour}>
      <button
        type="button"
        onClick={onClick}
        {...(place ? PLACE : {})}
        aria-current={selected ? "page" : undefined}
        className={`${SIDEBAR_ROW} px-(--sidebar-row-content-inset) ${
          selected
            ? "bg-sidebar-row-selected text-sidebar-foreground"
            : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
        }`}
      >
        <span
          className={`flex shrink-0 [&_svg]:size-4 ${
            selected
              ? "text-sidebar-foreground"
              : "text-sidebar-muted-foreground group-hover:text-sidebar-foreground"
          }`}
        >
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </button>
    </div>
  );
}

export function SidebarBody({
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
      viewportClassName={`scroll-fade-y px-(--sidebar-content-inset) pt-3 ${flushBottom ? "pb-2" : "pb-8"}`}
      contentClassName={contentClassName}
    >
      {children}
    </ScrollArea>
  );
}

export function SkRow({
  icon,
  title,
  selected,
  badge,
  trailing,
  depth = 0,
  onClick,
  dragProps,
  dropActive,
  dot,
  place = false,
}: {
  icon: ReactNode;
  title: string;
  selected?: boolean;
  badge?: number;
  trailing?: ReactNode;
  depth?: number;
  onClick?: () => void;
  dragProps?: RowDragProps;
  dropActive?: boolean;
  dot?: boolean;
  /** Goes to a place: it opens in a new window too. */
  place?: boolean;
}) {
  const style: CSSProperties = { paddingLeft: 10 + depth * 16 };
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      {...dragProps}
      {...(place ? PLACE : {})}
      className={[
        SIDEBAR_ROW,
        "pr-(--sidebar-row-content-inset)",
        selected
          ? "bg-sidebar-row-selected text-sidebar-foreground"
          : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        dropActive ? "bg-sidebar-row-hover ring-1 ring-inset ring-primary/70" : "",
      ].join(" ")}
    >
      <span
        className={[
          "flex shrink-0 items-center",
          selected
            ? "text-sidebar-foreground"
            : "text-sidebar-muted-foreground group-hover:text-sidebar-foreground",
        ].join(" ")}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {trailing ? (
        <span className="relative ml-auto flex h-5 min-w-5 shrink-0 items-center justify-end">
          {badge != null && badge > 0 ? (
            <span className="group-hover:invisible group-focus-within:invisible">
              <UnreadPill count={badge} />
            </span>
          ) : null}
          <span className="absolute inset-y-0 right-0 flex items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            {trailing}
          </span>
        </span>
      ) : badge != null ? (
        <UnreadPill count={badge} />
      ) : dot ? (
        <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-primary" />
      ) : null}
    </button>
  );
}

export function Section({
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
    <div className={depth > 0 ? "mt-1" : "mt-4"} data-tour={tour}>
      <div
        className={[
          "group flex h-7 items-center gap-1 rounded-md pr-1",
          dropZone?.active ? "bg-sidebar-row-hover ring-1 ring-inset ring-primary/70" : "",
        ].join(" ")}
        onDragOver={dropZone?.onDragOver}
        onDragLeave={dropZone?.onDragLeave}
        onDrop={dropZone?.onDrop}
      >
        {/* A small muted heading with its caret after it (Linear's "Workspace ▾"). */}
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
          <ChevronDownIcon
            className={["size-3 transition-transform", open ? "" : "-rotate-90"].join(" ")}
          />
        </button>
        <span className="flex-1" />
        <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          {action}
        </span>
      </div>
      {/* Opens and closes by sliding (rows 0fr ⇄ 1fr), so no height is measured. */}
      <div
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

const SECTION_ACTION =
  "flex size-6 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring data-[state=open]:bg-sidebar-row-hover";

export function SectionAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <HintTooltip label={label}>
      <button type="button" aria-label={label} onClick={onClick} className={SECTION_ACTION}>
        <PlusIcon className="size-4" />
      </button>
    </HintTooltip>
  );
}

export type SidebarSwitcherItem = {
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

/** The sidebar's switcher between mailboxes, drives…: the one shown, and a menu of the rest. */
export function SidebarSwitcher({
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
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-tour={tour}
          className={`${SIDEBAR_ROW} h-8 px-1.5 text-sidebar-foreground hover:bg-sidebar-row-hover data-[state=open]:bg-sidebar-row-hover`}
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
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-(--radix-dropdown-menu-trigger-width)">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            icon={item.icon}
            accelerator={item.accelerator}
            onSelect={() => onSelect(item.id)}
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

export type SidebarPickerItem = {
  id: string;
  label: string;
  icon: ReactNode;
  hint?: string;
  shortcut?: KeybindingCommand;
  /** Added to the tooltip: "Mail · in iCloud". */
  detail?: string;
  dot?: boolean;
};

export function SidebarPicker({
  items,
  selectedId,
  onSelect,
  onMove,
  tour,
}: {
  items: readonly SidebarPickerItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Given, the items drag into order: `id` goes before or after `target`. */
  onMove?: (id: string, target: string, after: boolean) => void;
  tour?: string;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const endDrag = () => {
    setDragged(null);
    setDrop(null);
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-0.5" data-tour={tour}>
      {items.map(({ id, label, icon, hint, shortcut, detail, dot = false }) => {
        const selected = id === selectedId;
        const dropHere = drop?.id === id ? drop : null;
        return (
          <HintTooltip
            key={id}
            label={detail ? `${label} · ${detail}` : label}
            hint={hint}
            shortcut={shortcut}
            disabled={selected || dragged !== null}
            // Above it are the title bar and the window's buttons.
            side="bottom"
          >
            <button
              type="button"
              aria-label={label}
              aria-current={selected ? "page" : undefined}
              onClick={() => onSelect(id)}
              {...PLACE}
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
                    className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-sidebar-foreground ring-2 ring-sidebar-surface"
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
