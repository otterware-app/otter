import { ipc, listen } from "@otter/client/bridge";
import { OTTER_ACCOUNT_STATE_CHANNEL, type OtterAccountState } from "@otter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

const KEY = ["otter-account"] as const;

/** The Otter account core is signed in to, kept current; undefined until core says. */
export function useOtterAccount(): OtterAccountState | undefined {
  const qc = useQueryClient();
  useEffect(
    () =>
      listen(OTTER_ACCOUNT_STATE_CHANNEL, (state) =>
        qc.setQueryData(KEY, state as OtterAccountState),
      ),
    [qc],
  );
  return useQuery({ queryKey: KEY, queryFn: () => ipc<OtterAccountState>("otter:getState") }).data;
}
