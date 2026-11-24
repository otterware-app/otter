import { getAccountDisplayName } from "@otter/client/mail/account-style";
import { SettingsPage, SettingsRow, SettingsSection } from "@otter/ui-native/components/settings";
import { useRouter } from "expo-router";

import { MailboxAvatar } from "../frame/mail-places.tsx";
import { useMailboxes } from "../mail/mailboxes.ts";

export function MailboxesScreen() {
  const { mailboxes } = useMailboxes();
  const router = useRouter();
  const first = mailboxes.find(({ enabled }) => enabled);
  return (
    <SettingsPage>
      <SettingsSection>
        {!router.canGoBack() && first ? (
          <SettingsRow
            title="Open Inbox"
            icon="tray"
            onPress={() =>
              router.replace({
                pathname: "/mail/[account]/[label]",
                params: { account: first.look.id, label: "INBOX" },
              })
            }
          />
        ) : null}
        {mailboxes.map(({ look, enabled, account }) => (
          <SettingsRow
            key={look.id}
            icon={<MailboxAvatar mailbox={look} />}
            title={getAccountDisplayName(look)}
            value={account.signedOut ? "Signed out" : enabled ? undefined : "Off"}
            onPress={() =>
              router.push({ pathname: "/settings/mailbox", params: { account: look.id } })
            }
          />
        ))}
        <SettingsRow
          icon="plus"
          title="Manage connections"
          onPress={() => router.push("/settings/account")}
        />
      </SettingsSection>
    </SettingsPage>
  );
}
