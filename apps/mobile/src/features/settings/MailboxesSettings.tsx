import { useAtomValue } from "@effect/atom-react";
import {
  Button,
  ColorPicker,
  ConfirmationDialog,
  HStack,
  LabeledContent,
  List,
  NavigationLink,
  RNHostView,
  SecureField,
  Spacer,
  Text,
  TextField,
  Toggle,
  Toolbar,
  ToolbarItem,
  useNativeState,
  VStack,
} from "@expo/ui/swift-ui";
import {
  disabled,
  environment,
  font,
  foregroundStyle,
  labelsHidden,
  multilineTextAlignment,
  onSubmit,
  padding,
  textContentType,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useState, type ReactNode } from "react";
import { Alert, View } from "react-native";

import { mailboxes, type Mailbox } from "../../state/client";
import { core } from "../../state/core";
import { cancelled, signInAgain, signInWithPassword } from "../../state/mailbox-sign-in";
import {
  connectionOf,
  connectNotifications,
  disconnectNotifications,
  notificationStatus,
  offerNotifications,
  useNotificationConnections,
} from "../../state/notification-connections";
import { inDemo } from "../../state/otter";
import { setUiPreference, uiPreferencesAtom } from "../../state/preferences";
import { syncLine, useSyncHealth } from "../../state/sync-health";
import { MailboxAvatar } from "../home/PlacesBar";
import type { Palette } from "../theme";
import {
  arrangeScopes,
  groupScopes,
  isShown,
  moveScope,
  parseApart,
  parseArrangement,
  setScopeOn,
  type Arrangement,
  type Scope,
} from "./arrangement";
import { ProviderMark, isICloud } from "./ProviderMark";
import { Group, SettingsForm } from "./SettingsScreen";
import { SignatureEditor } from "./SignatureEditor";

const name = (m: Mailbox) => m.displayName || m.name || m.email;

/** "Me", "Me and Studio", "Me, Studio and Shop". */
const listed = (names: string[]) =>
  names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

const failed = (title: string) => (e: unknown) => {
  if (!cancelled(e)) Alert.alert(title, e instanceof Error ? e.message : String(e));
};

/** `mail:mailboxes` and `mail:alias-mail-apart`, as the Mac, the web and apps/ios keep them. */
function useArrangement(): Arrangement {
  return parseArrangement(useAtomValue(uiPreferencesAtom)["mail:mailboxes"]);
}

const setArrangement = (next: Arrangement) =>
  setUiPreference("mail:mailboxes", JSON.stringify(next));

/** In RNHostView: RN draws the mailbox's picture and the provider's mark for SwiftUI's rows. */
function Hosted({ children }: { children: ReactNode }) {
  return (
    <RNHostView matchContents>
      <View pointerEvents="none">{children}</View>
    </RNHostView>
  );
}

/**
 * apps/ios's MailboxesSettings: each mailbox, alias mailboxes under their
 * parent, turned on or off (on every device); Edit reorders them, an alias
 * mailbox anywhere. Then adding Gmail, Outlook and IMAP.
 */
