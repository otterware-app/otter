import { memo, useState, type ComponentType, type ReactNode } from "react";
import { ChevronDownIcon, PlusIcon, SettingsIcon, SquarePenIcon } from "lucide-react";

import { CalendarSidebar } from "../calendar/calendar-sidebar";
import type { WorkspaceProps } from "../extensions/types";
import { useWorkspaces, type Workspace } from "../extensions/workspaces";
import type { CalendarMode } from "../calendar/dates";
import { MODE_JUMP_COMMANDS } from "../keybindings/commands";
import { shortcutText } from "../keybindings/keys";
import { ShortcutText } from "../keybindings/store";
import { UpdateButton } from "../updates";
import { AccountPicture } from "./account-picture";
import { MailboxFolders, SearchRow, type SidebarSearch } from "./accounts-sidebar";
import { AddMailboxMenu } from "./add-mailbox";
import { AgentIcon } from "../agent/agent-icon";
import { type NavGlyphProps, OtterCalendarIcon, OtterMailIcon } from "./app-icons";
import { AgentSidebar } from "../agent/agent-sidebar";
import type { SettingsPane } from "./api";
import { useChats } from "../agent/chat-store";
import { useAddAccount, useViewUnreadCounts } from "./hooks";
import { ScheduledMailButton } from "./mail-schedule";
import { useSidebarLayout } from "./sidebar-layout";
import { useAppLayout } from "../theme/interface-settings";
import {
  SidebarCollapse,
  SidebarAction,
  sidebarRowClassName,
  SidebarSection,
  SidebarSectionAction,
  SidebarBody,
  SidebarPicker,
  SidebarSwitcher,
  SidebarRow,
  SidebarBadge,
} from "@otter/ui/components/sidebar";
import { VIEW_LIST, type AppMode } from "./spaces";
import { SignInCards, SyncButton } from "./sync-health";
import { toast } from "@otter/ui/components/toast";
import { useInboxUnread, useMailboxOptions, type MailboxOption } from "./top-bar";
import type { MailAccount, MailView } from "./types";
import type { MailboxTab } from "../mailboxes";
import { ViewMark } from "./view-icon";
import { inNewWindow } from "../new-window-click";
import { PLACE } from "../place-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@otter/ui/components/context-menu";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { IconButton } from "@otter/ui/components/button";
import { cn } from "@otter/ui/lib/utils";

function AppSidebarView({
  accounts,
  tabs,
  views,
  mode,
  spaceId,
  labelId,
  workspace,
  settingsOpen,
  composing,
  onMode,
  onGo,
  onMoveMailbox,
  onSelectChat,
  onNewChat,
  onCompose,
  onNewView,
  onEditView,
  onOpenSettings,
  searches,
  onSelectSearch,
  onCloseSearch,
}: {
  accounts: MailAccount[];
  tabs: MailboxTab[];
  views: MailView[];
  mode: AppMode;
  spaceId: string | null;
  labelId: string;
  workspace: (WorkspaceProps & { workspace: Workspace }) | null;
  settingsOpen: boolean;
  composing: boolean;
  onMode: (mode: AppMode) => void;
  onGo: (spaceId: string, labelId?: string) => void;
  /** Puts mailbox `id` before or after `target`. */
  onMoveMailbox: (id: string, target: string, after: boolean) => void;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onCompose: () => void;
  onNewView: () => void;
  onEditView: (viewId: string) => void;
  onOpenSettings: (pane?: SettingsPane) => void;
  searches: SidebarSearch[];
  onSelectSearch: (id: string) => void;
  onCloseSearch: (id: string) => void;
}) {
  const margin = useAppLayout() === "margin";
  const options = useMailboxOptions(tabs);
  const all = useSidebarLayout().mailboxes === "all" && options.length > 1;
  const isMailbox = (id: string | null) => options.some((option) => option.id === id);
  const [lastMailbox, setLastMailbox] = useState<string | null>(null);
  if (isMailbox(spaceId) && spaceId !== lastMailbox) setLastMailbox(spaceId);
  const mailbox = isMailbox(spaceId)
    ? spaceId
    : isMailbox(lastMailbox)
      ? lastMailbox
      : (options[0]?.id ?? null);
  const spaceTab = tabs.find((tab) => tab.id === spaceId);
  const healthIds = spaceTab ? [spaceTab.account.id] : accounts.map((a) => a.id);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* The Margin layout switches modes on its rail. */}
      {margin ? null : (
        <div className="flex shrink-0 flex-col px-(--sidebar-content-inset) pt-(--sidebar-content-inset) pb-2">
          <ModePicker mode={composing ? "mail" : mode} accounts={accounts} onMode={onMode} />
        </div>
      )}
      {workspace && !composing ? (
        <workspace.workspace.Sidebar
          location={workspace.location}
          item={workspace.item}
          go={workspace.go}
        />
      ) : mode === "calendar" ? (
        <CalendarSidebar accounts={accounts} mode={labelId as CalendarMode} />
      ) : mode === "agent" ? (
        <AgentSidebar chatId={labelId} onSelect={onSelectChat} onNewChat={onNewChat} />
      ) : (
        <>
          <div className="flex shrink-0 flex-col pt-(--sidebar-content-inset)">
            <SidebarAction
              icon={<SquarePenIcon />}
              label="New message"
              selected={composing}
              tour="compose"
              {...PLACE}
              onClick={onCompose}
            />
            <ScheduledMailButton />
          </div>
          {options.length > 0 && !all ? (
            <div className="flex shrink-0 flex-col px-(--sidebar-content-inset) pt-3">
              <MailboxSwitcher
                options={options}
                tabs={tabs}
                selectedId={mailbox}
                onSelect={(id) => onGo(id)}
              />
            </div>
          ) : null}
          <MailPage
            accounts={accounts}
            views={views}
            options={options}
            tabs={all ? tabs : tabs.filter((tab) => tab.id === mailbox)}
            all={all}
            onMoveMailbox={onMoveMailbox}
            spaceId={composing ? null : spaceId}
            labelId={labelId}
            onGo={onGo}
            onNewView={onNewView}
            onEditView={onEditView}
            searches={searches}
            onSelectSearch={onSelectSearch}
            onCloseSearch={onCloseSearch}
          />
        </>
      )}
      <SignInCards accountIds={healthIds} />
      <div className="flex shrink-0 items-center gap-0.5 px-(--sidebar-content-inset) pb-(--sidebar-content-inset)">
        <HintTooltip label="Settings" hint={shortcutText("mod+,")}>
          <IconButton
            label="Settings"
            active={settingsOpen}
            onClick={() => onOpenSettings()}
            {...PLACE}
          >
            <SettingsIcon />
          </IconButton>
        </HintTooltip>
        {mode === "mail" ? <SyncButton accountIds={healthIds} /> : null}
        <UpdateButton />
      </div>
    </div>
  );
}

