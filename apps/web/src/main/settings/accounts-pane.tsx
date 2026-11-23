import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@otter/ui/components/avatar";
import { Dialog } from "@otter/ui/components/dialog";
import { Popover, PopoverPopup, PopoverTrigger } from "@otter/ui/components/popover";
import { Text } from "@otter/ui/components/text";
import { CheckIcon, PlusIcon, RotateCwIcon } from "lucide-react";
import { Switch } from "@otter/ui/components/switch";
import {
  arrangeMailboxes,
  setMailboxArrangement,
  useAliasMailInParent,
  useMailboxArrangement,
} from "../mailboxes";
import type { AliasMailbox } from "@otter/contracts";
import {
  aliasMailboxId,
  aliasMailboxLook,
  aliasMailboxesOf,
  withAliasMailbox,
  type AliasMailboxEntry,
} from "../mail/alias-mailboxes";
import { mailApi } from "../mail/api";
import { useOtterAccount } from "../otter-account";
import { toast } from "@otter/ui/components/toast";
import {
  syncStatusPollMs,
  useAccounts,
  useAddAccount,
  useRemoveAccount,
  useUpdateAccount,
} from "../mail/hooks";
import { RichTextArea, type RichTextRef } from "../mail/rich-text";
import { AddMailboxMenu, ImapPasswordForm } from "../mail/add-mailbox";
import { AllowAccessButton, needsOf, useConnections } from "../mail/allow-access";
import {
  ConnectionExtensionPage,
  ConnectionExtensionsSection,
  connectionExtensions,
} from "../extensions/extensions-pane";
import { ProviderMark } from "../mail/provider-mark";
import {
  capabilitiesOf,
  mailServerName,
  signInName,
  signInProvider,
  signsInWithPassword,
} from "../mail/capabilities";
import {
  ACCOUNT_COLOR_PALETTE,
  getAccountColor,
  getAccountDisplayName,
  getAccountPicture,
} from "../mail/account-style";
import type { MailAccount, SyncStatus } from "../mail/types";
import { StatusText, accountStatus, needsSignIn, takeRequestedMailbox } from "../mail/sync-health";
import { searchableSetting } from "./settings-search";
import { MailboxPictureRow } from "./mailbox-picture";
import { DropdownMenuItem, keyboardOnlyFocus } from "@otter/ui/components/dropdown-menu";
import { Button, IconButton } from "@otter/ui/components/button";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { cn } from "@otter/ui/lib/utils";
import {
  SettingsResetButton,
  SettingsGroup,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "@otter/ui/components/settings";
import { DraftInput, Input } from "@otter/ui/components/input";

function useSyncStatusOnly(accountId: string) {
  return useQuery<SyncStatus>({
    queryKey: ["gmail:syncStatus", accountId],
    queryFn: () => mailApi.getSyncStatus(accountId),
    refetchInterval: (query) => syncStatusPollMs(query.state.data),
  });
}

function ColorPicker({
  color,
  label,
  onPick,
}: {
  color: string;
  label: string;
  onPick: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <HintTooltip label="Account color">
        <PopoverTrigger render={<IconButton label={label} />}>
          <span
            className="size-3.5 rounded-full ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: color }}
          />
        </PopoverTrigger>
      </HintTooltip>
      <PopoverPopup
        align="end"
        sideOffset={6}
        padding="none"
        finalFocus={keyboardOnlyFocus}
        className="rounded-xl before:rounded-[calc(var(--radius-xl)-1px)]"
      >
        <div className="grid grid-cols-5 gap-1.5 p-2.5">
          {ACCOUNT_COLOR_PALETTE.map((swatch) => {
            const picked = swatch.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={swatch}
                type="button"
                aria-label={`Use ${swatch}`}
                onClick={() => {
                  onPick(swatch);
                  setOpen(false);
                }}
                className="flex size-6 cursor-pointer items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-popover transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-focus-ring"
                style={{ backgroundColor: swatch }}
              >
                {picked ? <CheckIcon className="size-3.5 text-white" strokeWidth={3} /> : null}
              </button>
            );
          })}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function AccountAvatar({ account, size = "md" }: { account: MailAccount; size?: "md" | "lg" }) {
  const displayName = getAccountDisplayName(account);
  const picture = getAccountPicture(account);
  return (
    <span className="relative shrink-0">
      <Avatar size={size}>
        {picture ? (
          <AvatarImage src={picture} alt={displayName} referrerPolicy="no-referrer" />
        ) : null}
        <AvatarFallback>{(displayName[0] ?? "?").toUpperCase()}</AvatarFallback>
      </Avatar>
      <span
        aria-hidden
        className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card"
        style={{ backgroundColor: getAccountColor(account) }}
      />
    </span>
  );
}

function SignInButton({
  email,
  provider = "gmail",
  label,
  services,
}: {
  email?: string;
  provider?: "gmail" | "outlook";
  label: string;
  services?: ReactNode;
}) {
  const signIn = useAddAccount(provider);
  if (signIn.isPending) {
    return (
      <Button size="sm" onClick={() => void mailApi.cancelAddAccount()}>
        Cancel sign-in
      </Button>
    );
  }
  const google = () =>
    void signIn.mutateAsync(email).catch((err: unknown) => {
      toast.error(email ? `Couldn't sign in to ${email}` : "Couldn't add the account", {
        description: err instanceof Error ? err.message : String(err),
      });
    });
  if (email) {
    return (
      <Button size="sm" variant="primary" onClick={google}>
        {label}
      </Button>
    );
  }
  return (
    <AddMailboxMenu onGmail={google} align="end" services={services}>
      <Button size="sm" variant="outline">
        <PlusIcon className="size-3.5" />
        {label}
      </Button>
    </AddMailboxMenu>
  );
}

/** An alias mailbox's row hangs from its parent's by a line, from the parent's picture down. */
type Branch = { first: boolean; last: boolean };

function MailboxListRow({
  label,
  selected,
  onSelect,
  branch,
  children,
  toggle,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  branch?: Branch;
  children: ReactNode;
  toggle: ReactNode;
}) {
  return (
    <div
      data-slot="settings-row"
      className={cn(
        "relative flex items-center gap-3 px-4",
        branch ? "min-h-[52px] py-2 pl-12" : "min-h-[60px] py-2.5",
        selected ? "bg-foreground/[0.04]" : "hover:bg-foreground/[0.03]",
      )}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
        onClick={onSelect}
        aria-label={`Select ${label}`}
        aria-pressed={selected}
      />
      {branch ? (
        <span aria-hidden className="pointer-events-none">
          <span
            className={cn(
              "absolute left-[31.5px] w-px bg-foreground/15",
              branch.first ? "-top-3" : "top-0",
              branch.last ? "bottom-1/2" : "bottom-0",
            )}
          />
          <span className="absolute left-[31.5px] top-1/2 h-px w-3 bg-foreground/15" />
        </span>
      ) : null}
      {children}
      {toggle}
    </div>
  );
}

function AccountListRow({
  account,
  selected,
  onSelect,
  on,
  onToggle,
  lastOn,
}: {
  account: MailAccount;
  selected: boolean;
  onSelect: () => void;
  on: boolean;
  onToggle: (on: boolean) => void;
  lastOn: boolean;
}) {
  const sync = useSyncStatusOnly(account.id);
  const status = accountStatus(account, sync.data);
  const connection = useConnections().data?.find((c) => c.id === account.id);
  const needsPermission = needsOf(connection ? [connection] : undefined, account.id).length > 0;
  const provides = connection?.resources.map((r) => RESOURCE_NAMES[r.kind]).join(" · ");
  return (
    <MailboxListRow
      label={account.email}
      selected={selected}
      onSelect={onSelect}
      toggle={
        <HintTooltip label={lastOn ? "Keep at least one mailbox on" : on ? "Turn off" : "Turn on"}>
          <span className="relative z-10 flex">
            <Switch
              checked={on}
              disabled={lastOn}
              onCheckedChange={onToggle}
              aria-label={`${getAccountDisplayName(account)} on`}
            />
          </span>
        </HintTooltip>
      }
    >
      <span className={cn("pointer-events-none contents", !on && "[&>*]:opacity-50")}>
        <AccountAvatar account={account} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
            <ProviderMark account={account} />
            <span className="truncate">{getAccountDisplayName(account)}</span>
            {provides ? (
              <span className="shrink-0 text-xs text-muted-foreground">{provides}</span>
            ) : null}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-body leading-[18px] text-muted-foreground">
            <span className="min-w-0 shrink truncate">{account.email}</span>
            <span aria-hidden>·</span>
            {on ? (
              <StatusText status={status} className="shrink-0" />
            ) : (
              <span className="shrink-0">Turned off</span>
            )}
            {on && needsPermission ? (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0 text-foreground">Needs permission</span>
              </>
            ) : null}
          </span>
        </span>
      </span>
    </MailboxListRow>
  );
}

function AliasMailboxListRow({
  entry,
  selected,
  onSelect,
  on,
  parentOn,
  onToggle,
  branch,
}: {
  entry: AliasMailboxEntry;
  selected: boolean;
  onSelect: () => void;
  on: boolean;
  parentOn: boolean;
  onToggle: (on: boolean) => void;
  branch: Branch;
}) {
  const parentName = getAccountDisplayName(entry.parent);
  return (
    <MailboxListRow
      label={entry.alias.address}
      selected={selected}
      onSelect={onSelect}
      branch={branch}
      toggle={
        <HintTooltip
          label={!parentOn ? `Turn ${parentName} on first` : on ? "Turn off" : "Turn on"}
        >
          <span className="relative z-10 flex">
            <Switch
              checked={on && parentOn}
              disabled={!parentOn}
              onCheckedChange={onToggle}
              aria-label={`${entry.name} on`}
            />
          </span>
        </HintTooltip>
      }
    >
      <span className={cn("pointer-events-none contents", !(on && parentOn) && "[&>*]:opacity-50")}>
        <AccountAvatar account={aliasMailboxLook(entry)} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{entry.name}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-body leading-[18px] text-muted-foreground">
            <span className="min-w-0 shrink truncate">{entry.alias.address}</span>
            {on ? null : (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0">Turned off</span>
              </>
            )}
          </span>
        </span>
      </span>
    </MailboxListRow>
  );
}

const RESOURCE_NAMES = { mail: "Mail", calendar: "Calendar" } as const;

function editedSignature(editor: RichTextRef): string {
  const html = editor.getHTML();
  return editor.getText().trim() || /<img\b/i.test(html) ? html : "";
}

function AccountEditor({ account }: { account: MailAccount }) {
  const updateAccount = useUpdateAccount();
  const removeAccount = useRemoveAccount();
  const signIn = useAddAccount();
  const sync = useSyncStatusOnly(account.id);
  const displayName = getAccountDisplayName(account);
  const status = accountStatus(account, sync.data);
  const capabilities = capabilitiesOf(account);
  const signatureRef = useRef<RichTextRef>(null);
  const [shown, setShown] = useState(account.signature ?? "");
  const loadedRef = useRef<string | null>(null);
  useEffect(() => {
    loadedRef.current = signatureRef.current ? editedSignature(signatureRef.current) : null;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Re-run this DOM/reset lifecycle when its explicit trigger changes, even when the callback reads refs.
  }, [shown]);
  useEffect(() => {
    const next = account.signature ?? "";
    const editor = signatureRef.current;
    if (next === shown) return;
    if (!editor || editedSignature(editor) === loadedRef.current) setShown(next);
  }, [account.signature, shown]);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const syncNow = () => {
    setSyncing(true);
    void mailApi
      .syncAccount(account.id)
      .catch(() => {})
      .finally(() => setTimeout(() => setSyncing(false), 700));
  };

  const saveSignature = () => {
    const editor = signatureRef.current;
    if (!editor) return;
    const html = editedSignature(editor);
    if (html === loadedRef.current) return;
    console.log("[Settings:updateSignature]", { accountId: account.id });
    void updateAccount.mutateAsync({ accountId: account.id, signature: html }).then(
      (saved) => {
        setShown(saved.signature ?? "");
        if (saved.signatureInGmail === false) {
          toast.info("Signature saved in Otter, not in Gmail", {
            description: `Sign in to ${account.email} again to let Otter save it in Gmail too.`,
            action: {
              label: "Sign in",
              onClick: () => void signIn.mutateAsync(account.email).catch(() => {}),
            },
          });
          return;
        }
        toast.success(
          capabilities.serverSignatures ? "Signature saved in Gmail" : "Signature saved",
        );
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Couldn't save the signature", { description: message });
      },
    );
  };

  return (
    <>
      <MailboxNotifications account={account} />
      <SettingsSection
        title={displayName}
        icon={<AccountAvatar account={account} />}
        headerAction={<span className="text-xs text-muted-foreground">{account.email}</span>}
      >
        <SettingsRow
          id={searchableSetting("mailbox-status").id}
          title="Status"
          description={<StatusText status={status} />}
          control={
            needsSignIn(account, sync.data) && signsInWithPassword(account) ? (
              <ImapPasswordForm account={account} />
            ) : needsSignIn(account, sync.data) ? (
              <SignInButton
                email={account.email}
                provider={signInProvider(account)}
                label="Sign in"
              />
            ) : (
              <div className="flex items-center gap-2">
                {/* Failing for another reason: signing in again is still worth a try. */}
                {sync.data?.error && !signsInWithPassword(account) ? (
                  <SignInButton
                    email={account.email}
                    provider={signInProvider(account)}
                    label="Sign in again"
                  />
                ) : null}
                <Button size="sm" disabled={syncing || sync.data?.syncing} onClick={syncNow}>
                  <RotateCwIcon
                    className={cn("size-3.5", (syncing || sync.data?.syncing) && "animate-spin")}
                  />
                  Sync now
                </Button>
              </div>
            )
          }
        />
        <SettingsRow
          {...searchableSetting("mailbox-display-name")}
          resetAction={
            account.displayName ? (
              <SettingsResetButton
                label="mailbox display name"
                onClick={() =>
                  void updateAccount.mutateAsync({ accountId: account.id, displayName: "" })
                }
              />
            ) : null
          }
          description="Shown in the sidebar and account switcher. Only used in Otter."
          control={
            <DraftInput
              value={displayName}
              onCommit={(name) => {
                if (!name) return;
                console.log("[Settings:renameAccount]", { accountId: account.id, name });
                void updateAccount.mutateAsync({ accountId: account.id, displayName: name });
              }}
              aria-label={`Display name for ${account.email}`}
              className="@min-[32rem]/settings-row:w-56"
            />
          }
        />
        <SettingsRow
          id={searchableSetting("mailbox-color").id}
          resetAction={
            getAccountColor(account) !== getAccountColor({ id: account.id }) ? (
              <SettingsResetButton
                label="mailbox color"
                onClick={() =>
                  void updateAccount.mutateAsync({
                    accountId: account.id,
                    color: "",
                  })
                }
              />
            ) : null
          }
          title="Color"
          description="Marks this account's mail in combined mailboxes."
          control={
            <ColorPicker
              color={getAccountColor(account)}
              label={`Color for ${account.email}`}
              onPick={(swatch) =>
                void updateAccount.mutateAsync({ accountId: account.id, color: swatch })
              }
            />
          }
        />
        <MailboxPictureRow account={account} />
      </SettingsSection>

      <MailboxAccess account={account} />

      <SettingsSection
        {...searchableSetting("signature")}
        description={
          capabilities.serverSignatures
            ? "Added to new messages, replies and forwards from this account. Saved in Gmail, so it's the same there and on every device."
            : "Added to new messages, replies and forwards from this account, on every device with your Otter account."
        }
        headerAction={
          <Button size="sm" variant="primary" onClick={saveSignature}>
            Save signature
          </Button>
        }
      >
        <RichTextArea
          key={shown}
          ref={signatureRef}
          placeholder="Your signature…"
          ariaLabel={`Signature for ${account.email}`}
          minHeightClass="min-h-[96px]"
          initialHTML={shown}
        />
      </SettingsSection>

      {capabilities.sendAs === "device" || account.sendAs?.length ? (
        <SendAsSection account={account} />
      ) : null}

      <SettingsSection title="Remove">
        <SettingsRow
          {...searchableSetting("remove-mailbox")}
          description={`Stops syncing and deletes the local copy. Nothing is deleted from ${mailServerName(account)}.`}
          control={
            <Button size="sm" variant="destructive" onClick={() => setConfirmRemove(true)}>
              Remove…
            </Button>
          }
        />
      </SettingsSection>

      <Dialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${displayName}?`}
        confirmLabel={removeAccount.isPending ? "Removing…" : "Remove account"}
        confirmVariant="primary"
        onConfirm={() => {
          console.log("[Settings:removeAccount]", { accountId: account.id });
          void removeAccount.mutateAsync(account.id).then(() => setConfirmRemove(false));
        }}
      >
        <Text variant="small">
          Otter stops syncing {account.email} and deletes its local copy. Nothing is deleted from{" "}
          {mailServerName(account)}. You can add the account again any time.
        </Text>
      </Dialog>
    </>
  );
}

function MailboxAccess({ account }: { account: MailAccount }) {
  const connection = useConnections().data?.find((c) => c.id === account.id);
  if (!connection || connection.provider === "imap" || !connection.signedIn) return null;
  return (
    <SettingsSection
      {...searchableSetting("mailbox-access")}
      description={`What Otter may use from your ${signInName(account)} sign-in.`}
    >
      {connection.resources.map((resource) => {
        const [first, ...more] = resource.needs;
        return (
          <SettingsRow
            key={resource.kind}
            title={RESOURCE_NAMES[resource.kind]}
            description={
              first ? [first, ...more].map((need) => need.consequence).join(". ") : "Allowed"
            }
            control={
              first ? (
                <AllowAccessButton account={account} label={first.allow} className="h-7" />
              ) : null
            }
          />
        );
      })}
    </SettingsSection>
  );
}

function SendAsSection({ account }: { account: MailAccount }) {
  const updateAccount = useUpdateAccount();
  const [adding, setAdding] = useState("");
  const editable = capabilitiesOf(account).sendAs === "device";
  const addresses = account.sendAs ?? [];
  const mailboxes = useAccounts().data ?? [];
  const aliasMailboxes = aliasMailboxesOf(account, mailboxes);
  const ownMailboxes = new Set(aliasMailboxes.map((a) => a.id));
  const [aliasMailInParent, setAliasMailInParent] = useAliasMailInParent(account);
  const name = getAccountDisplayName(account);
  const suggested = useQuery({
    queryKey: ["send-as-suggestions", account.id, addresses.join()],
    queryFn: () => mailApi.suggestSendAs(account.id),
    enabled: editable,
  }).data;

  const save = (sendAs: string[]) => {
    console.log("[Settings:updateSendAs]", { accountId: account.id, count: sendAs.length });
    return updateAccount.mutateAsync({ accountId: account.id, sendAs }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Couldn't save the addresses", { description: message });
      throw err;
    });
  };
  const add = (address = adding.trim()) => {
    if (!address) return;
    void save([...addresses, address]).then(
      () => setAdding(""),
      () => {},
    );
  };
  const ownMailboxSwitch = (address: string, id?: string) =>
    !editable ||
    mailboxes.some((a) => aliasMailboxId(a.email) === aliasMailboxId(address)) ? null : (
      <label id={id} className="flex items-center gap-2 text-xs text-muted-foreground">
        Own mailbox
        <Switch
          checked={ownMailboxes.has(aliasMailboxId(address))}
          aria-label={`${address} has its own mailbox`}
          onCheckedChange={(on) => {
            console.log("[Settings:ownMailbox]", { accountId: account.id, on });
            void updateAccount
              .mutateAsync({
                accountId: account.id,
                ...(addresses.includes(address) ? {} : { sendAs: [...addresses, address] }),
                aliasMailboxes: withAliasMailbox(account, address, on ? {} : null),
              })
              .catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                toast.error("Couldn't change its mailbox", { description: message });
              });
          }}
        />
      </label>
    );

  return (
    <SettingsSection
      {...searchableSetting("send-as")}
      description={
        editable
          ? `Other addresses ${mailServerName(account)} lets you send from, like an alias or your own domain's. Offered in From, and replies go from the address the mail was sent to.`
          : "From Gmail's “Send mail as” settings. Offered in From, and replies go from the address the mail was sent to."
      }
    >
      <SettingsRow title={account.email} description="This mailbox's own address" />
      {addresses.map((address, i) => (
        <SettingsRow
          key={address}
          title={address}
          control={
            editable ? (
              <div className="flex items-center gap-4">
                {ownMailboxSwitch(
                  address,
                  i === 0 ? searchableSetting("own-mailbox").id : undefined,
                )}
                <Button
                  size="sm"
                  onClick={() => void save(addresses.filter((a) => a !== address)).catch(() => {})}
                >
                  Remove
                </Button>
              </div>
            ) : null
          }
        />
      ))}
      {aliasMailboxes.length > 0 ? (
        <SettingsRow
          {...searchableSetting("alias-mail-in-parent")}
          title={`Their mail in ${name} too`}
          description={`Mail for ${new Intl.ListFormat("en-GB").format(aliasMailboxes.map((a) => a.name))} also shows in ${name}'s tab. Off, ${name} shows only the rest.`}
          control={
            <Switch
              checked={aliasMailInParent}
              onCheckedChange={setAliasMailInParent}
              aria-label={`Mail of ${name}'s own mailboxes in ${name} too`}
            />
          }
        />
      ) : null}
      {editable
        ? suggested?.map((address) => (
            <SettingsRow
              key={address}
              title={address}
              description="Found in your mail"
              control={
                <div className="flex items-center gap-4">
                  {ownMailboxSwitch(address)}
                  <Button size="sm" disabled={updateAccount.isPending} onClick={() => add(address)}>
                    Add
                  </Button>
                </div>
              }
            />
          ))
        : null}
      {editable ? (
        <SettingsRow
          title="Add an address"
          control={
            <div className="flex items-center gap-2">
              <Input
                type="email"
                value={adding}
                placeholder="you@yourdomain.com"
                aria-label={`Another address ${account.email} sends from`}
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") add();
                }}
                className="@min-[32rem]/settings-row:w-56"
              />
              <Button
                size="sm"
                disabled={!adding.trim() || updateAccount.isPending}
                onClick={() => add()}
              >
                Add
              </Button>
            </div>
          }
        />
      ) : null}
    </SettingsSection>
  );
}

