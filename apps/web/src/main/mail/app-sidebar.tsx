/**
 * The sidebar, the window's only one (Notion's). First what belongs to no one mailbox: Search
 * or ask (the command palette), New message, Agent (the AI workspace, Linear's: picked while
 * it shows). Then a tab for each mailbox, and the tab's page: its folders and labels, then the
 * views; in the AI workspace, the last mailbox's. Sign-in cards, an update, then Settings and
 * Sync now at its foot.
 */

import { useState, type ReactNode } from "react";
import { PlusIcon, SearchIcon, SettingsIcon, SquarePenIcon } from "lucide-react";

import { shortcutText } from "../keybindings/keys";
import { UpdateCard } from "../updates";
import { AccountPicture } from "./account-picture";
import { MailboxFolders, SearchRow, type SidebarSearch } from "./accounts-sidebar";
import { AddMailboxMenu } from "./add-mailbox";
import { AgentIcon } from "./agent-icon";
import type { SettingsPane } from "./api";
import { useChats } from "./chat-store";
import { useAddAccount, useViewUnreadCounts } from "./hooks";
import { ScheduledMailButton } from "./mail-schedule";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./menu";
import { NewRow, SIDEBAR_ROW, Section, SectionAddButton, SidebarBody, SkRow } from "./sidebar-ui";
import { CHATS_SPACE, VIEW_LIST } from "./spaces";
import { SignInCards, SyncButton } from "./sync-health";
import { toast } from "./toast";
import { useInboxUnread, useMailboxOptions, type MailboxOption } from "./top-bar";
import type { MailAccount, MailView } from "./types";
import { HintTooltip, IconBtn, cn } from "./ui";
import { ViewMark } from "./view-icon";

export function AppSidebar({
  accounts,
  views,
  spaceId,
  labelId,
  settingsOpen,
  composing,
  onGo,
  onOpenAgent,
  onCompose,
  onNewView,
  onEditView,
  onOpenPalette,
  onOpenSettings,
  searches,
  onSelectSearch,
  onCloseSearch,
}: {
  /** The mailboxes that are on. */
  accounts: MailAccount[];
  /** The user's views. */
  views: MailView[];
  /** The space showing (spaces.ts), and its folder, label, list or chat. */
  spaceId: string | null;
  labelId: string;
  settingsOpen: boolean;
  /** On the new message's page: New message is where the window is, nothing else. */
  composing: boolean;
  /** Goes to a space: where it opens, or `labelId` in it. */
  onGo: (spaceId: string, labelId?: string) => void;
  /** The AI workspace, on a new chat. */
  onOpenAgent: () => void;
  onCompose: () => void;
  onNewView: () => void;
  onEditView: (viewId: string) => void;
  onOpenPalette: () => void;
  /** Settings (a pane, General by default). */
  onOpenSettings: (pane?: SettingsPane) => void;
  /** Searches opened from a folder (⌘F), nested under it. */
  searches: SidebarSearch[];
  onSelectSearch: (id: string) => void;
  onCloseSearch: (id: string) => void;
}) {
  const options = useMailboxOptions(accounts);
  const isMailbox = (id: string | null) => options.some((option) => option.id === id);
  // The mailbox whose folders show: the one you're in, or (in Chats or a
  // view) the one you were last in.
  const [lastMailbox, setLastMailbox] = useState<string | null>(null);
  if (isMailbox(spaceId) && spaceId !== lastMailbox) setLastMailbox(spaceId);
  const mailbox = isMailbox(spaceId)
    ? spaceId
    : isMailbox(lastMailbox)
      ? lastMailbox
      : (options[0]?.id ?? null);
  // Sync health for the mailbox you're in, or all of them.
  const healthIds =
    spaceId && accounts.some((a) => a.id === spaceId) ? [spaceId] : accounts.map((a) => a.id);
  // A chat finished while you were away.
  const agentDot = useChats((s) => s.unseen.size > 0);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
        <div className="flex shrink-0 flex-col px-(--sidebar-content-inset)">
          <SkRow
            icon={<AgentIcon className="size-4" />}
            title="Agent"
            selected={spaceId === CHATS_SPACE && !composing}
            dot={agentDot}
            onClick={onOpenAgent}
          />
        </div>
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
      <SignInCards accountIds={healthIds} />
      <UpdateCard />
      <div className="flex shrink-0 items-center gap-0.5 px-(--sidebar-content-inset) pb-(--sidebar-content-inset)">
        <HintTooltip label="Settings" hint={shortcutText("mod+,")}>
          <IconBtn label="Settings" active={settingsOpen} onClick={() => onOpenSettings()}>
            <SettingsIcon />
          </IconBtn>
        </HintTooltip>
        <SyncButton accountIds={healthIds} />
      </div>
    </div>
  );
}

/**
 * The tabs (Notion's Home, Chat, Meetings): one for each mailbox. The one
 * showing is named, the others are their pictures (a dot for unread mail).
 * Switching slides: one name opens as the other folds.
 */
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
  /** The mailbox whose folders show (its tab is the one picked). */
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
