import { useState, type ComponentType } from "react";
import { PlusIcon, SearchIcon, SettingsIcon, SquarePenIcon } from "lucide-react";

import { CalendarSidebar } from "../calendar/calendar-sidebar";
import type { WorkspaceProps } from "../extensions/types";
import { useWorkspaces, type Workspace } from "../extensions/workspaces";
import { calendarAccounts } from "../calendar/calendar-view";
import type { CalendarMode } from "../calendar/dates";
import type { KeybindingCommand } from "../keybindings/commands";
import { shortcutText } from "../keybindings/keys";
import { UpdateCard } from "../updates";
import { AccountPicture } from "./account-picture";
import { MailboxFolders, SearchRow, type SidebarSearch } from "./accounts-sidebar";
import { AddMailboxMenu } from "./add-mailbox";
import { AgentIcon } from "./agent-icon";
import { type NavGlyphProps, OtterCalendarIcon, OtterMailIcon } from "./app-icons";
import { AgentSidebar } from "./agent-sidebar";
import type { SettingsPane } from "./api";
import { useChats } from "./chat-store";
import { useAddAccount, useViewUnreadCounts } from "./hooks";
import { ScheduledMailButton } from "./mail-schedule";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./menu";
import {
  NewRow,
  SIDEBAR_ROW,
  Section,
  SectionAddButton,
  SidebarBody,
  SidebarPicker,
  SkRow,
} from "./sidebar-ui";
import { VIEW_LIST, type AppMode } from "./spaces";
import { SignInCards, SyncButton } from "./sync-health";
import { toast } from "./toast";
import { useInboxUnread, useMailboxOptions, type MailboxOption } from "./top-bar";
import type { MailAccount, MailView } from "./types";
import { HintTooltip, IconBtn, cn } from "./ui";
import { ViewMark } from "./view-icon";

export function AppSidebar({
  accounts,
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
  onOpenPalette,
  onOpenSettings,
  searches,
  onSelectSearch,
  onCloseSearch,
}: {
  accounts: MailAccount[];
  views: MailView[];
  mode: AppMode;
  spaceId: string | null;
  labelId: string;
  /** The workspace that's open, and where in it. */
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
  onOpenPalette: () => void;
  onOpenSettings: (pane?: SettingsPane) => void;
  searches: SidebarSearch[];
  onSelectSearch: (id: string) => void;
  onCloseSearch: (id: string) => void;
}) {
  const options = useMailboxOptions(accounts);
  const isMailbox = (id: string | null) => options.some((option) => option.id === id);
  const [lastMailbox, setLastMailbox] = useState<string | null>(null);
  if (isMailbox(spaceId) && spaceId !== lastMailbox) setLastMailbox(spaceId);
  const mailbox = isMailbox(spaceId)
    ? spaceId
    : isMailbox(lastMailbox)
      ? lastMailbox
      : (options[0]?.id ?? null);
  const healthIds =
    spaceId && accounts.some((a) => a.id === spaceId) ? [spaceId] : accounts.map((a) => a.id);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
            <NewRow icon={<SearchIcon />} label="Search or ask" onClick={onOpenPalette} />
            <NewRow
              icon={<SquarePenIcon />}
              label="New message"
              selected={composing}
              tour="compose"
              onClick={onCompose}
            />
            <ScheduledMailButton />
          </div>
          <div className="flex shrink-0 flex-col px-(--sidebar-content-inset) pt-3">
            <SidebarTabs
              options={options}
              accounts={accounts}
              selectedId={mailbox}
              onSelect={(id) => onGo(id)}
            />
          </div>
          <MailPage
            accounts={accounts}
            views={views}
            mailbox={mailbox}
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
        <ModeSwitcher
          mode={composing ? "mail" : mode}
          accounts={accounts}
          calendar={calendarAccounts(accounts).length > 0}
          onMode={onMode}
        />
        <span className="min-w-0 flex-1" />
        {mode === "mail" ? <SyncButton accountIds={healthIds} /> : null}
        <HintTooltip label="Settings" hint={shortcutText("mod+,")}>
          <IconBtn label="Settings" active={settingsOpen} onClick={() => onOpenSettings()}>
            <SettingsIcon />
          </IconBtn>
        </HintTooltip>
      </div>
    </div>
  );
}