export function MailboxesSettings({
  colors,
  onAddImap,
}: {
  colors: Palette;
  onAddImap: () => void;
}) {
  const accounts = useAtomValue(mailboxes.accountsAtom).value;
  const arrangement = useArrangement();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const arranged = arrangeScopes(accounts, arrangement);
  const scopes = editing ? arranged : groupScopes(arranged);
  const shown = arranged.filter((s) => isShown(s, arrangement));
  const shownMailboxes = shown.filter((s) => !s.alias).length;

  const add = async (channel: string) => {
    setBusy(true);
    try {
      const added = await core.invoke<{ id: string; email: string; provider?: string } | null>(
        channel,
      );
      await mailboxes.refreshAccounts();
      if (added) void offerNotifications(added);
    } catch (e) {
      failed("Couldn't add the mailbox")(e);
    } finally {
      setBusy(false);
    }
  };

  const row = (scope: Scope<Mailbox>) => {
    const { mailbox, alias } = scope;
    const on = isShown(scope, arrangement);
    const parentOn = shown.some((s) => !s.alias && s.mailbox.email === mailbox.email);
    const locked = alias ? !parentOn : on && shownMailboxes === 1;
    const title = alias?.name ?? name(mailbox);
    const look: Mailbox = alias
      ? {
          ...mailbox,
          displayName: alias.name,
          color: alias.color,
          picture: undefined,
          customPicture: mailbox.aliasPictures?.[scope.key],
        }
      : mailbox;
    const label = (
      <HStack spacing={12} modifiers={alias && !editing ? [padding({ leading: 24 })] : []}>
        <Hosted>
          <MailboxAvatar mailbox={look} size={30} />
        </Hosted>
        <VStack alignment="leading" spacing={2}>
          <HStack spacing={6}>
            {alias ? null : (
              <Hosted>
                <ProviderMark mailbox={mailbox} color={colors.secondary} />
              </Hosted>
            )}
            <Text modifiers={[foregroundStyle(colors.text)]}>{title}</Text>
            {alias && editing ? (
              <Text
                modifiers={[font({ textStyle: "subheadline" }), foregroundStyle(colors.secondary)]}
              >
                {`in ${name(mailbox)}`}
              </Text>
            ) : null}
          </HStack>
          <Text
            modifiers={[
              font({ textStyle: "subheadline" }),
              foregroundStyle(mailbox.signedOut ? colors.warning : colors.secondary),
            ]}
          >
            {mailbox.signedOut ? "Sign in on this iPhone" : (alias?.address ?? mailbox.email)}
          </Text>
        </VStack>
        <Spacer />
      </HStack>
    );
    return (
      <HStack spacing={12}>
        {alias ? label : <NavigationLink value={`mailbox:${mailbox.id}`}>{label}</NavigationLink>}
        <Toggle
          label={`Show ${title}`}
          isOn={on}
          onIsOnChange={(next) =>
            setArrangement(setScopeOn(accounts, arrangement, scope.key, next))
          }
          modifiers={[labelsHidden(), tint(colors.accent), disabled(locked)]}
        />
      </HStack>
    );
  };

  return (
    <Toolbar>
      <SettingsForm colors={colors} title="Mailboxes">
        <Group
          colors={colors}
          footer={
            <Text>
              {arranged.some((s) => s.alias)
                ? "Turned-off mailboxes stay signed in but aren't shown or synced, on every device. An alias mailbox is its mailbox's mail for one of its addresses."
                : "Turned-off mailboxes stay signed in but aren't shown or synced, on every device."}
            </Text>
          }
        >
          <List.ForEach
            data={scopes}
            keyExtractor={(s) => s.key}
            recycling={false}
            onMove={(from, destination) => {
              const at = from[0]!;
              setArrangement(
                moveScope(
                  accounts,
                  arrangement,
                  at,
                  destination > at ? destination - 1 : destination,
                ),
              );
            }}
            modifiers={[environment("editMode", editing ? "active" : "inactive")]}
          >
            {({ item }) => row(item)}
          </List.ForEach>
          {inDemo ? null : (
            <>
              <Button onPress={() => void add("gmail:addAccount")} modifiers={[disabled(busy)]}>
                <HStack spacing={12}>
                  <Hosted>
                    <ProviderMark mailbox={{ provider: "gmail" }} size={18} color={colors.text} />
                  </Hosted>
                  <Text>{busy ? "Adding the mailbox…" : "Add Gmail mailbox"}</Text>
                </HStack>
              </Button>
              <Button
                onPress={() => void add("gmail:addOutlookAccount")}
                modifiers={[disabled(busy)]}
              >
                <HStack spacing={12}>
                  <Hosted>
                    <ProviderMark mailbox={{ provider: "outlook" }} size={18} color={colors.text} />
                  </Hosted>
                  <Text>Add Outlook mailbox</Text>
                </HStack>
              </Button>
              <Button
                label="Add IMAP mailbox"
                systemImage="envelope.badge"
                onPress={onAddImap}
                modifiers={[disabled(busy)]}
              />
            </>
          )}
        </Group>
      </SettingsForm>
      <Toolbar.Content>
        <ToolbarItem placement="primaryAction">
          <Button label={editing ? "Done" : "Edit"} onPress={() => setEditing(!editing)} />
        </ToolbarItem>
      </Toolbar.Content>
    </Toolbar>
  );
}

const server = (m: Mailbox) =>
  m.provider === "outlook"
    ? "Outlook"
    : m.provider === "imap"
      ? isICloud(m)
        ? "iCloud"
        : "the server"
      : "Gmail";

/**
 * apps/ios's MailboxSettings: a failing sync and signing in again, background
 * notifications, its name and color (on every device), whether its alias
 * mailboxes' mail shows in it too, its signature, and removing it.
 */
