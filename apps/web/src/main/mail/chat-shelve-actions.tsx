import { useState } from "react";
import { AlarmClockIcon, CheckIcon, UndoIcon } from "lucide-react";
import { shelveChat, type Conversation } from "./chat-store";
import { snoozePresets } from "./chat-shelves";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./menu";
import { cn } from "./ui";

const ACTION =
  "flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none hover:bg-foreground/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring data-[state=open]:bg-foreground/[0.08] data-[state=open]:text-foreground";

/**
 * Otter Code's hover actions on a chat: snooze (⏰) and Settle, or Unsettle a
 * settled one. `compact`: icons only, for the bottom bar's tabs. `onDone`
 * runs once the chat is put away (the bar closes its tab).
 */
export function ShelveActions({
  chat,
  settled,
  compact = false,
  onDone,
}: {
  chat: Conversation;
  settled: boolean;
  compact?: boolean;
  onDone?: () => void;
}) {
  const action = cn(ACTION, compact && "h-5 px-1");
  // The snooze times count from when the menu opens.
  const [openedAt, setOpenedAt] = useState(0);
  if (settled)
    return (
      <button
        type="button"
        aria-label="Unsettle"
        title={compact ? "Unsettle" : undefined}
        className={action}
        onClick={() => void shelveChat(chat.id, { snoozedUntil: null, settledAt: null })}
      >
        <UndoIcon className="size-3.5" />
        {compact ? null : "Unsettle"}
      </button>
    );
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <DropdownMenu onOpenChange={(open) => open && setOpenedAt(Date.now())}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Snooze" title="Snooze" className={action}>
            <AlarmClockIcon className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {snoozePresets(new Date(openedAt)).map((p) => (
            <DropdownMenuItem
              key={p.id}
              accelerator={p.when}
              onSelect={() => {
                void shelveChat(chat.id, { snoozedUntil: p.until, settledAt: null });
                onDone?.();
              }}
            >
              {p.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label="Settle"
        title={compact ? "Settle" : undefined}
        className={action}
        onClick={() => {
          void shelveChat(chat.id, { snoozedUntil: null, settledAt: Date.now() });
          onDone?.();
        }}
      >
        <CheckIcon className="size-3.5" />
        {compact ? null : "Settle"}
      </button>
    </div>
  );
}
