import { CloudIcon, ServerIcon } from "lucide-react";
import gmailMark from "../assets/gmail.svg";
import { isICloud } from "@otter/client/mail/capabilities";
import type { MailAccount } from "@otter/client/mail/types";

export function GmailMark({ className = "size-4" }: { className?: string }) {
  return <img src={gmailMark} className={`${className} object-contain`} alt="" aria-hidden />;
}

export function MicrosoftMark({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 21 21" className={className} aria-hidden>
      <path fill="#f25022" d="M1 1h9v9H1z" />
      <path fill="#7fba00" d="M11 1h9v9h-9z" />
      <path fill="#00a4ef" d="M1 11h9v9H1z" />
      <path fill="#ffb900" d="M11 11h9v9h-9z" />
    </svg>
  );
}

export function ProviderMark({
  account,
  className = "size-3.5",
}: {
  account: Pick<MailAccount, "provider" | "imap">;
  className?: string;
}) {
  const provider = account.provider ?? "gmail";
  const icloud = isICloud(account);
  const label = icloud
    ? "iCloud"
    : provider === "gmail"
      ? "Gmail"
      : provider === "outlook"
        ? "Outlook"
        : "IMAP";
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 items-center">
      {provider === "gmail" ? (
        <GmailMark className={className} />
      ) : provider === "outlook" ? (
        <MicrosoftMark className={className} />
      ) : icloud ? (
        <CloudIcon className={className} color="#3b9cf5" fill="currentColor" aria-hidden />
      ) : (
        <ServerIcon className={className} aria-hidden />
      )}
    </span>
  );
}
