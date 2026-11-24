import { useState, type ReactElement } from "react";
import { snoozeChat } from "@otter/client/agents/chat-actions";
import { snoozePresets } from "@otter/client/agents/chat-shelves";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";
import { HintTooltip } from "@otter/ui/components/tooltip";

export function SnoozeMenu({
  chatId,
  side,
  onDone,
  children,
}: {
  chatId: string;
  side: "top" | "bottom";
  onDone?: () => void;
  children: ReactElement;
}) {
  const [openedAt, setOpenedAt] = useState(0);
  return (
    <DropdownMenu onOpenChange={(open) => open && setOpenedAt(Date.now())}>
      <HintTooltip label="Snooze" side={side}>
        <DropdownMenuTrigger render={children} />
      </HintTooltip>
      <DropdownMenuContent align="end">
        {snoozePresets(new Date(openedAt)).map((p) => (
          <DropdownMenuItem
            key={p.id}
            accelerator={p.when}
            onClick={() => {
              void snoozeChat(chatId, p.until);
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
