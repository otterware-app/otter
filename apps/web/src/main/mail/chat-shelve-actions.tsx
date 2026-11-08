import { useState, type ReactNode } from "react";
import { shelveChat } from "./chat-store";
import { snoozePresets } from "./chat-shelves";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./menu";
import { HintTooltip } from "./ui";

export function settleChat(id: string) {
  void shelveChat(id, { snoozedUntil: null, settledAt: Date.now() });
}

export function SnoozeMenu({
  chatId,
  side,
  onDone,
  children,
}: {
  chatId: string;
  side: "top" | "bottom";
  onDone?: () => void;
  children: ReactNode;
}) {
  const [openedAt, setOpenedAt] = useState(0);
  return (
    <DropdownMenu onOpenChange={(open) => open && setOpenedAt(Date.now())}>
      <HintTooltip label="Snooze" side={side}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent align="end">
        {snoozePresets(new Date(openedAt)).map((p) => (
          <DropdownMenuItem
            key={p.id}
            accelerator={p.when}
            onSelect={() => {
              void shelveChat(chatId, { snoozedUntil: p.until, settledAt: null });
              onDone?.();
            }}
          >
            {p.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
