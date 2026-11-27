import { mailApi } from "@otter/client/mail/api";
import type { MailAccount } from "@otter/client/mail/types";
import { useOtterAccount } from "@otter/client/otter-account";
import { SettingsButton, SettingsSection } from "@otter/ui-native/components/settings";
import { useMutation } from "@tanstack/react-query";
import { openAuthSessionAsync } from "expo-web-browser";
import { Alert } from "react-native";

import { mailFailure } from "../mail/mail-actions.tsx";
import { useNotificationConnections } from "./use-mail-notifications.ts";

const setupStatus = {
  ready: "Connected. Alerts are sent only for verified new mail.",
  retry: "Connection interrupted. Otter is retrying.",
  reauthorize: "Authorization expired. Reconnect to resume alerts.",
  connecting: "Checking the connection…",
};

export function MailboxNotifications({ account }: { account: MailAccount }) {
  const user = useOtterAccount()?.user;
  const connections = useNotificationConnections(user?.id);
  const provider = account.provider ?? "gmail";
  const status = connections.data?.connections.find(
    (item) => item.email.toLowerCase() === account.email.toLowerCase(),
  )?.status;
  const change = useMutation({
    async mutationFn(connect: boolean) {
      if (!connect) return mailApi.disconnectNotifications(account.id);
      const response = await mailApi.connectNotifications(account.id);
      if (!("url" in response)) return;
      const authorization = await openAuthSessionAsync(
        response.url,
        "ottermail-notifications://complete",
      );
      if (authorization.type !== "success") return;
      if (new URL(authorization.url).searchParams.get("result") !== "success") {
        throw new Error(
          "Notification setup didn’t finish. Choose this mailbox and approve the limited access.",
        );
      }
    },
    onSettled: () => void connections.refetch(),
    onError: mailFailure,
  });
  if (!user || account.signedOut || !connections.data?.providers[provider]) return null;

  function connect() {
    if (provider !== "imap") {
      change.mutate(true);
      return;
    }
    Alert.alert(
      "Connect background notifications?",
      "The Otter relay keeps this mailbox’s IMAP password encrypted so it can check for new mail while the app is closed.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Connect", onPress: () => change.mutate(true) },
      ],
    );
  }

  const connected = status === "ready" || status === "retry";
  return (
    <SettingsSection
      title="Background notifications"
      headline
      footer={
        status
          ? setupStatus[status]
          : "Receive verified new-mail alerts while the app is closed. Sender and preview load on this iPhone."
      }
    >
      <SettingsButton
        title={connected ? "Disconnect" : status === "reauthorize" ? "Reconnect" : "Connect"}
        disabled={change.isPending || status === "connecting"}
        onPress={() => (connected ? change.mutate(false) : connect())}
      />
    </SettingsSection>
  );
}