function AliasMailboxEditor({ entry, onStop }: { entry: AliasMailboxEntry; onStop: () => void }) {
  const updateAccount = useUpdateAccount();
  const { parent, alias } = entry;
  const parentName = getAccountDisplayName(parent);
  const signatureRef = useRef<RichTextRef>(null);
  const save = (patch: Partial<AliasMailbox> | null, done?: string) =>
    updateAccount
      .mutateAsync({
        accountId: parent.id,
        aliasMailboxes: withAliasMailbox(parent, alias.address, patch),
      })
      .then(
        () => {
          if (done) toast.success(done);
        },
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          toast.error("Couldn't save the change", { description: message });
        },
      );
  const saveSignature = () => {
    const editor = signatureRef.current;
    if (!editor) return;
    console.log("[Settings:aliasSignature]", { accountId: parent.id });
    void save({ signature: editedSignature(editor) }, "Signature saved");
  };
  const defaultColor = getAccountColor({ id: entry.id });
  return (
    <>
      <SettingsSection
        {...searchableSetting("alias-mailbox")}
        title={entry.name}
        icon={<AccountAvatar account={aliasMailboxLook(entry)} />}
        headerAction={<span className="text-xs text-muted-foreground">{alias.address}</span>}
      >
        <SettingsRow
          title="Display name"
          resetAction={
            alias.name ? (
              <SettingsResetButton label="display name" onClick={() => void save({ name: "" })} />
            ) : null
          }
          description="Shown in the sidebar and in notifications of its mail."
          control={
            <DraftInput
              value={entry.name}
              onCommit={(name) => {
                if (!name) return;
                console.log("[Settings:renameAliasMailbox]", { accountId: parent.id });
                void save({ name });
              }}
              aria-label={`Display name for ${alias.address}`}
              className="@min-[32rem]/settings-row:w-56"
            />
          }
        />
        <SettingsRow
          title="Color"
          resetAction={
            entry.color !== defaultColor ? (
              <SettingsResetButton label="color" onClick={() => void save({ color: "" })} />
            ) : null
          }
          description="Its tab's, and the app's while it's open."
          control={
            <ColorPicker
              color={entry.color}
              label={`Color for ${alias.address}`}
              onPick={(color) => void save({ color })}
            />
          }
        />
        <MailboxPictureRow account={aliasMailboxLook(entry)} alias={entry} />
        <SettingsRow
          title="Own mailbox"
          description={`Its mail stays in ${parentName}. Off, it's one of the addresses ${parentName} sends from.`}
          control={
            <Switch
              checked
              aria-label={`${alias.address} has its own mailbox`}
              onCheckedChange={() => {
                console.log("[Settings:ownMailbox]", { accountId: parent.id, on: false });
                void save(null).then(onStop);
              }}
            />
          }
        />
      </SettingsSection>
      <SettingsSection
        title="Signature"
        description={`Added to new messages, replies and forwards from ${alias.address}. Without one, ${parentName}'s is.`}
        headerAction={
          <Button size="sm" variant="primary" onClick={saveSignature}>
            Save signature
          </Button>
        }
      >
        <RichTextArea
          ref={signatureRef}
          placeholder={`${parentName}'s signature…`}
          ariaLabel={`Signature for ${alias.address}`}
          minHeightClass="min-h-[96px]"
          initialHTML={alias.signature ?? ""}
        />
      </SettingsSection>
    </>
  );
}

