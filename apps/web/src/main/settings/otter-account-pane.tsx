import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OtterAccountState, OtterDevice } from "@otter/contracts";
import { LaptopIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@otter/ui/components/avatar";
import { Dialog } from "@otter/ui/components/dialog";
import { Text } from "@otter/ui/components/text";
import { mailApi } from "../mail/api";
import { useAccounts, useAddAccount } from "../mail/hooks";
import { toast } from "@otter/ui/components/toast";
import { otterApi, useOtterAccount } from "../otter-account";
import { searchableSetting } from "./settings-search";
import { Button } from "@otter/ui/components/button";
import { cn } from "@otter/ui/lib/utils";
import {
  SettingsGroup,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "@otter/ui/components/settings";
import { timeAgo } from "./time-ago";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function OtterAvatar({
  user,
  className,
}: {
  user: NonNullable<OtterAccountState["user"]>;
  className?: string;
}) {
  return (
    <Avatar size="md" className={className}>
      {user.picture ? <AvatarImage src={user.picture} alt={user.email} /> : null}
      <AvatarFallback>{(user.name ?? user.email)[0]?.toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

function useOtterSignIn() {
  const [pending, setPending] = useState<"otter" | "mailbox" | null>(null);
  const addMailbox = useAddAccount();
  const signIn = () => {
    setPending("otter");
    otterApi
      .signIn()
      .then(async (state) => {
        const email = state?.user?.email.toLowerCase();
        if (!email) return;
        const accounts = await mailApi.listAccounts();
        if (accounts.some((a) => a.email.toLowerCase() === email && !a.signedOut)) return;
        setPending("mailbox");
        await addMailbox.mutateAsync(email).catch((err: unknown) => {
          toast.error(`Couldn't add ${email}`, { description: errorText(err) });
        });
      })
      .catch((err: unknown) => {
        toast.error("Couldn't sign in to Otter", { description: errorText(err) });
      })
      .finally(() => setPending(null));
  };
  const cancel = () =>
    void (pending === "mailbox" ? mailApi.cancelAddAccount() : otterApi.cancelSignIn());
  return { pending, signIn, cancel };
}

export function SignInControl() {
  const { pending, signIn, cancel } = useOtterSignIn();
  return pending ? (
    <Button size="sm" onClick={cancel}>
      Cancel sign-in
    </Button>
  ) : (
    <Button size="sm" variant="primary" onClick={signIn}>
      Sign in with Google
    </Button>
  );
}

const REALTIME_STATUS = {
  live: { text: "Connected: new mail arrives as it lands", dot: "bg-primary" },
  connecting: { text: "Connecting…", dot: "bg-muted-foreground/60" },
  off: { text: "Not connected", dot: "bg-muted-foreground/60" },
} as const;

function DevicesSection() {
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ["otter:devices"], queryFn: otterApi.listDevices });
  const signOutDevice = useMutation({
    mutationFn: (device: OtterDevice) => otterApi.signOutDevice(device.token),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["otter:devices"] }),
    onError: (err) => toast.error("Couldn't sign that device out", { description: errorText(err) }),
  });

  return (
    <SettingsSection {...searchableSetting("devices")}>
      {devices.isError ? (
        <SettingsRow title="Couldn't load your devices" description={errorText(devices.error)} />
      ) : !devices.data ? (
        <SettingsRow title="Loading devices…" />
      ) : (
        devices.data.map((device) => (
          <SettingsRow
            key={device.token}
            title={
              <span className="flex items-center gap-2">
                <LaptopIcon className="size-4 text-muted-foreground" />
                {device.name}
              </span>
            }
            description={
              device.current ? "This device" : `Last active ${timeAgo(device.lastActiveAt)}`
            }
            control={
              device.current ? null : (
                <Button
                  size="sm"
                  disabled={signOutDevice.isPending}
                  onClick={() => signOutDevice.mutate(device)}
                >
                  Sign out
                </Button>
              )
            }
          />
        ))
      )}
    </SettingsSection>
  );
}

function SignedInPane({ state }: { state: OtterAccountState }) {
  const user = state.user!;
  const mailboxes = useAccounts().data?.length ?? 0;
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const status = REALTIME_STATUS[state.realtime];

  const run = (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    action()
      .catch((err: unknown) => toast.error(failure, { description: errorText(err) }))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <SettingsGroup>
        <SettingsRow
          id={searchableSetting("otter-account").id}
          title={
            <span className="flex items-center gap-2.5">
              <OtterAvatar user={user} />
              {user.name ?? user.email}
            </span>
          }
          description={`${user.email} · ${
            mailboxes === 1 ? "Your mailbox follows" : `Your ${mailboxes} mailboxes follow`
          } you to every device`}
          status={
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-1.5 rounded-full", status.dot)} />
              {status.text}
            </span>
          }
          control={
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(otterApi.signOut, "Couldn't sign out")}
            >
              Sign out of Otter
            </Button>
          }
        />
      </SettingsGroup>

      <DevicesSection />

      <SettingsSection title="Delete account">
        <SettingsRow
          {...searchableSetting("delete-otter-account")}
          description="Removes your account and its list of mailboxes from Otter's servers, and signs out every device. Your mail and the mailboxes on each device stay."
          control={
            <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
              Delete…
            </Button>
          }
        />
      </SettingsSection>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete your Otter account?"
        confirmLabel={busy ? "Deleting…" : "Delete account"}
        confirmVariant="destructive"
        onConfirm={() =>
          run(
            () => otterApi.deleteAccount().then(() => setConfirmDelete(false)),
            "Couldn't delete the account",
          )
        }
      >
        <Text variant="small">
          Otter's servers forget {user.email} and its list of mailboxes, and every device signs out.
          Nothing is deleted from Gmail, and this device keeps its mailboxes and mail.
        </Text>
      </Dialog>
    </>
  );
}

export function OtterAccountPane() {
  const state = useOtterAccount();
  return (
    <SettingsPageContainer
      title="Account"
      description="Your Otter account brings your mailboxes, agents and chats to every device, with new mail pushed as it arrives."
    >
      {!state ? null : state.user ? (
        <SignedInPane state={state} />
      ) : (
        <SettingsGroup>
          <SettingsRow
            id={searchableSetting("otter-account").id}
            title="Sign in to Otter"
            description="Your mailboxes, agents and chats on every device you use, and new mail the moment it arrives. Otter keeps your agents and chats; your mail stays between you and your mail provider."
            control={<SignInControl />}
          />
        </SettingsGroup>
      )}
    </SettingsPageContainer>
  );
}

export function OtterSignInOnboardingLink() {
  const state = useOtterAccount();
  const { pending, signIn, cancel } = useOtterSignIn();
  if (!state || state.user) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {pending ? (
        <>
          {pending === "mailbox"
            ? "Adding your mailbox: finish in Google. "
            : "Waiting for Google. "}
          <button type="button" className="cursor-pointer underline" onClick={cancel}>
            Cancel
          </button>
        </>
      ) : (
        <>
          Already use Otter?{" "}
          <button
            type="button"
            className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline"
            onClick={signIn}
          >
            Sign in
          </button>
        </>
      )}
    </p>
  );
}
