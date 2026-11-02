import { findVerificationCode } from "@otter-mail/shared/verification-code";
import { htmlToText, type MessageCardProps, type UiExtension } from "@otter-mail/web/extension-kit";
import { useMemo } from "react";

import { manifest } from "../manifest";
import { CodeCard } from "./code-card";
import { KeyRoundIcon } from "lucide-react";

function SignInCodeCard({ summary, detail, onTrash }: MessageCardProps) {
  const code = useMemo(
    () =>
      findVerificationCode(
        summary.subject,
        detail.bodyText ?? (detail.bodyHtml ? htmlToText(detail.bodyHtml) : ""),
      ),
    [detail, summary.subject],
  );
  return code ? <CodeCard code={code} onTrash={onTrash} /> : null;
}

export default {
  manifest,
  Icon: KeyRoundIcon,
  messageCards: [SignInCodeCard],
} satisfies UiExtension;
