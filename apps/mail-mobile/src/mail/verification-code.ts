import { useMessage } from "@otter/client/mail/hooks";
import type { MessageSummary } from "@otter/client/mail/types";
import {
  findVerificationCode,
  mentionsVerificationCode,
} from "@otter/client/mail/verification-code";

import { decodeEntities, htmlToPlain } from "./compose-text.ts";

export function mayHaveVerificationCode({ subject, snippet }: MessageSummary): boolean {
  return mentionsVerificationCode(subject) || mentionsVerificationCode(snippet);
}

export function useVerificationCode(
  accountId: string | undefined,
  message: MessageSummary | undefined,
) {
  const candidate = accountId && message && mayHaveVerificationCode(message) ? message : null;
  const preview =
    candidate && findVerificationCode(candidate.subject, decodeEntities(candidate.snippet));
  const { data } = useMessage(preview ? null : (accountId ?? null), candidate?.id ?? null);
  return (
    candidate &&
    (preview ??
      (data
        ? findVerificationCode(candidate.subject, data.bodyText || htmlToPlain(data.bodyHtml ?? ""))
        : null))
  );
}
