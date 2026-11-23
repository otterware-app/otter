import { ChevronsRightIcon, InboxIcon } from "lucide-react";
import { Chip, ChipDot, ChipRemove } from "@otter/ui/components/chip";
import type { MailLabel } from "./types";

// no-drag: in the reader's title band (a window-drag region in the Mac app)
// the chip must get hover, or its remove button never shows.
const PILL = "no-drag justify-center";

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
    <Chip className={PILL}>
      <ChipDot color={meta.bg} />
      {meta.name}
      {onRemove ? <ChipRemove reveal label={`Remove "${meta.name}"`} onRemove={onRemove} /> : null}
    </Chip>
  );
}

export function isCategoryLabelId(id: string): boolean {
  return id in CATEGORY_CHIPS;
}

export function ImportantMarker({ muted }: { muted?: boolean }) {
  return (
    <span title="Marked important" aria-label="Important" className="shrink-0">
      <ChevronsRightIcon
        className={muted ? "size-3.5 text-faint-foreground" : "size-3.5"}
        strokeWidth={muted ? 2.5 : 3}
        style={muted ? undefined : { color: "#f4b400" }}
      />
    </span>
  );
}

export function InboxChip({ selected, onRemove }: { selected?: boolean; onRemove?: () => void }) {
  return (
    <Chip className={PILL} variant={selected ? "selected" : "outline"}>
      <InboxIcon />
      Inbox
      {onRemove ? <ChipRemove reveal label="Archive" onRemove={onRemove} /> : null}
    </Chip>
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
    <Chip className={PILL} variant={selected ? "selected" : "outline"}>
      {label.color ? <ChipDot color={label.color.backgroundColor} /> : null}
      <span className="min-w-0 truncate">{displayName}</span>
      {onRemove ? (
        <ChipRemove reveal label={`Remove "${displayName}"`} onRemove={onRemove} />
      ) : null}
    </Chip>
  );
}