function MailboxNotifications({ account }: { account: MailAccount }) {
  const otter = useOtterAccount();
  const [busy, setBusy] = useState(false);
  const [confirmImap, setConfirmImap] = useState(false);
  const connections = useQuery({
    queryKey: ["notification-connections", otter?.user?.email],
    queryFn: mailApi.notificationConnections,
    enabled: Boolean(otter?.user),
    refetchInterval: otter?.user ? 5000 : false,
  });
  const provider = account.provider ?? "gmail";
  const connection = connections.data?.connections.find(
    (c) => c.email === account.email.toLowerCase(),
  );
  if (!otter?.user || account.signedOut || !connections.data?.providers[provider]) return null;
  const connect = async () => {
    setBusy(true);
    setConfirmImap(false);
    try {
      const result = await mailApi.connectNotifications(account.id);
      if ("url" in result) await window.desktopBridge.openExternal(result.url);
      await connections.refetch();
    } catch (error) {
      toast.error("Couldn't connect notifications", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    try {
      await mailApi.disconnectNotifications(account.id);
      await connections.refetch();
    } catch {
      toast.error("Couldn't disconnect notifications", {
        description: "Check your connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  };
  const description =
    connection?.status === "ready"
      ? "Connected. Alerts are sent only for confirmed new mail."
      : connection?.status === "retry"
        ? "Connection interrupted. Otter is retrying."
        : connection?.status === "reauthorize"
          ? "Authorization expired. Reconnect to resume alerts."
          : connection?.status === "connecting"
            ? "Checking the connection…"
            : "Receive verified new-mail alerts on your iPhone while the app is closed.";
  return (
    <SettingsSection title="iPhone notifications">
      <SettingsRow
        title="Background notifications"
        description={description}
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (connection?.status === "ready") void disconnect();
              else if (provider === "imap") setConfirmImap(true);
              else void connect();
            }}
          >
            {busy ? "Connecting…" : connection?.status === "ready" ? "Disconnect" : "Connect"}
          </Button>
        }
      />
      {connection && connection.status !== "ready" ? (
        <div className="px-4 pb-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void disconnect()}>
            Disconnect
          </Button>
        </div>
      ) : null}
      {provider !== "imap" ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          Google or Microsoft will ask for limited access to identify new mail. Message bodies and
          previews continue to load directly on your iPhone.
        </p>
      ) : null}
      {confirmImap ? (
        <div className="px-4 pb-4 text-sm">
          <p>
            Enable IMAP background notifications? Otter will securely store this mailbox’s password
            and connect to its IMAP server to check for new mail. The password permits mailbox
            access; Otter’s watcher reads only metadata needed to identify new mail.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void connect()}>
              Enable notifications
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmImap(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </SettingsSection>
  );
}

export function AccountsPane({ item }: { item?: string }) {
  if (item) return <ConnectionExtensionPage id={item} />;
  return <ConnectionsHub />;
}

function ConnectionsHub() {
  const navigate = useNavigate();
  const accountsQuery = useAccounts();
  const arrangement = useMailboxArrangement();
  // In the sidebar's order, each account with its alias mailboxes.
  const tabs = arrangeMailboxes(accountsQuery.data ?? [], arrangement);
  const accounts = tabs.flatMap((tab) => (tab.alias ? [] : [tab.account]));
  const aliasesOf = (account: MailAccount) =>
    tabs.flatMap((tab) => (tab.alias?.parent.id === account.id ? [tab.alias] : []));
  const isOn = (key: string) => !arrangement.off.includes(key);
  const onCount = accounts.filter((a) => isOn(a.email)).length;
  const toggle = (key: string, on: boolean) =>
    setMailboxArrangement({
      ...arrangement,
      off: on ? arrangement.off.filter((e) => e !== key) : [...arrangement.off, key],
    });
  const [selectedId, setSelectedId] = useState<string | null>(takeRequestedMailbox);
  const currentAlias = tabs.find((tab) => tab.alias?.id === selectedId)?.alias;
  const current = accounts.find((a) => a.id === selectedId) ?? currentAlias?.parent ?? accounts[0];
  useEffect(() => void mailApi.refreshSignatures().catch(() => {}), []);

  return (
    <SettingsPageContainer
      searchId={searchableSetting("mailboxes").id}
      title="Connections"
      description="The accounts you've connected and what each gives Otter. Mailboxes turn on or off on every device; with all of them in the sidebar (Appearance), drag them there to order them."
      action={
        <SignInButton
          label="Add account"
          services={connectionExtensions().map((extension) => {
            const Icon = extension.Icon;
            return (
              <DropdownMenuItem
                key={extension.manifest.id}
                icon={Icon ? <Icon /> : undefined}
                onClick={() =>
                  void navigate({
                    to: "/settings/$pane/$item",
                    params: { pane: "accounts", item: extension.manifest.id },
                  })
                }
              >
                {extension.manifest.name}
              </DropdownMenuItem>
            );
          })}
        />
      }
    >
      {current ? (
        <>
          <SettingsGroup>
            {accounts.map((account) => {
              const aliases = aliasesOf(account);
              return (
                <div key={account.id} className="overflow-hidden">
                  <AccountListRow
                    account={account}
                    selected={!currentAlias && account.id === current.id}
                    onSelect={() => setSelectedId(account.id)}
                    on={isOn(account.email)}
                    lastOn={isOn(account.email) && onCount === 1}
                    onToggle={(next) => toggle(account.email, next)}
                  />
                  {aliases.map((alias, i) => (
                    <AliasMailboxListRow
                      key={alias.id}
                      entry={alias}
                      selected={alias === currentAlias}
                      onSelect={() => setSelectedId(alias.id)}
                      on={isOn(alias.id)}
                      parentOn={isOn(account.email)}
                      onToggle={(next) => toggle(alias.id, next)}
                      branch={{ first: i === 0, last: i === aliases.length - 1 }}
                    />
                  ))}
                </div>
              );
            })}
          </SettingsGroup>
          <ConnectionExtensionsSection />
          {currentAlias ? (
            <AliasMailboxEditor
              key={currentAlias.id}
              entry={currentAlias}
              onStop={() => setSelectedId(currentAlias.parent.id)}
            />
          ) : (
            <AccountEditor key={current.id} account={current} />
          )}
        </>
      ) : (
        <>
          <SettingsGroup>
            <SettingsRow
              title={accountsQuery.isLoading ? "Loading accounts…" : "No accounts yet"}
              description="Add a Google or Microsoft account, or any mailbox that works with IMAP, to start syncing mail."
            />
          </SettingsGroup>
          <ConnectionExtensionsSection />
        </>
      )}
    </SettingsPageContainer>
  );
}
