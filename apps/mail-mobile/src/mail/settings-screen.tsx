import { getAccountDisplayName } from "@otter/client/mail/account-style";
import { useAccounts } from "@otter/client/mail/hooks";
import { useOtterAccount } from "@otter/client/otter-account";
import { SettingsPage, SettingsRow, SettingsSection } from "@otter/ui-native/components/settings";

export function SettingsScreen() {
  const accounts = useAccounts();
  const otter = useOtterAccount();
  return (
    <SettingsPage>
      {otter?.user ? (
        <SettingsSection title="Otter account">
          <SettingsRow
            icon="person.crop.circle"
            title={otter.user.name || otter.user.email}
            value={otter.user.name ? otter.user.email : undefined}
          />
        </SettingsSection>
      ) : null}
      {accounts.data?.length ? (
        <SettingsSection title="Mailboxes">
          {accounts.data.map((account) => (
            <SettingsRow
              key={account.id}
              icon="envelope"
              title={getAccountDisplayName(account)}
              value={account.email}
            />
          ))}
        </SettingsSection>
      ) : null}
    </SettingsPage>
  );
}