/** Mail, Calendar, Agent: each swaps the sidebar and the main area, and returns where it was. */
function ModeSwitcher({
  mode,
  accounts,
  calendar,
  onMode,
}: {
  mode: AppMode;
  accounts: MailAccount[];
  calendar: boolean;
  onMode: (mode: AppMode) => void;
}) {
  const unread = Object.values(useInboxUnread(accounts)).some((n) => n > 0);
  const agentDot = useChats((s) => s.unseen.size > 0);
  const workspaces = useWorkspaces();
  const modes: {
    mode: AppMode;
    label: string;
    Icon: ComponentType<Pick<NavGlyphProps, "selected" | "className">>;
    shortcut?: KeybindingCommand;
    dot: boolean;
  }[] = [
    {
      mode: "mail",
      label: "Mail",
      Icon: OtterMailIcon,
      shortcut: "mode.mail",
      dot: unread,
    },
    ...(calendar
      ? [
          {
            mode: "calendar" as const,
            label: "Calendar",
            Icon: OtterCalendarIcon,
            shortcut: "mode.calendar" as const,
            dot: false,
          },
        ]
      : []),
    ...workspaces.map((w) => ({
      mode: `workspace:${w.id}` as const,
      label: w.title,
      Icon: w.Icon,
      dot: false,
    })),
    {
      mode: "agent",
      label: "Agent",
      Icon: AgentIcon,
      shortcut: "mode.agent",
      dot: agentDot,
    },
  ];
  return (
    <div role="tablist" aria-label="Mode" className="flex items-center gap-0.5" data-tour="modes">
      {modes.map((m) => {
        const selected = m.mode === mode;
        return (
          <HintTooltip key={m.mode} label={m.label} shortcut={m.shortcut}>
            <button
              type="button"
              role="tab"
              aria-label={m.label}
              aria-selected={selected}
              onClick={() => onMode(m.mode)}
              className={cn(
                "relative flex h-7 w-8 cursor-pointer items-center justify-center rounded-lg outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-focus-ring [&>svg]:size-4",
                selected
                  ? "text-sidebar-foreground"
                  : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
              )}
            >
              <m.Icon selected={selected} />
              {m.dot && !selected ? (
                <span
                  aria-hidden
                  className="absolute right-1.5 top-1 size-1.5 rounded-full bg-sidebar-foreground ring-2 ring-sidebar-surface"
                />
              ) : null}
            </button>
          </HintTooltip>
        );
      })}
    </div>
  );
}

function SidebarTabs({
  options,
  accounts,
  selectedId,
  onSelect,
}: {
  options: MailboxOption[];
  accounts: MailAccount[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const unread = useInboxUnread(accounts);
  return (
    <SidebarPicker
      tour="mailbox"
      selectedId={selectedId}
      onSelect={onSelect}
      items={options.map((option) => ({
        id: option.id,
        label: option.name,
        icon: <AccountPicture account={option.account} className="size-5 rounded-md text-[10px]" />,
        hint: option.shortcut,
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
  mailbox: string | null;
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
  const showing = mailbox != null && mailbox === spaceId;

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
            key={mailbox}
            mailboxId={mailbox}
            selectedLabelId={showing ? labelId : ""}
            onSelectLabel={(label) => onGo(mailbox, label)}
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
                  onClick={() => onGo(view.id, VIEW_LIST)}
                />
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => onEditView(view.id)}>Edit view…</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </Section>
      </SidebarBody>
    </div>
  );
}