export type AppModeEntry = {
  mode: AppMode;
  label: string;
  Icon: ComponentType<Pick<NavGlyphProps, "selected" | "className">>;
  dot: boolean | "attention";
};

/** The modes, in this computer's order: the switcher's, and the Margin layout's rail. */
export function useAppModes(accounts: MailAccount[]) {
  const unread = Object.values(useInboxUnread(accounts)).some((n) => n > 0);
  const agentDot = useChats((s): boolean | "attention" =>
    s.approvals.length > 0 || s.questions.length > 0 ? "attention" : s.unseen.size > 0,
  );
  const workspaces = useWorkspaces();
  const [order, setOrder] = useState(loadModeOrder);
  const modes: AppModeEntry[] = [
    { mode: "mail", label: "Mail", Icon: OtterMailIcon, dot: unread },
    {
      mode: "calendar",
      label: "Calendar",
      Icon: OtterCalendarIcon,
      dot: false,
    },
    ...workspaces.map((w) => ({
      mode: `workspace:${w.id}` as const,
      label: w.title,
      Icon: w.Icon,
      dot: false,
    })),
    { mode: "agent", label: "Agent", Icon: AgentIcon, dot: agentDot },
  ];
  const sorted = orderModes(modes, order);
  const move = (id: string, target: string, after: boolean) => {
    const shown = sorted.map((m) => m.mode as string).filter((m) => m !== id);
    shown.splice(shown.indexOf(target) + (after ? 1 : 0), 0, id);
    // A mode hidden now (a workspace turned off) keeps its saved place.
    const next = [...shown, ...order.filter((m) => !shown.includes(m))];
    setOrder(next);
    saveModeOrder(next);
  };
  return { modes: sorted, move };
}

function ModePicker({
  mode,
  accounts,
  onMode,
}: {
  mode: AppMode;
  accounts: MailAccount[];
  onMode: (mode: AppMode) => void;
}) {
  const { modes: sorted, move } = useAppModes(accounts);
  return (
    <SidebarPicker
      tour="modes"
      itemProps={PLACE}
      selectedId={mode}
      onSelect={(id) => onMode(id as AppMode)}
      onMove={move}
      items={sorted.map((m, i) => ({
        id: m.mode,
        label: m.label,
        icon: <m.Icon selected={m.mode === mode} />,
        hint:
          i < MODE_JUMP_COMMANDS.length ? (
            <ShortcutText command={MODE_JUMP_COMMANDS[i]} />
          ) : undefined,
        dot: m.dot,
      }))}
    />
  );
}

