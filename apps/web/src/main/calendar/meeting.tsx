import { CopyIcon, VideoIcon, XIcon } from "lucide-react";
import { meetingProvider, type MeetingProvider, type MeetingService } from "@otter-mail/contracts";
import { toast } from "../mail/toast";
import { HintTooltip, IconBtn } from "../mail/ui";

export const MEETING_NAMES: Record<MeetingProvider, string> = {
  googleMeet: "Google Meet",
  teams: "Microsoft Teams",
  zoom: "Zoom",
  webex: "Webex",
  other: "Video call",
};

export function MeetingMark({
  provider,
  className = "size-4",
}: {
  provider: MeetingProvider;
  className?: string;
}) {
  switch (provider) {
    case "googleMeet":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden>
          <path fill="#00ac47" d="M15 10.4 21 6.6v10.8l-6-3.8z" />
          <path fill="#ea4335" d="M6.4 6 2 10.4h4.4z" />
          <path fill="#2684fc" d="M2 10.4V16a2 2 0 0 0 2 2h2.4v-7.6z" />
          <path fill="#ffba00" d="M6.4 6H13a2 2 0 0 1 2 2v2.4H6.4z" />
          <path fill="#00832d" d="M6.4 10.4H15v3.2H6.4z" />
          <path fill="#00ac47" d="M6.4 13.6H15V16a2 2 0 0 1-2 2H6.4z" />
        </svg>
      );
    case "teams":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden>
          <circle cx="18.5" cy="7.2" r="2.4" fill="#7b83eb" />
          <path fill="#7b83eb" d="M15.5 10.5h5.7c.4 0 .8.4.8.8v4.2a3.3 3.3 0 0 1-6.5.8z" />
          <rect x="2" y="5.5" width="13.5" height="13" rx="2" fill="#5059c9" />
          <path fill="#fff" d="M5.3 9h6.9v1.6H9.6V16H7.9v-5.4H5.3z" />
        </svg>
      );
    case "zoom":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden>
          <rect x="1" y="1" width="22" height="22" rx="6" fill="#0b5cff" />
          <path
            fill="#fff"
            d="M5 9a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 14 9v6H8a3 3 0 0 1-3-3z"
          />
          <path fill="#fff" d="m15 10.6 3.3-2.3a.5.5 0 0 1 .7.4v6.6a.5.5 0 0 1-.7.4L15 13.4z" />
        </svg>
      );
    default:
      return <VideoIcon className={className} aria-hidden />;
  }
}

export function MeetingRow({ link, onRemove }: { link: string; onRemove?: () => void }) {
  const provider = meetingProvider(link);
  const copy = () =>
    void navigator.clipboard.writeText(link).then(
      () => toast.success("Meeting link copied"),
      () => toast.error("Couldn't copy the link"),
    );
  return (
    <div className="group/meeting flex min-h-8 items-center gap-3 px-4 py-1">
      <span className="flex h-6 w-4 shrink-0 items-center justify-center">
        <MeetingMark provider={provider} className="size-4 text-muted-foreground" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px]">{MEETING_NAMES[provider]}</span>
        <span className="truncate text-[11px] text-muted-foreground">
          {link.replace(/^https:\/\//, "")}
        </span>
      </div>
      <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/meeting:opacity-100 group-focus-within/meeting:opacity-100">
        <HintTooltip label="Copy link">
          <IconBtn label="Copy meeting link" onClick={copy}>
            <CopyIcon />
          </IconBtn>
        </HintTooltip>
        {onRemove ? (
          <HintTooltip label="Remove meeting">
            <IconBtn label="Remove meeting" onClick={onRemove}>
              <XIcon />
            </IconBtn>
          </HintTooltip>
        ) : null}
      </span>
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-6 shrink-0 items-center rounded-md bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Join
      </a>
    </div>
  );
}

export function AddMeetingRow({
  service,
  added,
  onChange,
}: {
  service: MeetingService;
  added: boolean;
  onChange: (added: boolean) => void;
}) {
  return (
    <div className="flex min-h-8 items-center gap-3 px-4 py-1">
      <span className="flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-[15px]">
        {added ? <MeetingMark provider={service} /> : <VideoIcon />}
      </span>
      {added ? (
        <>
          <span className="flex-1 truncate text-[13px]">{MEETING_NAMES[service]}</span>
          <IconBtn label="Remove meeting" onClick={() => onChange(false)}>
            <XIcon />
          </IconBtn>
        </>
      ) : (
        <button
          type="button"
          onClick={() => onChange(true)}
          className="-mx-1.5 flex h-6 min-w-0 flex-1 cursor-pointer items-center rounded-md px-1.5 text-left text-[13px] text-muted-foreground outline-none hover:bg-foreground/[0.04] hover:text-foreground focus-visible:bg-foreground/[0.04]"
        >
          Add {MEETING_NAMES[service]}
        </button>
      )}
    </div>
  );
}
