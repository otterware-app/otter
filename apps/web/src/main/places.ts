import { isWorkspaceSegment, workspaceSpace } from "./extensions/workspaces";
import { SEARCH_MAILBOX } from "./mail/gmail-query";
import { CALENDAR_SPACE, CHATS_SPACE, DESK_SPACE } from "./mail/spaces";

/**
 * Each mode is the first segment: /mail/<mailbox>/<label>, /agents/<chat>, /calendar/<day>,
 * /<workspace>/<location> (/drive/…), and the Desk is /desk. Before Otter, mailboxes had no /mail prefix and Agents was
 * /chats: those addresses (old tabs, links, bookmarks) redirect.
 */
const SPACE_SEGMENTS: Record<string, string> = {
  agents: CHATS_SPACE,
  chats: CHATS_SPACE,
  calendar: CALENDAR_SPACE,
};
export const isSpaceId = (id: string) => /^__[a-z0-9-]+__$/.test(id);
export const toSpace = (segment: string) =>
  SPACE_SEGMENTS[segment] ?? (isWorkspaceSegment(segment) ? workspaceSpace(segment) : segment);
export const fromSpace = (id: string) =>
  id === CHATS_SPACE ? "agents" : (/^__([a-z0-9-]+)__$/.exec(id)?.[1] ?? id);
export const toLabel = (segment: string) => (segment === "search" ? SEARCH_MAILBOX : segment);
export const fromLabel = (id: string) => /^__([a-z]+)__$/.exec(id)?.[1] ?? id;

export type MessageSearch = { account?: string; message?: string };

const encode = (segment: string) => encodeURIComponent(segment).replaceAll("%40", "@");

export const searchString = (search: Record<string, string | undefined>) => {
  const entries = Object.entries(search).filter((e): e is [string, string] => e[1] !== undefined);
  const query = new URLSearchParams(entries).toString().replaceAll("%40", "@");
  return query ? `?${query}` : "";
};

/** The address of a place: a mailbox's label or message, or a mode's (Agents, Calendar, a workspace) location and item. */
export function placeHref(
  mailbox: string,
  label: string,
  messageId?: string | null,
  search: MessageSearch = {},
): string {
  if (mailbox === DESK_SPACE) return "/desk";
  const head = isSpaceId(mailbox) ? [fromSpace(mailbox)] : ["mail", mailbox];
  const parts = [...head, fromLabel(label), ...(messageId ? [messageId] : [])];
  return `/${parts.map(encode).join("/")}${messageId ? searchString(search) : ""}`;
}
