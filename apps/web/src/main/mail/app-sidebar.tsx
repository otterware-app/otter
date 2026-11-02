import { useState, type ReactNode } from "react";
import { PlusIcon, SearchIcon, SettingsIcon, SquarePenIcon } from "lucide-react";

import { CalendarSidebar } from "../calendar/calendar-sidebar";
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
import { NewRow, SIDEBAR_ROW, Section, SectionAddButton, SidebarBody, SkRow } from "./sidebar-ui";
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
      {mode === "calendar" ? (
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
  const modes: {
    mode: AppMode;
    label: string;
    Icon: (props: NavGlyphProps) => ReactNode;
    shortcut: KeybindingCommand;
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
  const tab = ({
    id,
    label,
    icon,
    hint,
    dot = false,
  }: {
    id: string;
    label: string;
    icon: ReactNode;
    hint?: string;
    dot?: boolean;
  }) => {
    const selected = id === selectedId;
    return (
      <HintTooltip key={id} label={label} hint={hint} disabled={selected}>
        <button
          type="button"
          aria-label={label}
          aria-current={selected ? "page" : undefined}
          onClick={() => onSelect(id)}
          className={cn(
            "flex h-8 min-w-0 shrink-0 cursor-pointer items-center rounded-lg px-1.5 text-sm font-medium outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none",
            selected
              ? "shrink bg-sidebar-row-selected text-sidebar-foreground"
              : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
          )}
        >
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
  };
  return (
    <div className="flex min-w-0 items-center gap-0.5" data-tour="mailbox">
      {options.map((option) =>
        tab({
          id: option.id,
          label: option.name,
          icon: (
            <AccountPicture account={option.account} className="size-5 rounded-md text-[10px]" />
          ),
          hint: option.shortcut,
          dot: (unread[option.id] ?? 0) > 0,
        }),
      )}
    </div>
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
