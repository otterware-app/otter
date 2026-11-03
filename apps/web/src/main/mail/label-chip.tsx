import { ChevronsRightIcon, InboxIcon, XIcon } from "lucide-react";
import type { MailLabel } from "./types";

// no-drag: in the reader's title band (a window-drag region in the Mac app)
// the pill must get hover, or its remove button never shows.
const PILL =
  "no-drag group relative inline-flex h-5 w-fit max-w-32 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-transparent px-2 text-2xs font-medium leading-none text-muted-foreground";

function Dot({ color }: { color: string }) {
  return (
    <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
  );
}

function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className="-me-1 hidden size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-foreground/15 group-hover:flex focus-visible:flex"
    >
      <XIcon className="size-2.5" strokeWidth={3} />
    </button>
  );
}

const CATEGORY_CHIPS: Record<string, { name: string; bg: string }> = {
  CATEGORY_SOCIAL: { name: "Social", bg: "#1a73e8" },
  CATEGORY_PROMOTIONS: { name: "Promotions", bg: "#188038" },
  CATEGORY_UPDATES: { name: "Updates", bg: "#e37400" },
  CATEGORY_FORUMS: { name: "Forums", bg: "#7627bb" },
};

export function CategoryChip({ id, onRemove }: { id: string; onRemove?: () => void }) {
  const meta = CATEGORY_CHIPS[id];
  if (!meta) return null;
  return (
    <span className={PILL}>
      <Dot color={meta.bg} />
      {meta.name}
      {onRemove ? <RemoveButton label={`Remove "${meta.name}"`} onRemove={onRemove} /> : null}
    </span>
  );
}

export function isCategoryLabelId(id: string): boolean {
  return id in CATEGORY_CHIPS;
}

export function ImportantMarker({ muted }: { muted?: boolean }) {
  return (
    <span title="Marked important" aria-label="Important" className="shrink-0">
      <ChevronsRightIcon
        className={muted ? "size-3.5 text-muted-foreground/60" : "size-3.5"}
        strokeWidth={muted ? 2.5 : 3}
        style={muted ? undefined : { color: "#f4b400" }}
      />
    </span>
  );
}

export function InboxChip({ selected, onRemove }: { selected?: boolean; onRemove?: () => void }) {
  return (
    <span className={`${PILL} ${selected ? "border-foreground/20" : ""}`}>
      <InboxIcon className="size-3" />
      Inbox
      {onRemove ? <RemoveButton label="Archive" onRemove={onRemove} /> : null}
    </span>
  );
}

export function LabelChip({
  label,
  selected,
  onRemove,
}: {
  label: MailLabel;
  selected?: boolean;
  onRemove?: () => void;
}) {
  const displayName = label.name.split("/").pop() ?? label.name;
  return (
    <span className={`${PILL} ${selected ? "border-foreground/20" : ""}`}>
      {label.color ? <Dot color={label.color.backgroundColor} /> : null}
      <span className="min-w-0 truncate">{displayName}</span>
      {onRemove ? <RemoveButton label={`Remove "${displayName}"`} onRemove={onRemove} /> : null}
    </span>
  );
}