export function MailboxSettings({
  colors,
  mailbox,
  signedIn,
  onRemoved,
}: {
  colors: Palette;
  mailbox: Mailbox;
  /** The Otter account: background notifications need it. */
  signedIn: boolean;
  onRemoved: () => void;
}) {
  const accounts = useAtomValue(mailboxes.accountsAtom).value;
  const ui = useAtomValue(uiPreferencesAtom);
  const displayName = useNativeState(name(mailbox));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmImap, setConfirmImap] = useState(false);
  const health = useSyncHealth(mailbox.signedOut || inDemo ? [] : [mailbox.id])[mailbox.id];
  const [notifications, refreshNotifications] = useNotificationConnections();
  const imap = mailbox.provider === "imap";
  const provider = mailbox.provider ?? "gmail";
  const connection = connectionOf(notifications, mailbox.email);
  const aliases = arrangeScopes(accounts, parseArrangement(ui["mail:mailboxes"])).filter(
    (s) => s.alias && s.mailbox.email === mailbox.email,
  );
  const apart = parseApart(ui["mail:alias-mail-apart"]);
  const key = mailbox.email.toLowerCase();

  const update = (patch: { displayName?: string; color?: string }) =>
    void core
      .invoke("gmail:updateAccount", { accountId: mailbox.id, ...patch })
      .then(() => mailboxes.refreshAccounts())
      .catch(failed("Couldn't save"));

  const run = async (label: string, work: () => Promise<unknown>, title = "Couldn't sign in") => {
    setBusy(label);
    try {
      await work();
    } catch (e) {
      failed(title)(e);
    } finally {
      setBusy(null);
    }
  };

  const signInImap = () => {
    if (!password) return;
    void run("Signing in…", async () => {
      await signInWithPassword(mailbox, password);
      setPassword("");
    });
  };

  const connect = () =>
    void run(
      "Connecting notifications…",
      async () => {
        await connectNotifications(mailbox.id);
        await refreshNotifications();
      },
      "Couldn't connect notifications",
    );

  const failure = !mailbox.signedOut && health?.error ? syncLine(health).text : null;

  return (
    <SettingsForm colors={colors} title={name(mailbox)}>
      {failure ? (
        <Group
          colors={colors}
          footer={<Text>If it keeps failing, signing in again may fix it.</Text>}
        >
          <LabeledContent label="Sync">
            <Text>{failure}</Text>
          </LabeledContent>
          <Button
            label={imap ? "Enter password" : "Sign in again"}
            onPress={() =>
              imap
                ? Alert.prompt(
                    `Password for ${mailbox.email}`,
                    mailbox.imap
                      ? `It stays on this iPhone; your mail goes straight to ${mailbox.imap.imap.host}.`
                      : "",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Sign in",
                        onPress: (entered?: string) =>
                          void run("Signing in…", () => signInWithPassword(mailbox, entered ?? "")),
                      },
                    ],
                    "secure-text",
                  )
                : void run("Signing in…", () => signInAgain(mailbox))
            }
            modifiers={[disabled(busy !== null)]}
          />
        </Group>
      ) : null}

      {!mailbox.signedOut && signedIn && !inDemo && notifications.providers[provider] ? (
        <Group
          colors={colors}
          footer={
            <Text>
              {imap
                ? "Otter securely stores the IMAP password to watch for new mail. The watcher reads new-mail metadata; sender and preview load directly on this iPhone."
                : "Otter needs limited provider permission to confirm new mail before sending an alert. Sender and preview load directly on this iPhone."}
            </Text>
          }
        >
          <LabeledContent label="Background notifications">
            <Text>{notificationStatus(connection?.status)}</Text>
          </LabeledContent>
          {connection ? (
            <Button
              label="Disconnect background notifications"
              onPress={() =>
                void run(
                  "Disconnecting…",
                  async () => {
                    await disconnectNotifications(mailbox.id);
                    await refreshNotifications();
                  },
                  "Couldn't disconnect",
                )
              }
            />
          ) : null}
          {connection?.status !== "ready" ? (
            <ConfirmationDialog
              title="Enable IMAP background notifications?"
              isPresented={confirmImap}
              onIsPresentedChange={setConfirmImap}
              titleVisibility="visible"
            >
              <ConfirmationDialog.Trigger>
                <Button
                  label={busy ?? "Connect notifications"}
                  onPress={() => (imap ? setConfirmImap(true) : connect())}
                  modifiers={[disabled(busy !== null)]}
                />
              </ConfirmationDialog.Trigger>
              <ConfirmationDialog.Actions>
                <Button label="Enable notifications" onPress={connect} />
              </ConfirmationDialog.Actions>
              <ConfirmationDialog.Message>
                <Text>
                  Otter will securely store this mailbox’s password and connect to its IMAP server.
                  The password permits mailbox access; the watcher requests only metadata needed to
                  identify new mail.
                </Text>
              </ConfirmationDialog.Message>
            </ConfirmationDialog>
          ) : null}
        </Group>
      ) : null}

      {mailbox.signedOut && mailbox.imap ? (
        <Group
          colors={colors}
          header={<Text>{`${mailbox.imap.username} on ${mailbox.imap.imap.host}`}</Text>}
          footer={
            <Text>
              {`This iPhone needs the password: the mailbox is new here, the server refused it, or its servers changed. It stays on this iPhone; your mail goes straight between it and ${mailbox.imap.imap.host}.`}
            </Text>
          }
        >
          <SecureField
            placeholder="Password"
            onTextChange={setPassword}
            modifiers={[textContentType("password"), onSubmit(signInImap)]}
          />
          <Button
            label={busy ?? `Sign in to ${mailbox.email}`}
            systemImage="person.crop.circle.badge.checkmark"
            onPress={signInImap}
            modifiers={[disabled(!password || busy !== null)]}
          />
        </Group>
      ) : mailbox.signedOut ? (
        <Group
          colors={colors}
          footer={
            <Text>
              {`Linked to your Otter account, but this iPhone isn't signed in to it yet. Your mail goes straight between the iPhone and ${provider === "outlook" ? "Outlook" : "Gmail"}.`}
            </Text>
          }
        >
          <Button onPress={() => void run("Signing in…", () => signInAgain(mailbox))}>
            <HStack spacing={12}>
              {provider === "outlook" ? (
                <Hosted>
                  <ProviderMark mailbox={mailbox} size={18} color={colors.text} />
                </Hosted>
              ) : null}
              <Text>
                {busy ??
                  (provider === "outlook"
                    ? "Sign in with Microsoft"
                    : `Sign in to ${mailbox.email}`)}
              </Text>
            </HStack>
          </Button>
        </Group>
      ) : null}

      <Group
        colors={colors}
        footer={
          <Text>
            Shown in the sidebar and on its mail, on every device. Only used in Otter Mail.
          </Text>
        }
      >
        <LabeledContent label="Display name">
          <TextField
            placeholder="Name"
            text={displayName}
            modifiers={[
              multilineTextAlignment("trailing"),
              onSubmit(() => {
                const trimmed = displayName.value.trim();
                if (trimmed && trimmed !== name(mailbox)) update({ displayName: trimmed });
              }),
            ]}
          />
        </LabeledContent>
        <ColorPicker
          label="Color"
          selection={mailbox.color ?? colors.accent}
          supportsOpacity={false}
          onSelectionChange={(color) => update({ color })}
        />
      </Group>

      {aliases.length > 0 ? (
        <Group
          colors={colors}
          footer={
            <Text>
              {`Mail for ${listed(aliases.map((a) => a.alias!.name))} also shows in ${name(mailbox)}'s list. Off, ${name(mailbox)} shows only the rest.`}
            </Text>
          }
        >
          <Toggle
            label={`Their mail in ${name(mailbox)} too`}
            isOn={!apart.includes(key)}
            onIsOnChange={(on) =>
              setUiPreference(
                "mail:alias-mail-apart",
                JSON.stringify([...apart.filter((k) => k !== key), ...(on ? [] : [key])]),
              )
            }
            modifiers={[tint(colors.accent)]}
          />
        </Group>
      ) : null}

      {mailbox.signedOut ? null : (
        <Group
          colors={colors}
          title="Signature"
          footer={
            <Text>
              {mailbox.capabilities?.serverSignatures
                ? "Added to new messages, replies and forwards from this mailbox. Saved in Gmail, so it's the same there and on every device."
                : "Added to new messages, replies and forwards from this mailbox. Saved with your Otter account, so it's the same on every device."}
            </Text>
          }
        >
          <SignatureEditor colors={colors} mailbox={mailbox} />
        </Group>
      )}

      <Group colors={colors}>
        <ConfirmationDialog
          title={`Remove ${name(mailbox)}?`}
          isPresented={confirmRemove}
          onIsPresentedChange={setConfirmRemove}
          titleVisibility="visible"
        >
          <ConfirmationDialog.Trigger>
            <Button
              label="Remove mailbox"
              role="destructive"
              onPress={() => setConfirmRemove(true)}
            />
          </ConfirmationDialog.Trigger>
          <ConfirmationDialog.Actions>
            <Button
              label="Remove"
              role="destructive"
              onPress={() => {
                onRemoved();
                void core
                  .invoke("gmail:removeAccount", { accountId: mailbox.id })
                  .then(() => mailboxes.refreshAccounts());
              }}
            />
          </ConfirmationDialog.Actions>
          <ConfirmationDialog.Message>
            <Text>
              {`Removes it from your Otter account on every device and signs this iPhone out of it. Nothing is deleted from ${server(mailbox)}.`}
            </Text>
          </ConfirmationDialog.Message>
        </ConfirmationDialog>
      </Group>
    </SettingsForm>
  );
}
