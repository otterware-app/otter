import { useEffect, useState } from "react";

import type { LocalCopy, LocalCopySummary } from "../worker/local-drafts";
import { core } from "./core";

export type { LocalCopy, LocalCopySummary };

/** A mailbox's "On this iPhone" copies (the worker's `drafts:localCopies`), kept current. */
export function useLocalCopies(accountId: string | null, enabled: boolean): LocalCopySummary[] {
  const [copies, setCopies] = useState<LocalCopySummary[]>([]);
  useEffect(() => {
    if (!accountId || !enabled) return setCopies([]);
    const load = () =>
      void core
        .invoke<LocalCopySummary[]>("drafts:localCopies", { accountId })
        .then(setCopies, () => setCopies([]));
    load();
    const off = [
      core.on("drafts:localCopiesChanged", load),
      core.on("gmail:accounts-changed", load),
    ];
    return () => off.forEach((f) => f());
  }, [accountId, enabled]);
  return copies;
}

export const localCopies = {
  get: (accountId: string, id: string) =>
    core.invoke<LocalCopy | null>("drafts:getLocalCopy", { accountId, id }),
  keep: (copy: Omit<LocalCopy, "updated">) => core.invoke("drafts:keepLocalCopy", copy),
  remove: (id: string) => core.invoke("drafts:deleteLocalCopy", { id }),
};
