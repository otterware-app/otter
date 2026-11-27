import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Redirect } from "expo-router";
import { View } from "react-native";

import { WelcomeScreen } from "../account/welcome-screen.tsx";
import { useMailboxes } from "../mail/mailboxes.ts";

export default function Start() {
  const accounts = useMailboxes();
  const first = accounts.mailboxes.find(({ enabled }) => enabled);
  if (first) {
    return (
      <Redirect
        href={{
          pathname: "/mail/[account]/[label]",
          params: { account: first.look.id, label: "INBOX" },
        }}
      />
    );
  }
  if (accounts.mailboxes.length > 0) return <Redirect href="/settings/mailboxes" />;
  if (!accounts.isPending && !accounts.isError) return <WelcomeScreen />;
  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
      {accounts.isPending ? (
        <Spinner />
      ) : (
        <EmptyState
          icon="envelope"
          title="Couldn't load mailboxes"
          description={accounts.error?.message}
        />
      )}
    </View>
  );
}
