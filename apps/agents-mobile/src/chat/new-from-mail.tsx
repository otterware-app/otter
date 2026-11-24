import { useAgentProviders } from "@otter/client/agents/agent-providers";
import { mailLinkContext } from "@otter/client/agents/chat-context";
import { attachMail } from "@otter/client/agents/chat-mail";
import { newChat } from "@otter/client/agents/chat-store";
import { Spinner } from "@otter/ui-native/components/spinner";
import { useTheme } from "@otter/ui-native/theme";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

/**
 * Otter Mail's Send to agent: `<bundle id>://new?mail=<json>` (apps/ios's MailContext.swift)
 * opens a new chat with the mail attached to its composer, in this screen's place.
 */
export function NewFromMail() {
  const theme = useTheme();
  const { mail } = useLocalSearchParams<{ mail?: string | string[] }>();
  const selected = useAgentProviders().data?.selected;
  const ready = selected !== undefined;

  useEffect(() => {
    if (!ready) return;
    if (!selected) return router.replace("/settings/agents/new");
    const pointers = new URLSearchParams([mail ?? []].flat().map((json) => ["mail", json]));
    const attached = mailLinkContext(`otter://new?${pointers}`);
    const id = newChat(selected);
    if (attached) attachMail(id, attached);
    router.replace({ pathname: "/agents/[id]", params: { id } });
  }, [ready, selected, mail]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.canvas,
      }}
    >
      <Spinner />
    </View>
  );
}
