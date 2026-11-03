import { useEffect, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { KeyRoundIcon, RotateCwIcon } from "lucide-react";

import { searchableSetting } from "../settings/settings-search";
import { useMailboxes } from "../mailboxes";
import { useLatest } from "../use-latest";
import { getAccountDisplayName } from "./account-style";
import { mailApi } from "./api";
import { signInProvider, signsInWithPassword } from "./capabilities";
import { syncStatusPollMs, useAddAccount } from "./hooks";
import { toast, type ToastId } from "./toast";
import type { MailAccount, SyncStatus } from "./types";
import { Btn, HintTooltip, IconBtn, cn } from "./ui";

export function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export type StatusLine = { text: string; tone: "muted" | "active" | "error"; detail?: string };

function syncLine(status: SyncStatus | undefined): StatusLine {
  if (!status) return { text: "…", tone: "muted" };
  // Only a full sync reads as "Syncing": the routine check for new mail runs
  // every tick and would otherwise blink here all the time.
  if (status.syncing && (status.phase === "full" || !status.lastSyncAt)) {
    const progress =
      status.phase === "full" && status.total
        ? ` ${status.synced.toLocaleString()} of ~${status.total.toLocaleString()}`
        : "";
    return { text: `Syncing${progress}…`, tone: "active" };
  }
  if (status.error && !status.syncing) {
    return { text: "Sync failed — will retry", tone: "error", detail: status.error };
  }
  const synced = status.lastSyncAt ? `Synced ${timeAgo(status.lastSyncAt)}` : "Not synced yet";
  if (status.download) {
    const left = Math.max(0, status.download.total - status.download.done);
    return { text: `${synced} · Saving ${left.toLocaleString()} for offline`, tone: "muted" };
  }
  return { text: synced, tone: "muted" };
}

function notOnThisDevice(account: MailAccount, status: SyncStatus | undefined): boolean {
  return account.signedOut === true && status != null && !status.lastSyncAt;
}

export function needsSignIn(account: MailAccount, status: SyncStatus | undefined): boolean {
  return account.signedOut === true || status?.signInNeeded === true;
}

export function accountStatus(account: MailAccount, status: SyncStatus | undefined): StatusLine {
  if (notOnThisDevice(account, status)) {
    return {
      text: "Not signed in on this device",
      tone: "muted",
      detail: "Added on another device. Sign in to use it here.",
    };
  }
  if (needsSignIn(account, status)) {
    return {
      text: signsInWithPassword(account) ? "Password needed" : "Signed out",
      tone: "error",
      detail: `${status?.error ?? "Sign in again to sync this mailbox."} Its cached mail stays.`,
    };
  }
  return syncLine(status);
}

export function StatusText({ status, className }: { status: StatusLine; className?: string }) {
  return (
    <span
      title={status.detail}
      className={cn(
        "flex min-w-0 items-center gap-1.5",
        status.tone === "error" && "text-destructive-foreground",
        status.tone === "active" && "text-foreground/80",
        className,
      )}
    >
      {status.tone !== "muted" ? (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            status.tone === "error" ? "bg-destructive" : "bg-primary",
          )}
        />
      ) : null}
      <span className="truncate">{status.text}</span>
    </span>
  );
}

function useSyncStatuses(accountIds: string[]): (SyncStatus | undefined)[] {
  return useQueries({
    queries: accountIds.map((id) => ({
      queryKey: ["gmail:syncStatus", id],
      queryFn: () => mailApi.getSyncStatus(id),
      refetchInterval: (query: { state: { data?: SyncStatus } }) =>
        syncStatusPollMs(query.state.data),
    })),
  }).map((r) => r.data);
}

let requestedMailbox: string | null = null;
export function takeRequestedMailbox(): string | null {
  const id = requestedMailbox;
  requestedMailbox = null;
  return id;
}

function signedOutTitle(account: MailAccount): string {
  const name = getAccountDisplayName(account);
  return signsInWithPassword(account) ? `${name} needs its password` : `${name} is signed out`;
}

const signInLabel = (account: MailAccount) =>
  signsInWithPassword(account) ? "Enter password" : "Sign in";

