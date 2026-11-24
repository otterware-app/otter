/**
 * Connections (docs/connections.md) in the renderer: what each sign-in provides and needs
 * permission for, and the one way to allow it: signing in again for that address, which
 * upgrades the sign-in in place.
 */

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConnectionSummary } from "@otter/contracts";
import { ipc } from "@otter/client/bridge";
import { signInProvider } from "@otter/client/mail/capabilities";
import { useAddAccount } from "@otter/client/mail/hooks";
import { toast } from "@otter/ui/components/toast";
import type { MailAccount } from "@otter/client/mail/types";
import { Button } from "@otter/ui/components/button";
import { cn } from "@otter/ui/lib/utils";

const CONNECTIONS = ["connections"] as const;

export function useConnections() {
  const qc = useQueryClient();
  useEffect(() => {
    const refresh = () => void qc.invalidateQueries({ queryKey: CONNECTIONS });
    const off = [
      window.desktopBridge.on("connections:changed", refresh),
      window.desktopBridge.on("gmail:accounts-changed", refresh),
    ];
    return () => off.forEach((unsubscribe) => unsubscribe());
  }, [qc]);
  return useQuery({
    queryKey: CONNECTIONS,
    queryFn: () => ipc<ConnectionSummary[]>("connections:list", {}),
    staleTime: 5 * 60_000,
  });
}

export function needsOf(connections: ConnectionSummary[] | undefined, accountId: string) {
  return connections?.find((c) => c.id === accountId)?.resources.flatMap((r) => r.needs) ?? [];
}

export function AllowAccessButton({
  account,
  label,
  className,
}: {
  account: MailAccount;
  label: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const signIn = useAddAccount(signInProvider(account));
  const allow = () => {
    console.log("[allowAccess]", { accountId: account.id });
    void signIn.mutateAsync(account.email).then(
      (signedIn) => {
        void qc.invalidateQueries({ queryKey: ["calendar"] });
        void qc.invalidateQueries({ queryKey: CONNECTIONS });
        // Google lets you pick another account than the one hinted: that one gets added instead.
        if (signedIn && signedIn.email.toLowerCase() !== account.email.toLowerCase()) {
          toast.error(`You signed in to ${signedIn.email}`, {
            description: `To allow access for ${account.email}, choose that account at Google.`,
          });
        }
      },
      (err: unknown) =>
        toast.error(`Couldn't get permission for ${account.email}`, {
          description: err instanceof Error ? err.message : String(err),
        }),
    );
  };
  return (
    <Button
      size="sm"
      disabled={signIn.isPending}
      onClick={allow}
      className={cn("no-drag shrink-0", className)}
    >
      {signIn.isPending ? "Waiting for sign-in…" : label}
    </Button>
  );
}
