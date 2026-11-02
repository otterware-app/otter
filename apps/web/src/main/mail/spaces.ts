import type { MailAccount, MailView } from "./types";

export const CHATS_SPACE = "__chats__";

export const CALENDAR_SPACE = "__calendar__";

export const NEW_CHAT = "new";

export const VIEW_LIST = "all";

/** Views' ids (views-store's `v_…`), never an account's address. */
export const isViewSpaceId = (id: string) => id.startsWith("v_");

export type Space =
  | { kind: "mailbox"; id: string; account: MailAccount }
  | { kind: "view"; id: string; view: MailView }
  | { kind: "chats"; id: typeof CHATS_SPACE }
  | { kind: "calendar"; id: typeof CALENDAR_SPACE };

export function spaceOf(
  id: string,
  { accounts, views }: { accounts: MailAccount[]; views: MailView[] },
): Space | null {
  if (id === CHATS_SPACE) return { kind: "chats", id };
  if (id === CALENDAR_SPACE) return { kind: "calendar", id };
  if (isViewSpaceId(id)) {
    const view = views.find((v) => v.kind === "custom" && v.id === id);
    return view ? { kind: "view", id, view } : null;
  }
  const account = accounts.find((a) => a.id === id);
  return account ? { kind: "mailbox", id, account } : null;
}

export function firstLabelOf(spaceId: string): string {
  if (spaceId === CHATS_SPACE) return NEW_CHAT;
  if (spaceId === CALENDAR_SPACE) return "week";
  if (isViewSpaceId(spaceId)) return VIEW_LIST;
  return "INBOX";
}

/** The app's three modes, switched at the sidebar's foot. */
export type AppMode = "mail" | "calendar" | "agent";

export const modeOf = (spaceId: string | null): AppMode =>
  spaceId === CALENDAR_SPACE ? "calendar" : spaceId === CHATS_SPACE ? "agent" : "mail";

/** Its list draws on every mailbox (or some), not one account's (Chats: none, so all of them). */
export const spansMailboxes = (space: Space | null) => space != null && space.kind !== "mailbox";
