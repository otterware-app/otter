import { useState, type ComponentType } from "react";
import { PlusIcon, SettingsIcon, SquarePenIcon } from "lucide-react";

import { CalendarSidebar } from "../calendar/calendar-sidebar";
import type { WorkspaceProps } from "../extensions/types";
import { useWorkspaces, type Workspace } from "../extensions/workspaces";
import type { CalendarMode } from "../calendar/dates";
import type { KeybindingCommand } from "../keybindings/commands";
import { shortcutText } from "../keybindings/keys";
import { UpdateCard } from "../updates";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./menu";
import {
  NewRow,
  SIDEBAR_ROW,
  Section,
  SectionAddButton,
  SidebarBody,
  SidebarPicker,
  SidebarSwitcher,
  SkRow,
} from "./sidebar-ui";
import { VIEW_LIST, type AppMode } from "./spaces";
import { SignInCards, SyncButton } from "./sync-health";
import { toast } from "./toast";
import { useInboxUnread, useMailboxOptions, type MailboxOption } from "./top-bar";
import type { MailAccount, MailView } from "./types";
import type { MailboxTab } from "../mailboxes";
import { HintTooltip, IconBtn } from "./ui";
import { ViewMark } from "./view-icon";
import { inNewWindow } from "../new-window-click";
import { PLACE } from "../place-menu";

export function AppSidebar({
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
  const options = useMailboxOptions(tabs);
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
      <div className="flex shrink-0 flex-col px-(--sidebar-content-inset) pt-(--sidebar-content-inset) pb-2">
        <ModePicker mode={composing ? "mail" : mode} accounts={accounts} onMode={onMode} />
      </div>
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
            <NewRow
              icon={<SquarePenIcon />}
              label="New message"
              selected={composing}
              tour="compose"
              place
              onClick={onCompose}
            />
            <ScheduledMailButton />
          </div>
          {options.length > 0 ? (
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
            mailbox={tabs.find((tab) => tab.id === mailbox) ?? null}
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
      <UpdateCard />
      <div className="flex shrink-0 items-center gap-0.5 px-(--sidebar-content-inset) pb-(--sidebar-content-inset)">
        <HintTooltip label="Settings" hint={shortcutText("mod+,")}>
          <IconBtn
            label="Settings"
            active={settingsOpen}
            onClick={() => onOpenSettings()}
            {...PLACE}
          >
            <SettingsIcon />
          </IconBtn>
        </HintTooltip>
        {mode === "mail" ? <SyncButton accountIds={healthIds} /> : null}
      </div>
    </div>
  );
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
  const unread = Object.values(useInboxUnread(accounts)).some((n) => n > 0);
  const agentDot = useChats((s) => s.unseen.size > 0);
  const workspaces = useWorkspaces();
  const [order, setOrder] = useState(loadModeOrder);
  const modes: {
    mode: AppMode;
    label: string;
    Icon: ComponentType<Pick<NavGlyphProps, "selected" | "className">>;
    shortcut?: KeybindingCommand;
    dot: boolean;
  }[] = [
    { mode: "mail", label: "Mail", Icon: OtterMailIcon, shortcut: "mode.mail", dot: unread },
    {
      mode: "calendar",
      label: "Calendar",
      Icon: OtterCalendarIcon,
      shortcut: "mode.calendar",
      dot: false,
    },
    ...workspaces.map((w) => ({
      mode: `workspace:${w.id}` as const,
      label: w.title,
      Icon: w.Icon,
      shortcut: w.id === "drive" ? ("mode.drive" as const) : undefined,
      dot: false,
    })),
    { mode: "agent", label: "Agent", Icon: AgentIcon, shortcut: "mode.agent", dot: agentDot },
  ];
  // Modes not yet ordered (new ones) keep their place after the ordered ones.
  const rank = (mode: string) => {
    const at = order.indexOf(mode);
    return at < 0 ? order.length : at;
  };
  const sorted = modes
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank(a.m.mode) - rank(b.m.mode) || a.i - b.i)
    .map(({ m }) => m);
  const move = (id: string, target: string, after: boolean) => {
    const shown = sorted.map((m) => m.mode as string).filter((m) => m !== id);
    shown.splice(shown.indexOf(target) + (after ? 1 : 0), 0, id);
    // A mode hidden now (a workspace turned off) keeps its saved place.
    const next = [...shown, ...order.filter((m) => !shown.includes(m))];
    setOrder(next);
    saveModeOrder(next);
  };
  return (
    <SidebarPicker
      tour="modes"
      selectedId={mode}
      onSelect={(id) => onMode(id as AppMode)}
      onMove={move}
      items={sorted.map((m) => ({
        id: m.mode,
        label: m.label,
        icon: <m.Icon selected={m.mode === mode} />,
        shortcut: m.shortcut,
        dot: m.dot,
      }))}
    />
  );
}

/** This computer's order of the mode switcher; not synced. */
const MODE_ORDER_KEY = "otter:mode-order";

function loadModeOrder(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(MODE_ORDER_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveModeOrder(order: string[]): void {
  try {
    localStorage.setItem(MODE_ORDER_KEY, JSON.stringify(order));
  } catch {
    // Unsaved, the order lasts until reload.
  }
}

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
        icon: <AccountPicture account={option.account} className="size-5 rounded-md text-[10px]" />,
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
  mailbox,
  spaceId,
  labelId,
  onGo,
  onNewView,
  onEditView,
  searches,
  onSelectSearch,
  onCloseSearch,
}: {
  accounts: MailAccount[];
  views: MailView[];
  mailbox: MailboxTab | null;
  spaceId: string | null;
  labelId: string;
  onGo: (spaceId: string, labelId?: string) => void;
  onNewView: () => void;
  onEditView: (viewId: string) => void;
  searches: SidebarSearch[];
  onSelectSearch: (id: string) => void;
  onCloseSearch: (id: string) => void;
}) {
  const viewUnread = useViewUnreadCounts(views, accounts);
  const addAccount = useAddAccount();
  const showing = mailbox != null && mailbox.id === spaceId;

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarBody>
        {mailbox ? (
          <MailboxFolders
            key={mailbox.id}
            mailboxId={mailbox.account.id}
            alias={mailbox.alias?.id}
            selectedLabelId={showing ? labelId : ""}
            onSelectLabel={(label) => onGo(mailbox.id, label)}
            searchRows={showing ? searchRows : undefined}
          />
        ) : (
          <AddMailboxMenu onGmail={() => void addGmail()} onAdded={(a) => onGo(a.id)}>
            <button
              type="button"
              className={`${SIDEBAR_ROW} px-(--sidebar-row-content-inset) text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground`}
            >
              <PlusIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />
              <span className="truncate">Add mailbox</span>
            </button>
          </AddMailboxMenu>
        )}

        {/* Views: one list of what their filters find, across the mailboxes. */}
        <Section title="Views" action={<SectionAddButton label="New view" onClick={onNewView} />}>
          {views.map((view) => (
            <ContextMenu key={view.id}>
              <ContextMenuTrigger>
                <SkRow
                  icon={
                    <span className="flex size-4 items-center justify-center [&>svg]:size-4">
                      <ViewMark view={view} className="text-[14px]" />
                    </span>
                  }
                  title={view.name}
                  selected={view.id === spaceId}
                  badge={viewUnread[view.id] ?? 0}
                  place
                  onClick={() => onGo(view.id, VIEW_LIST)}
                />
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => inNewWindow(() => onGo(view.id, VIEW_LIST))}>
                  Open in New Window
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => onEditView(view.id)}>Edit view…</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </Section>
      </SidebarBody>
    </div>
  );
}