export function useSignInAgain() {
  const google = useAddAccount("gmail");
  const microsoft = useAddAccount("outlook");
  const navigate = useNavigate();
  const signIn = (account: MailAccount) => {
    if (signsInWithPassword(account)) {
      requestedMailbox = account.id;
      void navigate({
        to: "/settings/$pane",
        params: { pane: "accounts" },
        search: { target: searchableSetting("mailbox-status").id },
      });
      return;
    }
    const mutation = signInProvider(account) === "outlook" ? microsoft : google;
    void mutation.mutateAsync(account.email).catch((err: unknown) => {
      toast.error(`Couldn't sign in to ${account.email}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    });
  };
  return { signIn, pending: google.isPending || microsoft.isPending };
}

/**
 * A toast for each mailbox that stopped syncing because its sign-in was
 * refused, with the button that fixes it. It stays until the mailbox syncs
 * again; closed, it comes back only if the mailbox recovers and fails again.
 * Mailboxes never signed in on this device aren't raised: they say so where
 * they're opened. Mount once, in the main window.
 */
export function useSignInAlerts(): void {
  const { accounts } = useMailboxes();
  const statuses = useSyncStatuses(accounts.map((a) => a.id));
  const { signIn } = useSignInAgain();
  const signInRef = useLatest(signIn);
  const shown = useRef(new Map<string, ToastId>());
  const dismissed = useRef(new Set<string>());

  const key = accounts
    .map((a, i) => {
      const status = statuses[i];
      const alert = needsSignIn(a, status) && !notOnThisDevice(a, status) && status != null;
      return `${a.id}:${alert ? 1 : 0}`;
    })
    .join(",");
  useEffect(() => {
    const alerting = new Map(
      key
        .split(",")
        .filter((entry) => entry.endsWith(":1"))
        .map((entry) => {
          const id = entry.slice(0, -2);
          return [id, accounts.find((a) => a.id === id)!] as const;
        }),
    );
    for (const [id, toastId] of shown.current) {
      if (alerting.has(id)) continue;
      shown.current.delete(id);
      toast.close(toastId);
    }
    for (const id of dismissed.current) if (!alerting.has(id)) dismissed.current.delete(id);
    for (const [id, account] of alerting) {
      if (shown.current.has(id) || dismissed.current.has(id)) continue;
      const toastId = toast.warning(signedOutTitle(account), {
        timeout: 0,
        action: { label: signInLabel(account), onClick: () => signInRef.current(account) },
        onRemove: () => {
          if (shown.current.get(id) !== toastId) return;
          shown.current.delete(id);
          dismissed.current.add(id);
        },
      });
      shown.current.set(id, toastId);
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `key` serializes what decides the toasts; the accounts array is new every render.
  }, [key]);
}

function useAccountStatuses(accountIds: string[]) {
  const { accounts: all } = useMailboxes();
  const accounts = accountIds
    .map((id) => all.find((a) => a.id === id))
    .filter((a): a is MailAccount => a != null);
  return { accounts, statuses: useSyncStatuses(accounts.map((a) => a.id)) };
}

export function SignInCards({ accountIds }: { accountIds: string[] }) {
  const { accounts, statuses } = useAccountStatuses(accountIds);
  const { signIn, pending } = useSignInAgain();
  const signedOut = accounts.filter((a, i) => needsSignIn(a, statuses[i]));
  if (signedOut.length === 0) return null;
  return (
    <div className="mx-(--sidebar-content-inset) mb-1 flex flex-col gap-2">
      {signedOut.map((account) => (
        <div
          key={account.id}
          className="rounded-xl border border-destructive/30 bg-destructive/6 px-3 py-2.5"
        >
          <div className="flex items-center gap-2">
            <KeyRoundIcon className="size-3.5 shrink-0 text-destructive-foreground" />
            <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
              {signedOutTitle(account)}
            </p>
          </div>
          {pending ? (
            <Btn size="xs" className="mt-2 w-full" onClick={() => void mailApi.cancelAddAccount()}>
              Cancel sign-in
            </Btn>
          ) : (
            <Btn
              size="xs"
              variant="primary"
              className="mt-2 w-full"
              onClick={() => signIn(account)}
            >
              {signInLabel(account)}
            </Btn>
          )}
        </div>
      ))}
    </div>
  );
}

export function SyncButton({ accountIds }: { accountIds: string[] }) {
  const { accounts, statuses } = useAccountStatuses(accountIds);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    if (!syncing) return;
    const timer = setTimeout(() => setSyncing(false), 700);
    return () => clearTimeout(timer);
  }, [syncing]);

  if (accounts.length === 0) return null;
  const lines = accounts.map((a, i) => accountStatus(a, statuses[i]));
  const failed = lines.filter((l) => l.tone === "error");
  const shown: StatusLine =
    failed.length > 1
      ? { text: `Sync failed for ${failed.length} mailboxes — will retry`, tone: "error" }
      : (failed[0] ??
        lines.find((l) => l.tone === "active") ??
        syncLine(
          statuses.reduce<SyncStatus | undefined>(
            (oldest, s) =>
              !oldest || (s?.lastSyncAt ?? 0) < (oldest.lastSyncAt ?? 0) ? s : oldest,
            undefined,
          ),
        ));
  const busy = syncing || shown.tone === "active";
  return (
    <HintTooltip label={shown.text}>
      <IconBtn
        label="Sync now"
        disabled={busy}
        onClick={() => {
          setSyncing(true);
          for (const a of accounts) void mailApi.syncAccount(a.id).catch(() => {});
        }}
        className="relative disabled:cursor-default"
      >
        <RotateCwIcon className={cn("size-4", busy && "animate-spin")} />
        {shown.tone === "error" ? (
          <span
            aria-hidden
            className="absolute top-1 right-1 size-1.5 rounded-full bg-destructive"
          />
        ) : null}
      </IconBtn>
    </HintTooltip>
  );
}
