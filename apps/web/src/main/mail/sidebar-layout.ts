import { useSyncExternalStore } from "react";
import { setSyncedPreference } from "../synced-preferences";

export type FolderVisibility = "always" | "badged" | "never";
export type BadgeStyle = "count" | "dot";

/** The mail sidebar's folders, Linear's "Customize sidebar": every mailbox's, by folder id. */
export type SidebarLayout = {
  badge: BadgeStyle;
  /** Folder ids moved from the default order; one not in it follows the one before it there. */
  order: string[];
  visibility: Partial<Record<string, FolderVisibility>>;
};

const KEY = "mail:sidebar";
const VISIBILITIES: ReadonlySet<string> = new Set(["always", "badged", "never"]);

// Daily places always; Drafts and Junk only with something in them; Important (Gmail's) under More,
// as in Gmail. Starred is Flagged and All Mail is Archive where the provider has those instead.
const DEFAULT_VISIBILITY: Partial<Record<string, FolderVisibility>> = {
  DRAFT: "badged",
  SPAM: "badged",
  IMPORTANT: "never",
};

export const visibilityOf = (layout: SidebarLayout, id: string): FolderVisibility =>
  layout.visibility[id] ?? DEFAULT_VISIBILITY[id] ?? "always";

let cached: { raw: string | null; layout: SidebarLayout } | undefined;

function read(): SidebarLayout {
  const raw = localStorage.getItem(KEY);
  if (cached?.raw === raw) return cached.layout;
  let value: Partial<Record<keyof SidebarLayout, unknown>> = {};
  try {
    value = (JSON.parse(raw ?? "null") ?? {}) as typeof value;
  } catch {}
  const visibility =
    value.visibility && typeof value.visibility === "object"
      ? Object.fromEntries(
          Object.entries(value.visibility).filter(
            (entry): entry is [string, FolderVisibility] =>
              typeof entry[1] === "string" && VISIBILITIES.has(entry[1]),
          ),
        )
      : {};
  const layout: SidebarLayout = {
    badge: value.badge === "dot" ? "dot" : "count",
    order: Array.isArray(value.order)
      ? value.order.filter((id): id is string => typeof id === "string")
      : [],
    visibility,
  };
  cached = { raw, layout };
  return layout;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSidebarLayout(): SidebarLayout {
  return useSyncExternalStore(subscribe, read);
}

export function setSidebarLayout(next: SidebarLayout): void {
  setSyncedPreference(KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}

/** `ids` (in their default order) in the saved one. */
export function arrangeFolders(ids: readonly string[], order: readonly string[]): string[] {
  const arranged = order.filter((id) => ids.includes(id));
  ids.forEach((id, i) => {
    if (arranged.includes(id)) return;
    const before = i === 0 ? -1 : arranged.indexOf(ids[i - 1]!);
    arranged.splice(before + 1, 0, id);
  });
  return arranged;
}

/** What SkRow shows for a count, in the chosen style. */
export const badgeProps = (count: number, style: BadgeStyle) =>
  style === "dot" ? { dot: count > 0 } : { badge: count };
