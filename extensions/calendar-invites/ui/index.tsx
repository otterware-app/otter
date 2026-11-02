import type { MessageCardProps, MessageDetail, UiExtension } from "@otter-mail/web/extension-kit";

import { manifest } from "../manifest";
import type { RsvpResponse } from "./api";
import { InviteCard, requestRsvp, rsvpFromGoogleLink } from "./invite-card";
import { CalendarCheckIcon } from "lucide-react";

const hasInvite = (detail: MessageDetail) =>
  detail.attachments.some(
    (a) => /text\/calendar|application\/ics/i.test(a.mimeType) || /\.ics$/i.test(a.filename),
  );

function InvitationCard({ accountId, summary, detail }: MessageCardProps) {
  return hasInvite(detail) ? <InviteCard accountId={accountId} messageId={summary.id} /> : null;
}

export default {
  manifest,
  Icon: CalendarCheckIcon,
  messageCards: [InvitationCard],
  bodyLinks: {
    applies: hasInvite,
    answer: rsvpFromGoogleLink,
    open: (messageId, answer) => requestRsvp(messageId, answer as RsvpResponse),
  },
} satisfies UiExtension;
