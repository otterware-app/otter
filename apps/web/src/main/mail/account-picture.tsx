import { Avatar, AvatarFallback, AvatarImage } from "@otter/ui/components/avatar";
import {
  getAccountColor,
  getAccountDisplayName,
  getAccountPicture,
} from "@otter/client/mail/account-style";
import type { MailAccount } from "@otter/client/mail/types";

export function AccountPicture({
  account,
  className,
}: {
  account: MailAccount;
  className?: string;
}) {
  const picture = getAccountPicture(account);
  return (
    <Avatar className={className} aria-hidden>
      {picture ? <AvatarImage src={picture} alt="" referrerPolicy="no-referrer" /> : null}
      <AvatarFallback
        className="font-bold leading-none text-white"
        style={{ background: getAccountColor(account) }}
      >
        {(getAccountDisplayName(account)[0] ?? "?").toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
