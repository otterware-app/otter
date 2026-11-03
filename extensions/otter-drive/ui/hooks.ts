import { toast } from "@otter-mail/web/extension-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { driveApi } from "./api";

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function useDriveStatus() {
  return useQuery({ queryKey: ["otter-drive", "status"], queryFn: driveApi.status });
}

/** After a change: the lists, documents and folders it may have changed. */
export function useRefresh() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ["artifacts", "artifact", "versions", "folders", "drives"].map((key) =>
        qc.invalidateQueries({ queryKey: ["otter-drive", key] }),
      ),
    );
}

/** The folders of the drives that are on (drives, their folders, folders shared with you). */
export function useFolders(enabled: boolean) {
  return useQuery({
    queryKey: ["otter-drive", "folders"],
    queryFn: driveApi.folders,
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

/** Every drive, on or off here: Settings' list. */
export function useDrives(enabled: boolean) {
  return useQuery({
    queryKey: ["otter-drive", "drives"],
    queryFn: driveApi.drives,
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

/**
 * Otter Drive's device sign-in: a code shown here, confirmed in the system
 * browser (where Drive's own session is), while this waits.
 */
export function useDriveSignIn() {
  const qc = useQueryClient();
  const [code, setCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Leaving ends it, even before its code has come: nothing opens, nothing is kept.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void driveApi.cancelSignIn().catch(() => {});
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setPending(true);
    try {
      await action();
      await qc.resetQueries({ queryKey: ["otter-drive"] });
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setPending(false);
      setCode(null);
    }
  };
  return {
    code,
    pending,
    run,
    signIn: () =>
      run(async () => {
        const start = await driveApi.startSignIn();
        if (!alive.current) return;
        setCode(start.userCode);
        void window.desktopBridge.openExternal(start.verificationUrl).catch(() => {});
        await driveApi.finishSignIn(start.deviceCode, start.attempt);
      }),
    cancel: () => void driveApi.cancelSignIn(),
  };
}
