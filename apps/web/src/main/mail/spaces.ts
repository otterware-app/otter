import type { MailAccount, MailView } from "./types";

export const CHATS_SPACE = "__chats__";

export const NEW_CHAT = "new";

export const VIEW_LIST = "all";

/** Views' ids (views-store's `v_…`), never an account's address. */
export const isViewSpaceId = (id: string) => id.startsWith("v_");

export type Space =
  | { kind: "mailbox"; id: string; account: MailAccount }
  | { kind: "view"; id: string; view: MailView }
  | { kind: "chats"; id: typeof CHATS_SPACE };

export function spaceOf(
  id: string,
  { accounts, views }: { accounts: MailAccount[]; views: MailView[] },
): Space | null {
  if (id === CHATS_SPACE) return { kind: "chats", id };
  if (isViewSpaceId(id)) {
    const view = views.find((v) => v.kind === "custom" && v.id === id);
    return view ? { kind: "view", id, view } : null;
  }
  const account = accounts.find((a) => a.id === id);
  return account ? { kind: "mailbox", id, account } : null;
}

export function firstLabelOf(spaceId: string): string {
  if (spaceId === CHATS_SPACE) return NEW_CHAT;
  if (isViewSpaceId(spaceId)) return VIEW_LIST;
  return "INBOX";
}

/** Its list draws on every mailbox (or some), not one account's (Chats: none, so all of them). */
export const spansMailboxes = (space: Space | null) => space != null && space.kind !== "mailbox";
