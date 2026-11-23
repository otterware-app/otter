import { useState } from "react";
import { CopyIcon, MessageCircleIcon, PhoneIcon } from "lucide-react";

import { features } from "../features";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";

export type PhoneAt = { number: string; text: string; x: number; y: number };

/** Apple Mail's menu for a phone number in a message: call, message, copy. */
export function usePhoneMenu() {
  const [at, setAt] = useState<PhoneAt | null>(null);
  const menu = at ? (
    <DropdownMenu open onOpenChange={(open) => !open && setAt(null)}>
      <DropdownMenuTrigger
        nativeButton={false}
        render={<span aria-hidden className="fixed size-0" style={{ left: at.x, top: at.y }} />}
      />
      <DropdownMenuContent>
        <DropdownMenuLabel>{at.text}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {features.phoneCalls ? (
          <>
            <DropdownMenuItem
              icon={<PhoneIcon />}
              onClick={() => void window.desktopBridge.openExternal(`tel:${at.number}`)}
            >
              Call
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<MessageCircleIcon />}
              onClick={() => void window.desktopBridge.openExternal(`sms:${at.number}`)}
            >
              Send Message
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuItem
          icon={<CopyIcon />}
          onClick={() => void navigator.clipboard.writeText(at.text)}
        >
          Copy
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;
  return { openPhoneMenu: setAt, phoneMenu: menu };
}
