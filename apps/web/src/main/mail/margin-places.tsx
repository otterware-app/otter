import { ChevronDownIcon, TagIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";
import { cn } from "@otter/ui/lib/utils";
import { PLACE } from "../place-menu";
import { FLAGGED, SIDEBAR_SYSTEM_ORDER, SYSTEM_LABEL_MAP } from "./accounts-sidebar";
import { useCapabilities } from "./capabilities";
import { useLabels } from "./hooks";
import { ALL_MAIL_LABEL_ID, ARCHIVE_LABEL_ID, SNOOZED_LABEL_ID } from "./label-names";

const TABS = ["INBOX", "STARRED", "SENT", "DRAFT", SNOOZED_LABEL_ID];

const TAB =
  "-mb-px flex h-9 shrink-0 cursor-pointer items-center gap-1 border-b text-sm outline-none focus-visible:text-foreground";

/** The Margin layout's places for a mailbox, where the sidebar's folders would be: a quiet tab
 *  row of the everyday ones, the rest and the labels in a menu. */
export function MarginPlaces({
  accountId,
  alias,
  labelId,
  onSelect,
}: {
  accountId: string;
  alias?: string;
  labelId: string;
  onSelect: (labelId: string) => void;
}) {
  const labels = useLabels(accountId, alias).data ?? [];
  const capabilities = useCapabilities(accountId);
  const has = (id: string) =>
    (id !== "IMPORTANT" || capabilities.categories) &&
    id !== (capabilities.archiveFolder ? ALL_MAIL_LABEL_ID : ARCHIVE_LABEL_ID) &&
    (labels.length === 0 ||
      id === ALL_MAIL_LABEL_ID ||
      id === ARCHIVE_LABEL_ID ||
      labels.some((l) => l.id === id));
  const nameOf = (id: string) =>
    (id === "STARRED" && !capabilities.stars ? FLAGGED : SYSTEM_LABEL_MAP[id]).name;
  const tabs = TABS.filter(has);
  const more = SIDEBAR_SYSTEM_ORDER.filter((id) => !TABS.includes(id) && has(id));
  const userLabels = alias
    ? []
    : labels.filter((l) => l.type === "user").toSorted((a, b) => a.name.localeCompare(b.name));
  const inMenu = !tabs.includes(labelId);
  const menuName = inMenu
    ? (labels.find((l) => l.id === labelId)?.name ?? SYSTEM_LABEL_MAP[labelId]?.name)
    : undefined;

  return (
    <nav aria-label="Places" className="flex items-center gap-5 border-b border-border">
      {tabs.map((id) => (
        <button
          key={id}
          type="button"
          {...PLACE}
          aria-current={labelId === id ? "page" : undefined}
          onClick={() => onSelect(id)}
          className={cn(
            TAB,
            labelId === id
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {nameOf(id)}
        </button>
      ))}
      {more.length > 0 || userLabels.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className={cn(
                  TAB,
                  inMenu
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground data-popup-open:text-foreground",
                )}
              />
            }
          >
            {menuName ?? (userLabels.length > 0 ? "Labels" : "More")}
            <ChevronDownIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-96 min-w-48">
            {more.map((id) => (
              <DropdownMenuItem
                key={id}
                icon={SYSTEM_LABEL_MAP[id].icon}
                onClick={() => onSelect(id)}
              >
                {nameOf(id)}
              </DropdownMenuItem>
            ))}
            {more.length > 0 && userLabels.length > 0 ? <DropdownMenuSeparator /> : null}
            {userLabels.map((label) => (
              <DropdownMenuItem
                key={label.id}
                icon={<TagIcon className="size-4" />}
                accelerator={label.unread ? String(label.unread) : undefined}
                onClick={() => onSelect(label.id)}
              >
                {label.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </nav>
  );
}