/** This computer's order of the mode switcher; not synced. */
const MODE_ORDER_KEY = "otter:mode-order";
/** Mailboxes closed in the sidebar on this computer; not synced. */
const CLOSED_MAILBOXES_KEY = "otter:closed-mailboxes";

function loadList(key: string): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveList(key: string, list: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Unsaved, it lasts until reload.
  }
}

export const loadModeOrder = () => loadList(MODE_ORDER_KEY);

/** The mode switcher's order: modes not yet ordered (new ones) keep their place after the ordered ones. */
export function orderModes<T extends { mode: string }>(modes: T[], order: string[]): T[] {
  const rank = (mode: string) => {
    const at = order.indexOf(mode);
    return at < 0 ? order.length : at;
  };
  return modes
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank(a.m.mode) - rank(b.m.mode) || a.i - b.i)
    .map(({ m }) => m);
}
const saveModeOrder = (order: string[]) => saveList(MODE_ORDER_KEY, order);

function MailboxSwitcher({
  options,
  tabs,
  selectedId,
  onSelect,
}: {
  options: MailboxOption[];
  tabs: MailboxTab[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const unread = useInboxUnread(
    tabs.flatMap((tab) => (tab.alias ? [] : [tab.account])),
    tabs.flatMap((tab) => (tab.alias ? [tab.alias] : [])),
  );
  return (
    <SidebarSwitcher
      tour="mailbox"
      selectedId={selectedId}
      onSelect={onSelect}
      items={options.map((option) => ({
        id: option.id,
        label: option.name,
        icon: <AccountPicture account={option.account} className="size-5 rounded-md text-3xs" />,
        detail: option.detail,
        accelerator: option.shortcut,
        dot: (unread[option.id] ?? 0) > 0,
      }))}
    />
  );
}

function MailPage({
  accounts,
  views,
  options,
  tabs,
  all,
  spaceId,
  labelId,
  onGo,
  onMoveMailbox,
  onNewView,
  onEditView,
  searches,
  onSelectSearch,
  onCloseSearch,
}: {
  accounts: MailAccount[];
  views: MailView[];
  options: MailboxOption[];
  /** The mailboxes shown: every one, or the one picked. */
  tabs: MailboxTab[];
  all: boolean;
  spaceId: string | null;
  labelId: string;
  onGo: (spaceId: string, labelId?: string) => void;
  onMoveMailbox: (id: string, target: string, after: boolean) => void;
  onNewView: () => void;
  onEditView: (viewId: string) => void;
  searches: SidebarSearch[];
  onSelectSearch: (id: string) => void;
  onCloseSearch: (id: string) => void;
}) {
  const viewUnread = useViewUnreadCounts(views, accounts);
  const addAccount = useAddAccount();

  const addGmail = async () => {
    console.log("[AppSidebar:addAccount]");
    try {
      const account = await addAccount.mutateAsync();
      if (account) onGo(account.id);
    } catch (err) {
      toast.error("Couldn't add the account", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };
  const searchRows = (parent: string, depth: number) =>
    searches
      .filter((search) => search.parent === parent)
      .map((search) => (
        <SearchRow
          key={search.id}
          search={search}
          depth={depth}
          onSelect={() => onSelectSearch(search.id)}
          onClose={() => onCloseSearch(search.id)}
        />
      ));

  const folders = (tab: MailboxTab, depth?: number) => {
    const showing = tab.id === spaceId;
    return (
      <MailboxFolders
        key={tab.id}
        mailboxId={tab.account.id}
        alias={tab.alias?.id}
        selectedLabelId={showing ? labelId : ""}
        onSelectLabel={(label) => onGo(tab.id, label)}
        searchRows={showing ? searchRows : undefined}
        depth={depth}
      />
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarBody>
        {all ? (
          <div data-tour="mailbox">
            <MailboxGroups options={options} tabs={tabs} spaceId={spaceId} onMove={onMoveMailbox}>
              {(tab) => folders(tab, 1)}
            </MailboxGroups>
          </div>
        ) : tabs[0] ? (
          folders(tabs[0])
        ) : (
          <AddMailboxMenu onGmail={() => void addGmail()} onAdded={(a) => onGo(a.id)}>
            <button
              type="button"
              className={`${sidebarRowClassName} px-(--sidebar-row-content-inset) text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground`}
            >
              <PlusIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />
              <span className="truncate">Add mailbox</span>
            </button>
          </AddMailboxMenu>
        )}

        {/* Views: one list of what their filters find, across the mailboxes. */}
        <SidebarSection
          title="Views"
          action={<SidebarSectionAction label="New view" onClick={onNewView} />}
        >
          {views.map((view) => (
            <ContextMenu key={view.id}>
              <ContextMenuTrigger>
                <SidebarRow
                  icon={
                    <span className="flex size-4 items-center justify-center [&>svg]:size-4">
                      <ViewMark view={view} className="text-sm" />
                    </span>
                  }
                  title={view.name}
                  selected={view.id === spaceId}
                  badge={viewUnread[view.id] ?? 0}
                  {...PLACE}
                  onClick={() => onGo(view.id, VIEW_LIST)}
                />
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => inNewWindow(() => onGo(view.id, VIEW_LIST))}>
                  Open in New Window
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => onEditView(view.id)}>Edit view…</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </SidebarSection>
      </SidebarBody>
    </div>
  );
}

/**
 * Every mailbox with its folders, one under another, each closing to its row and dragged by it
 * into order (Linear's teams).
 */
function MailboxGroups({
  options,
  tabs,
  spaceId,
  onMove,
  children,
}: {
  options: MailboxOption[];
  tabs: MailboxTab[];
  spaceId: string | null;
  onMove: (id: string, target: string, after: boolean) => void;
  children: (tab: MailboxTab) => ReactNode;
}) {
  const badgeStyle = useSidebarLayout().badge;
  const unread = useInboxUnread(
    tabs.flatMap((tab) => (tab.alias ? [] : [tab.account])),
    tabs.flatMap((tab) => (tab.alias ? [tab.alias] : [])),
  );
  const [closed, setClosed] = useState(() => loadList(CLOSED_MAILBOXES_KEY));
  const toggle = (id: string) => {
    const next = closed.includes(id) ? closed.filter((c) => c !== id) : [...closed, id];
    setClosed(next);
    saveList(CLOSED_MAILBOXES_KEY, next);
  };
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const endDrag = () => {
    setDragged(null);
    setDrop(null);
  };
  return tabs.map((tab, i) => {
    const option = options.find((o) => o.id === tab.id);
    if (!option) return null;
    const open = !closed.includes(tab.id);
    const count = unread[tab.id] ?? 0;
    // Closed, its row stands for the place shown inside it.
    const selected = !open && tab.id === spaceId;
    const dropHere = drop?.id === tab.id ? drop : null;
    return (
      // The whole mailbox, folders too, takes a mailbox dropped on it.
      <div
        key={tab.id}
        className={cn("relative", i > 0 && "mt-3")}
        onDragOver={(e) => {
          if (!dragged) return;
          e.preventDefault();
          if (dragged === tab.id) {
            setDrop(null);
            return;
          }
          const box = e.currentTarget.getBoundingClientRect();
          setDrop({ id: tab.id, after: e.clientY > box.top + box.height / 2 });
        }}
        onDrop={(e) => {
          if (!dragged) return;
          e.preventDefault();
          if (drop) onMove(dragged, drop.id, drop.after);
          endDrag();
        }}
      >
        {dropHere ? (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-2 z-20 h-0.5 rounded-full bg-primary",
              dropHere.after ? "-bottom-px" : "-top-px",
            )}
          />
        ) : null}
        {/* Open, it stays at the top while its folders scroll under it, and covers the gap
            above it there (always empty, or the scroll fade's) so nothing shows over it. */}
        <div
          className={cn(
            "z-10 bg-sidebar-surface",
            open &&
              "sticky top-0 before:absolute before:inset-x-0 before:bottom-full before:h-3 before:bg-sidebar-surface",
          )}
        >
          <button
            type="button"
            aria-expanded={open}
            onClick={(e) => {
              toggle(tab.id);
              // A click leaves the keys to the mail: kept, the next shortcut would ring this row.
              if (e.detail > 0) e.currentTarget.blur();
            }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", option.name);
              setDragged(tab.id);
            }}
            onDragEnd={endDrag}
            className={cn(
              sidebarRowClassName,
              // Inside the row, where the next mailbox's cover can't hide it.
              "px-(--sidebar-row-content-inset) focus-visible:ring-inset",
              selected
                ? "bg-sidebar-row-selected text-sidebar-foreground"
                : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
              dragged === tab.id && "opacity-40",
            )}
          >
            <AccountPicture account={option.account} className="size-4 rounded-sm text-4xs" />
            <span className="min-w-0 truncate">{option.name}</span>
            <ChevronDownIcon
              className={cn("size-3 shrink-0 transition-transform", open ? "" : "-rotate-90")}
            />
            {open ? null : badgeStyle === "dot" ? (
              count > 0 ? (
                <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-primary" />
              ) : null
            ) : (
              <SidebarBadge count={count} />
            )}
          </button>
        </div>
        <SidebarCollapse open={open}>{children(tab)}</SidebarCollapse>
      </div>
    );
  });
}

/** Memoized: the home view re-renders on every pane toggle, which this skips. */
export const AppSidebar = memo(AppSidebarView);
