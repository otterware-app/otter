import { useAccounts } from "@otter/client/mail/hooks";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Redirect } from "expo-router";
import { View } from "react-native";

export default function Start() {
  const accounts = useAccounts();
  const first = accounts.data?.[0];
  if (first) {
    return (
      <Redirect
        href={{
          pathname: "/mail/[account]/[label]",
          params: { account: first.id, label: "INBOX" },
        }}
      />
    );
  }
  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
      {accounts.isPending ? (
        <Spinner />
      ) : (
        <EmptyState
          icon="envelope"
          title={accounts.isError ? "Couldn't load mailboxes" : "Otter Mail"}
          description={accounts.isError ? accounts.error.message : "No mailboxes on this iPhone."}
        />
      )}
    </View>
  );
}
