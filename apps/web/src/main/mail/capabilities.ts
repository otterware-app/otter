import type { MailCapabilities } from "@otter-mail/contracts";
import { capabilitiesOf } from "@otter-mail/client-runtime/capabilities";

import { useAccounts } from "./hooks";

export * from "@otter-mail/client-runtime/capabilities";

export function useCapabilities(accountId: string | null | undefined): MailCapabilities {
  const accounts = useAccounts().data;
  return capabilitiesOf(accounts?.find((a) => a.id === accountId));
}
