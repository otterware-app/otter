import { getAccountDisplayName } from "@otter/client/mail/account-style";
import { mailApi } from "@otter/client/mail/api";
import {
  useAccounts,
  useAddAccount,
  useMailProviders,
  useRemoveAccount,
  useSignInImap,
} from "@otter/client/mail/hooks";
import type { MailAccount } from "@otter/client/mail/types";
import { SettingsField } from "@otter/ui-native/components/settings-field";
import { SettingsButton, SettingsRow, SettingsSection } from "@otter/ui-native/components/settings";
import { useState } from "react";
import { Alert } from "react-native";

import { GmailMark, MicrosoftMark, ProviderMark } from "../settings/provider-mark.tsx";
import { ImapForm } from "./imap-form.tsx";

function showError(title: string, error: unknown) {
  Alert.alert(title, error instanceof Error ? error.message : String(error));
}

export function MailboxSettingsSection() {
  const { data: accounts } = useAccounts();
  const { data: providers } = useMailProviders();
  const gmail = useAddAccount();
  const outlook = useAddAccount("outlook");
  const reconnect = useSignInImap();
  const remove = useRemoveAccount();
  const [addingImap, setAddingImap] = useState(false);
  const [imapAccount, setImapAccount] = useState<MailAccount | null>(null);
  const [password, setPassword] = useState("");
  const busy = gmail.isPending || outlook.isPending || reconnect.isPending;

  const oauth = (provider: "gmail" | "outlook", email?: string) => {
    const signIn = provider === "gmail" ? gmail : outlook;
    signIn.mutate(email, { onError: (error) => showError("Couldn't sign in", error) });
  };

  const select = (account: MailAccount) => {
    Alert.alert(getAccountDisplayName(account), account.email, [
      ...(account.signedOut
        ? [
            {
              text: "Sign in again",
              onPress: () => {
                if (account.provider === "imap") {
                  setPassword("");
                  setImapAccount(account);
                } else {
                  oauth(account.provider ?? "gmail", account.email);
                }
              },
            },
          ]
        : []),
      {
        text: "Remove mailbox",
        style: "destructive",
        onPress: () =>
          Alert.alert("Remove mailbox?", account.email, [
            { text: "Cancel", style: "cancel" },
            {
              text: "Remove",
              style: "destructive",
              onPress: () =>
                remove.mutate(account.id, {
                  onError: (error) => showError("Couldn't remove mailbox", error),
                }),
            },
          ]),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  if (addingImap) return <ImapForm onDone={() => setAddingImap(false)} />;

  if (imapAccount) {
    const close = () => {
      setPassword("");
      setImapAccount(null);
    };
    return (
      <SettingsSection title={`Sign in to ${imapAccount.email}`} headline>
        <SettingsField placeholder="Password" value={password} onChangeText={setPassword} secret />
        <SettingsButton
          title={reconnect.isPending ? "Checking…" : "Sign in"}
          disabled={!password || reconnect.isPending}
          onPress={() =>
            reconnect.mutate(
              { accountId: imapAccount.id, password },
              {
                onSuccess: close,
                onSettled: () => reconnect.reset(),
                onError: (error) => showError("Couldn't sign in", error),
              },
            )
          }
        />
        <SettingsButton title="Cancel" disabled={reconnect.isPending} onPress={close} />
      </SettingsSection>
    );
  }

  return (
    <>
      {accounts?.length ? (
        <SettingsSection title="Mailboxes" headline>
          {accounts.map((account) => (
            <SettingsRow
              key={account.id}
              icon={<ProviderMark account={account} />}
              title={getAccountDisplayName(account)}
              value={account.signedOut ? "Sign in again" : account.email}
              chevron={false}
              onPress={busy ? undefined : () => select(account)}
            />
          ))}
        </SettingsSection>
      ) : null}
      <SettingsSection title="Add mailbox" headline>
        <SettingsRow
          icon={<GmailMark />}
          title="Gmail"
          chevron={false}
          onPress={busy ? undefined : () => oauth("gmail")}
        />
        {providers?.outlook ? (
          <SettingsRow
            icon={<MicrosoftMark />}
            title="Outlook"
            chevron={false}
            onPress={busy ? undefined : () => oauth("outlook")}
          />
        ) : null}
        <SettingsRow
          icon="envelope.badge"
          title="IMAP"
          onPress={busy ? undefined : () => setAddingImap(true)}
        />
        {busy ? (
          <SettingsButton title="Cancel sign-in" onPress={() => void mailApi.cancelAddAccount()} />
        ) : null}
      </SettingsSection>
    </>
  );
}
