import { useState } from "react";
import {
  ArrowUpRightIcon,
  CalendarIcon,
  FilePenLineIcon,
  ListFilterIcon,
  MailIcon,
  PaletteIcon,
  TagIcon,
} from "lucide-react";
import { toast } from "@otter/ui/components/toast";
import { cn } from "@otter/ui/lib/utils";
import type { ChatChange } from "@otter/client/agents/api";
import { canOpenChange, chatChangeKey, chatChangeLine } from "@otter/client/agents/chat-changes";

const ICONS: Record<ChatChange["target"]["kind"], typeof MailIcon> = {
  draft: FilePenLineIcon,
  thread: MailIcon,
  label: TagIcon,
  view: ListFilterIcon,
  theme: PaletteIcon,
  event: CalendarIcon,
};

export function ChatChanges({
  changes,
  onOpen,
}: {
  changes: ChatChange[];
  onOpen: (change: ChatChange) => Promise<void>;
}) {
  const [opening, setOpening] = useState<string | null>(null);
  if (changes.length === 0) return null;
  const open = async (change: ChatChange) => {
    const key = chatChangeKey(change);
    setOpening(key);
    try {
      await onOpen(change);
    } catch (error) {
      toast.error("Couldn't open this item", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setOpening((current) => (current === key ? null : current));
    }
  };
  return (
    <section aria-label="Chat changes" className="my-2 min-w-0 px-1">
      <ul className="overflow-hidden rounded-lg border border-border/60">
        {changes.map((change) => {
          const key = chatChangeKey(change);
          const Icon = ICONS[change.target.kind];
          const { kind: label, action, description } = chatChangeLine(change);
          const canOpen = canOpenChange(change);
          const content = (
            <>
              <Icon className="size-3.5 shrink-0 text-icon-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                {change.title}
              </span>
              <span className="shrink-0 text-2xs text-muted-foreground">{action}</span>
              {canOpen ? (
                <ArrowUpRightIcon className="size-3 shrink-0 text-icon-muted" aria-hidden />
              ) : null}
            </>
          );
          const rowClass = "flex w-full items-center gap-2 px-2 py-1 text-left";
          return (
            <li key={key} className="border-b border-border/40 last:border-b-0">
              {canOpen ? (
                <button
                  type="button"
                  aria-label={`Open ${label}: ${change.title}`}
                  title={`${description}: ${change.title}`}
                  aria-busy={opening === key}
                  onClick={() => void open(change)}
                  className={cn(
                    rowClass,
                    "outline-none hover:bg-accent-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring",
                    opening === key && "animate-status-pulse",
                  )}
                >
                  {content}
                </button>
              ) : (
                <div className={rowClass} title={`${description}: ${change.title}`}>
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
