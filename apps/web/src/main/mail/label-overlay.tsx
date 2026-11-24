import { useEffect, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandLabel,
  CommandList,
} from "@otter/ui/components/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@otter/ui/components/dialog";
import { CheckIcon } from "lucide-react";
import { useCapabilities } from "@otter/client/mail/capabilities";
import { useLabels } from "@otter/client/mail/hooks";
import { buildLabelTree, flattenLabelTree, isAssignableLabel } from "@otter/client/mail/label-tree";
import { labelDisplayName } from "@otter/client/mail/label-names";
import type { MailLabel } from "@otter/client/mail/types";

export type LabelOverlayMode = "label" | "move";

type Choice = { id: string; name: string; color?: string };

export function LabelOverlay({
  open,
  onOpenChange,
  mode,
  accountId,
  appliedLabelIds,
  currentLabelId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: LabelOverlayMode;
  accountId: string | null;
  appliedLabelIds: string[];
  currentLabelId: string | null;
  onPick: (labelId: string, wasApplied: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const labelsQuery = useLabels(open ? accountId : null);
  const capabilities = useCapabilities(accountId);
  const folders = !capabilities.multipleLabels;
  const applied = new Set(appliedLabelIds);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Reset the picker when its external selection context changes.
    if (open) setQuery("");
  }, [open]);

  const userLabels = flattenLabelTree(
    buildLabelTree((labelsQuery.data ?? []).filter(isAssignableLabel)),
  )
    .map(({ node }) => node.label)
    .filter((l): l is MailLabel => l != null);

  const choices: Choice[] = [];
  if ((mode === "move" && currentLabelId !== "INBOX") || (mode === "label" && folders)) {
    choices.push({ id: "INBOX", name: "Inbox" });
  }
  for (const label of userLabels) {
    if (mode === "move" && label.id === currentLabelId) continue;
    if (
      capabilities.foldersAndCategories &&
      (mode === "move" ? !label.id.startsWith("folder:") : !label.id.startsWith("category:"))
    )
      continue;
    choices.push({
      id: label.id,
      name: labelDisplayName(label),
      color: label.color?.backgroundColor,
    });
  }

  const title =
    mode === "move"
      ? "Move to"
      : capabilities.foldersAndCategories
        ? "Categorize"
        : folders
          ? "Move to folder"
          : "Label as";
  const noun =
    folders || (capabilities.foldersAndCategories && mode === "move")
      ? "folder"
      : capabilities.foldersAndCategories
        ? "category"
        : "label";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="large" className="overflow-hidden" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Pick a {noun}</DialogDescription>
        </DialogHeader>
        <Command
          items={choices}
          itemToStringValue={(choice: Choice) => choice.name}
          value={query}
          onValueChange={setQuery}
        >
          <CommandInput placeholder={`${title}…`} />
          <CommandLabel>{title}</CommandLabel>
          <CommandEmpty>No {noun === "category" ? "categories" : `${noun}s`} found.</CommandEmpty>
          <CommandList>
            {(choice: Choice) => (
              <CommandItem
                key={choice.id}
                value={choice}
                className="py-2"
                onClick={() => {
                  onOpenChange(false);
                  onPick(choice.id, applied.has(choice.id));
                }}
              >
                <span
                  className={[
                    "size-2.5 rounded-full shrink-0",
                    choice.color ? "" : "bg-foreground-40",
                  ].join(" ")}
                  style={choice.color ? { backgroundColor: choice.color } : undefined}
                />
                <span className="truncate flex-1">{choice.name}</span>
                {mode === "label" && applied.has(choice.id) ? (
                  <CheckIcon className="shrink-0" />
                ) : null}
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
