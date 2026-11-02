/**
 * Recently viewed (Linear's history menu): the conversations, mailboxes and
 * Settings pages you've been to, newest first, for the title bar's clock
 * (top-bar.tsx's HistoryControls). Each is kept with the URL that brings it
 * back and the names shown for it then. This device's own, like a browser's
 * history: localStorage, not synced.
 */

import { useEffect, useSyncExternalStore } from "react";
import { getAccountDisplayName } from "./mail/account-style";
import { senderLabel } from "./mail/address";
import { workspaceOf } from "./extensions/workspaces";
import { CALENDAR_SPACE, CHATS_SPACE, isViewSpaceId } from "./mail/spaces";
import { SEARCH_MAILBOX } from "./mail/gmail-query";
import { useLabels, useMessage } from "./mail/hooks";
import { isBlank, useChats } from "./mail/chat-store";
import { folderName, labelDisplayName } from "./mail/label-names";
import { capabilitiesOf } from "./mail/capabilities";
import type { MailAccount, MailView } from "./mail/types";
import type { SettingsPane } from "./mail/api";
import { SETTINGS_SECTION_LABELS } from "./settings/settings-search";

export type RecentIcon =
  | "inbox"
  | "starred"
  | "flagged"
  | "sent"
  | "drafts"
  | "important"
  | "allmail"
  | "archive"
  | "junk"
  | "trash"
  | "custom"
  | "label"
  | "conversation"
  | "settings"
  | "compose"
  | "chat"
  | "calendar"
  /** An extension's workspace, by id (its mark). */
  | `workspace:${string}`;

export type RecentPlace = Readonly<{
  href: string;
  /** Where it is (its mailbox, the sender, "Settings"), quieter, before the icon. */
  context: string;
  title: string;
  icon: RecentIcon;
}>;

const KEY = "otter:recently-viewed";
const CHANGE_EVENT = "otter:recently-viewed-change";
const MAX = 15;

let cache: { raw: string | null; places: RecentPlace[] } = { raw: null, places: [] };

export function getRecentlyViewed(): RecentPlace[] {
  const raw = localStorage.getItem(KEY);
  if (raw === cache.raw) return cache.places;
  let places: RecentPlace[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) places = parsed as RecentPlace[];
  } catch {
    // A broken list starts over.
  }
  cache = { raw, places };
  return places;
}

function recordRecentlyViewed(place: RecentPlace): void {
  const rest = getRecentlyViewed().filter((p) => p.href !== place.href);
  localStorage.setItem(KEY, JSON.stringify([place, ...rest].slice(0, MAX)));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useRecentlyViewed(): RecentPlace[] {
  return useSyncExternalStore(subscribe, getRecentlyViewed);
}

const SYSTEM_LABEL_ICONS: Record<string, RecentIcon> = {
  INBOX: "inbox",
  STARRED: "starred",
  SENT: "sent",
  DRAFT: "drafts",
  IMPORTANT: "important",
  ALL_MAIL: "allmail",
  ARCHIVE: "archive",
  SPAM: "junk",
  TRASH: "trash",
};

export function useRecordRecentlyViewed({
  ready,
  href,
  workspaceTitle,
  settingsPane,
  composing,
  mailbox,
  label,
  messageId,
  readerAccount,
  accounts,
  views,
}: {
  ready: boolean;
  href: string;
  /** Where in a workspace it is, as the workspace names it (a document's title). */
  workspaceTitle: string | null;
  settingsPane: SettingsPane | null;
  composing: boolean;
  mailbox: string | null;
  label: string;
  messageId: string | null;
  readerAccount: string | null;
  accounts: MailAccount[];
  views: MailView[];
}): RecentPlace | null {
  const inSettings = settingsPane !== null;
  const message = useMessage(
    !inSettings && messageId ? readerAccount : null,
    inSettings ? null : messageId,
  ).data;
  const ownLabels = useLabels(
    !inSettings && !messageId && mailbox && accounts.some((a) => a.id === mailbox) ? mailbox : null,
  ).data;
  const chat = useChats((s) =>
    mailbox === CHATS_SPACE ? s.conversations.find((c) => c.id === label) : undefined,
  );

  let place: RecentPlace | null = null;
  if (!ready) {
    place = null;
  } else if (settingsPane) {
    place = {
      href,
      context: "Settings",
      title: SETTINGS_SECTION_LABELS[settingsPane],
      icon: "settings",
    };
  } else if (composing) {
    place = { href, context: "Mail", title: "New message", icon: "compose" };
  } else if (messageId) {
    if (message && message.id === messageId) {
      place = {
        href,
        context: senderLabel(message.fromName, message.fromEmail, message.accountId),
        title: message.subject || "(no subject)",
        icon: "conversation",
      };
    }
  } else if (workspaceOf(mailbox)) {
    const workspace = workspaceOf(mailbox)!;
    place = {
      href,
      context: workspace.title,
      title: workspaceTitle ?? workspace.title,
      icon: `workspace:${workspace.id}`,
    };
  } else if (mailbox === CALENDAR_SPACE) {
    place = {
      href,
      context: "Calendar",
      title: "Calendar",
      icon: "calendar",
    };
  } else if (mailbox === CHATS_SPACE) {
    if (chat) {
      place = {
        href,
        context: "Agent",
        title: isBlank(chat) ? "New chat" : chat.title,
        icon: "chat",
      };
    }
  } else if (mailbox && label !== SEARCH_MAILBOX) {
    const account = accounts.find((a) => a.id === mailbox);
    const context = account
      ? getAccountDisplayName(account)
      : isViewSpaceId(mailbox)
        ? "Views"
        : null;
    const view = views.find((v) => v.id === (isViewSpaceId(mailbox) ? mailbox : label));
    const ownLabel = ownLabels?.find((l) => l.id === label);
    const capabilities = capabilitiesOf(account);
    const title =
      view?.name ?? folderName(label, capabilities) ?? (ownLabel && labelDisplayName(ownLabel));
    if (context && title) {
      place = {
        href,
        context,
        title,
        icon: view
          ? view.kind
          : label === "STARRED" && !capabilities.stars
            ? "flagged"
            : (SYSTEM_LABEL_ICONS[label] ?? "label"),
      };
    }
  }

  const key = place && !composing && !(chat && isBlank(chat)) ? JSON.stringify(place) : null;
  useEffect(() => {
    if (key) recordRecentlyViewed(JSON.parse(key) as RecentPlace);
  }, [key]);
  return place;
}
