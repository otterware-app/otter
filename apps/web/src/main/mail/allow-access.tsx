/**
 * Connections (docs/connections.md) in the renderer: what each sign-in provides and needs
 * permission for, and the one way to allow it: signing in again for that address, which
 * upgrades the sign-in in place.
 */

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConnectionSummary } from "@otter-mail/contracts";
import { ipc } from "~/lib/ipc";
import { signInProvider } from "./capabilities";
import { useAddAccount } from "./hooks";
import { toast } from "./toast";
import type { MailAccount } from "./types";
import { buttonClass, cn } from "./ui";

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

/** Everything a mailbox's sign-in needs permission for. */
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
    <button
      type="button"
      disabled={signIn.isPending}
      onClick={allow}
      className={cn(buttonClass("outline", "sm", "no-drag shrink-0"), className)}
    >
      {signIn.isPending ? "Waiting for sign-in…" : label}
    </button>
  );
}
