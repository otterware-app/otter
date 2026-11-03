export type SearchTab = {
  id: string;
  mailbox: string;
  parent: string | null;
  base: string;
  query: string;
  /** What's in the bar (may not have run yet). */
  draft: string;
  scope: string[];
};

export function searchTabId(mailbox: string, parent: string | null): string {
  return `${mailbox}::${parent ?? "*"}`;
}

export function searchTitle(tab: SearchTab): string {
  const text = (tab.query || tab.draft).trim();
  const words = tab.base ? text.replace(tab.base, "").trim() : text;
  return words || "Search";
}
