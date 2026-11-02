import type { ComponentType, ReactNode } from "react";
import { useRouter, type RouterHistory } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import {
  ArchiveIcon,
  ArchiveXIcon,
  BookmarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  FileIcon,
  InboxIcon,
  LayersIcon,
  MailIcon,
  MailsIcon,
  SendIcon,
  Settings2Icon,
  SquarePenIcon,
  StarIcon,
  FlagIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react";
import { AgentIcon } from "./agent-icon";
import { IconBtn, HintTooltip, cn } from "./ui";
import { getAccountDisplayName } from "./account-style";
import { useAllAccountLabels } from "./hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./menu";
import { useRecentlyViewed, type RecentIcon } from "../recently-viewed";
import type { MailAccount } from "./types";
import type { KeybindingCommand } from "../keybindings/commands";
import { shortcutLabelFor, useKeybindingsState } from "../keybindings/store";
import { features } from "../features";

/**
 * Every column owns the slice of the title band above it, so the pane
 * separators run all the way up. These pieces fill those slices: the window
 * title (traffic lights, sidebar toggle, wordmark), the mailbox breadcrumb,
 * and the right-hand controls.
 */

let trackedHistory: RouterHistory | null = null;
let furthestIndex = 0;

function trackHistory(history: RouterHistory): void {
  if (trackedHistory === history) return;
  trackedHistory = history;
  furthestIndex = history.location.state.__TSR_index;
  history.subscribe(({ location, action }) => {
    const index = location.state.__TSR_index;
    furthestIndex = action.type === "PUSH" ? index : Math.max(furthestIndex, index);
  });
}

export const RECENT_ICONS: Record<RecentIcon, ComponentType<{ className?: string }>> = {
  inbox: InboxIcon,
  starred: StarIcon,
  flagged: FlagIcon,
  sent: SendIcon,
  drafts: FileIcon,
  important: BookmarkIcon,
  allmail: MailsIcon,
  archive: ArchiveIcon,
  junk: ArchiveXIcon,
  trash: Trash2Icon,
  custom: LayersIcon,
  label: TagIcon,
  conversation: MailIcon,
  settings: Settings2Icon,
  compose: SquarePenIcon,
  chat: AgentIcon,
};

function RecentlyViewedMenu() {
  const { navigate } = useRouter();
  const places = useRecentlyViewed();
  return (
    <DropdownMenu>
      <HintTooltip label="Recently viewed">
        <DropdownMenuTrigger asChild>
          <IconBtn label="Recently viewed" className="no-drag pointer-events-auto">
            <ClockIcon className="size-4" />
          </IconBtn>
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent align="start" className="w-[26rem]">
        <DropdownMenuLabel>Recently viewed</DropdownMenuLabel>
        {places.length === 0 ? (
          <p className="px-2.5 pb-2 pt-1 text-sm text-muted-foreground">
            Conversations and mailboxes you open show up here.
          </p>
        ) : (
          places.map((place) => {
            const Icon = RECENT_ICONS[place.icon] ?? MailIcon;
            return (
              <DropdownMenuItem
                key={place.href}
                onSelect={() => void navigate({ href: place.href })}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-muted-foreground">
                    {place.context}
                  </span>
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{place.title}</span>
                </span>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function HistoryControls() {
  const { history } = useRouter();
  trackHistory(history);
  const where = useSyncExternalStore(history.subscribe, () => {
    const index = history.location.state.__TSR_index;
    return `${index > 0 ? "back" : ""} ${index < furthestIndex ? "forward" : ""}`;
  });
  if (!features.historyButtons) return null;
  return (
    <div className="flex items-center gap-1">
      <RecentlyViewedMenu />
      <HintTooltip label="Back">
        <IconBtn
          label="Back"
          className="no-drag pointer-events-auto"
          disabled={!where.includes("back")}
          onClick={() => history.back()}
        >
          <ChevronLeftIcon className="size-4" />
        </IconBtn>
      </HintTooltip>
      <HintTooltip label="Forward">
        <IconBtn
          label="Forward"
          className="no-drag pointer-events-auto"
          disabled={!where.includes("forward")}
          onClick={() => history.forward()}
        >
          <ChevronRightIcon className="size-4" />
        </IconBtn>
      </HintTooltip>
    </div>
  );
}

/**
 * The sidebar and browser panel toggles' icon: ChatGPT's and Linear's soft
 * frame, in Lucide's strokes so it sits with the rest. The pane is filled
 * while it's open, a thin bar while it's closed.
 */
export function PaneIcon({
  side,
  open,
  className,
}: {
  side: "left" | "right";
  open: boolean;
  className?: string;
}) {
  const x = side === "left" ? 8 : 16;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <rect x="3" y="4" width="18" height="16" rx="4" />
      {open ? (
        <rect
          x={x - 1.5}
          y="7.5"
          width="3"
          height="9"
          rx="1"
          fill="currentColor"
          strokeWidth="1.5"
        />
      ) : (
        <path d={`M${x} 8v8`} strokeWidth="1.5" />
      )}
    </svg>
  );
}

/**
 * The sidebar toggle and back/forward, pinned at one window position (Otter
 * Code's SidebarControl, ChatGPT's): right of the traffic lights, whether the
 * sidebar is open or not, so nothing moves when it opens or closes. The
 * bands under them leave room (`SidebarTitle`, `TitlebarInset`).
 */
export function SidebarControl({
  sidebarOpen,
  onToggleSidebar,
  onHover,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onHover?: (inside: boolean) => void;
}) {
  return (
    <div className="pointer-events-none fixed left-(--workspace-controls-left) top-0 z-40 flex h-(--workspace-topbar-height) items-center gap-1">
      <HintTooltip label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} shortcut="sidebar.toggle">
        <IconBtn
          label="Toggle sidebar"
          className="no-drag pointer-events-auto"
          onClick={onToggleSidebar}
          onMouseEnter={onHover ? () => onHover(true) : undefined}
          onMouseLeave={onHover ? () => onHover(false) : undefined}
        >
          <PaneIcon side="left" open={sidebarOpen} className="size-4" />
        </IconBtn>
      </HintTooltip>
      {/* Under the window's tabs, history sits by them (window-tabs.tsx). */}
      {features.windowTabs ? null : <HistoryControls />}
    </div>
  );
}

export function PanelControl({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="pointer-events-none fixed right-(--workspace-controls-right) top-0 z-40 flex h-(--workspace-topbar-height) items-center">
      <HintTooltip
        label={open ? "Hide browser" : "Show browser"}
        shortcut="browser.toggle"
        side="bottom"
      >
        <IconBtn label="Toggle browser" className="no-drag pointer-events-auto" onClick={onToggle}>
          <PaneIcon side="right" open={open} className="size-4" />
        </IconBtn>
      </HintTooltip>
    </div>
  );
}

export function PanelControlSlot() {
  if (features.windowTabs) return null;
  return (
    <span
      aria-hidden
      className="w-[calc(var(--workspace-titlebar-control-size)+var(--workspace-window-controls-width))] shrink-0"
    />
  );
}

/**
 * Room left at the start of the band next to the rail (sidebar hidden) for
 * what sits over it: traffic lights, toggle, arrows. A view's space has no
 * sidebar, so no toggle (`SidebarControl`): only the traffic lights.
 */
export function TitlebarInset() {
  if (features.windowTabs) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0",
        features.historyButtons
          ? "w-[max(0px,calc(var(--workspace-titlebar-content-left)+var(--workspace-history-controls-width)-1rem-var(--workspace-frame-inset)))]"
          : "w-[max(0px,calc(var(--workspace-titlebar-content-left)-1rem-var(--workspace-frame-inset)))]",
      )}
    />
  );
}

export function WindowTitle({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "drag-region flex h-(--workspace-topbar-height) shrink-0 items-center pl-(--workspace-titlebar-content-left) pr-3 web:pl-6",
        className,
      )}
    >
      {/* Wordmark in Otter Code's style: brand word, then the product muted. */}
      <span className="inline-flex min-w-0 select-none items-baseline gap-1 whitespace-nowrap text-sm font-medium tracking-tight">
        <span className="text-foreground">Otter</span>
        <span className="truncate text-muted-foreground">Mail</span>
      </span>
    </div>
  );
}

/**
 * Settings' title band in the main window: the traffic lights, the pinned
 * toggle and back/forward sit over it. A browser tab has none of them there,
 * so Settings' heading takes the band instead.
 */
export function SidebarTitle() {
  if (features.windowTabs) return null;
  return <div className="drag-region h-(--workspace-topbar-height) shrink-0 web:hidden" />;
}

export type MailboxOption = {
  id: string;
  account: MailAccount;
  name: string;
  shortcut: string;
};

export function useMailboxOptions(accounts: MailAccount[]): MailboxOption[] {
  const { resolved: keybindings } = useKeybindingsState();
  const jump = (digit: number) =>
    shortcutLabelFor(keybindings, `mailbox.jump.${digit}` as KeybindingCommand) ?? "";
  return accounts.map((account, i) => ({
    id: account.id,
    account,
    name: getAccountDisplayName(account),
    shortcut: jump(i + 1),
  }));
}

export function useInboxUnread(accounts: MailAccount[]): Record<string, number> {
  return Object.fromEntries(
    useAllAccountLabels(accounts.map((a) => a.id)).map(({ accountId, labels }) => [
      accountId,
      labels.find((l) => l.id === "INBOX")?.unread ?? 0,
    ]),
  );
}

export function TitleTrailing({ showPanelToggle }: { showPanelToggle: boolean }) {
  return <>{showPanelToggle ? <PanelControlSlot /> : null}</>;
}

export function TitleControls({
  leading,
  syncing,
  syncLabel,
  showPanelToggle,
}: {
  leading?: ReactNode;
  syncing: boolean;
  syncLabel: string;
  showPanelToggle: boolean;
}) {
  return (
    <div
      data-toolbar=""
      className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-3 px-4"
    >
      {leading}
      {syncing ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="size-1.5 shrink-0 rounded-full bg-primary animate-status-pulse"
            aria-hidden
          />
          <span className="max-w-64 truncate text-xs text-muted-foreground">{syncLabel}</span>
        </div>
      ) : null}
      <span className="min-w-0 flex-1" />
      <TitleTrailing showPanelToggle={showPanelToggle} />
    </div>
  );
}
