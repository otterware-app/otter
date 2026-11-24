import { workspaceOf } from "../extensions/workspaces";
import type { AliasMailboxEntry } from "./alias-mailboxes";
import type { MailAccount, MailView } from "./types";

export const CHATS_SPACE = "__chats__";

export const CALENDAR_SPACE = "__calendar__";

/** The Desk (the Margin layout's home): today, at /desk. */
export const DESK_SPACE = "__desk__";

export const DESK_TODAY = "today";

export const NEW_CHAT = "new";

export const VIEW_LIST = "all";

export const isViewSpaceId = (id: string) => id.startsWith("v_");

export type Space =
  | { kind: "mailbox"; id: string; account: MailAccount }
  | { kind: "alias"; id: string; account: MailAccount; alias: AliasMailboxEntry }
  | { kind: "view"; id: string; view: MailView }
  | { kind: "chats"; id: typeof CHATS_SPACE }
  | { kind: "calendar"; id: typeof CALENDAR_SPACE }
  | { kind: "desk"; id: typeof DESK_SPACE }
  | { kind: "workspace"; id: string; workspace: string };

export function spaceOf(
  id: string,
  {
    accounts,
    views,
    aliases = [],
  }: { accounts: MailAccount[]; views: MailView[]; aliases?: AliasMailboxEntry[] },
): Space | null {
  if (id === CHATS_SPACE) return { kind: "chats", id };
  if (id === CALENDAR_SPACE) return { kind: "calendar", id };
  if (id === DESK_SPACE) return { kind: "desk", id };
  const workspace = workspaceOf(id);
  if (workspace) return { kind: "workspace", id, workspace: workspace.id };
  if (isViewSpaceId(id)) {
    const view = views.find((v) => v.kind === "custom" && v.id === id);
    return view ? { kind: "view", id, view } : null;
  }
  const account = accounts.find((a) => a.id === id);
  if (account) return { kind: "mailbox", id, account };
  const alias = aliases.find((a) => a.id === id);
  return alias ? { kind: "alias", id, account: alias.parent, alias } : null;
}

export function firstLabelOf(spaceId: string): string {
  if (spaceId === CHATS_SPACE) return NEW_CHAT;
  if (spaceId === CALENDAR_SPACE) return "week";
  if (spaceId === DESK_SPACE) return DESK_TODAY;
  const workspace = workspaceOf(spaceId);
  if (workspace) return workspace.home;
  if (isViewSpaceId(spaceId)) return VIEW_LIST;
  return "INBOX";
}

export type AppMode = "desk" | "mail" | "calendar" | "agent" | `workspace:${string}`;

export function modeOf(spaceId: string | null): AppMode {
  if (spaceId === CALENDAR_SPACE) return "calendar";
  if (spaceId === DESK_SPACE) return "desk";
  if (spaceId === CHATS_SPACE) return "agent";
  const workspace = workspaceOf(spaceId);
  return workspace ? `workspace:${workspace.id}` : "mail";
}

export const spansMailboxes = (space: Space | null) =>
  space != null && space.kind !== "mailbox" && space.kind !== "alias";
