import { workspaceOf } from "../extensions/workspaces";
import type { MailAccount, MailView } from "./types";

export const CHATS_SPACE = "__chats__";

export const CALENDAR_SPACE = "__calendar__";

export const NEW_CHAT = "new";

export const VIEW_LIST = "all";

export const isViewSpaceId = (id: string) => id.startsWith("v_");

export type Space =
  | { kind: "mailbox"; id: string; account: MailAccount }
  | { kind: "view"; id: string; view: MailView }
  | { kind: "chats"; id: typeof CHATS_SPACE }
  | { kind: "calendar"; id: typeof CALENDAR_SPACE }
  | { kind: "workspace"; id: string; workspace: string };

export function spaceOf(
  id: string,
  { accounts, views }: { accounts: MailAccount[]; views: MailView[] },
): Space | null {
  if (id === CHATS_SPACE) return { kind: "chats", id };
  if (id === CALENDAR_SPACE) return { kind: "calendar", id };
  const workspace = workspaceOf(id);
  if (workspace) return { kind: "workspace", id, workspace: workspace.id };
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
  const workspace = workspaceOf(spaceId);
  if (workspace) return workspace.home;
  if (isViewSpaceId(spaceId)) return VIEW_LIST;
  return "INBOX";
}

export type AppMode = "mail" | "calendar" | "agent" | `workspace:${string}`;

export function modeOf(spaceId: string | null): AppMode {
  if (spaceId === CALENDAR_SPACE) return "calendar";
  if (spaceId === CHATS_SPACE) return "agent";
  const workspace = workspaceOf(spaceId);
  return workspace ? `workspace:${workspace.id}` : "mail";
}

export const spansMailboxes = (space: Space | null) => space != null && space.kind !== "mailbox";
