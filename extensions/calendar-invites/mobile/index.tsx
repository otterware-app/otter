import {
  invoke,
  useColors,
  type MessageCardProps,
  type MobileExtension,
} from "@otter-mail/mobile/extension-kit";
import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import {
  CHOICES,
  DONE,
  formatWhen,
  hasInvite,
  type CalendarInvite,
  type RsvpResponse,
} from "../invite";
import { manifest } from "../manifest";

function InviteCard({ accountId, messageId }: { accountId: string; messageId: string }) {
  const colors = useColors();
  const [invite, setInvite] = useState<CalendarInvite | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    void invoke<CalendarInvite | null>("calendar:getInvite", { accountId, messageId }).then(
      (next) => live && setInvite(next),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [accountId, messageId]);

  if (!invite || invite.method === "REPLY") return null;

  const respond = async (response: RsvpResponse) => {
    const previous = invite;
    setInvite({ ...invite, response });
    setSending(true);
    try {
      const next = await invoke<CalendarInvite | null>("calendar:respond", {
        accountId,
        messageId,
        response,
      });
      if (next) setInvite(next);
    } catch (error) {
      setInvite(previous);
      Alert.alert(
        "Couldn't send your answer",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSending(false);
    }
  };

  const when = formatWhen(invite);
  const answered = invite.response !== "needsAction" ? invite.response : null;
  const secondary = { color: colors.secondary };

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]} testID="calendar-invite">
      <Text
        style={[
          styles.title,
          { color: colors.text },
          invite.cancelled && { textDecorationLine: "line-through" },
        ]}
      >
        {invite.summary}
      </Text>
      {when ? <Text style={secondary}>{when}</Text> : null}
      {invite.location ? (
        <Text style={secondary} numberOfLines={1}>
          {invite.location}
        </Text>
      ) : null}
      {invite.organizer ? (
        <Text style={secondary}>Organizer: {invite.organizer.name || invite.organizer.email}</Text>
      ) : null}
      {invite.cancelled ? (
        <Text style={secondary}>This event was cancelled.</Text>
      ) : (
        <>
          <View style={styles.row}>
            <Text style={[secondary, styles.going]}>{answered ? DONE[answered] : "Going?"}</Text>
            {CHOICES.map((choice) => {
              const active = invite.response === choice.value;
              return (
                <Pressable
                  key={choice.value}
                  disabled={sending || active}
                  onPress={() => void respond(choice.value)}
                  style={[
                    styles.choice,
                    { backgroundColor: active ? colors.accent : colors.background },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={{ color: active ? "#FFFFFF" : colors.text, fontWeight: "600" }}>
                    {choice.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!invite.calendarAccess ? (
            <Text style={[secondary, styles.note]}>Answers are emailed to the organizer.</Text>
          ) : null}
        </>
      )}
      {invite.htmlLink ? (
        <Pressable onPress={() => void Linking.openURL(invite.htmlLink!)} hitSlop={6}>
          <Text style={{ color: colors.accent }}>Open in Google Calendar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function InvitationCard({ accountId, summary, detail }: MessageCardProps) {
  return hasInvite({ attachments: detail.attachments ?? [] }) ? (
    <InviteCard accountId={accountId} messageId={summary.id} />
  ) : null;
}

export default {
  manifest,
  messageCards: [InvitationCard],
} satisfies MobileExtension;

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 18, gap: 4 },
  title: { fontSize: 17, fontWeight: "600", marginBottom: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  going: { flex: 1 },
  choice: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 },
  note: { fontSize: 12, marginTop: 4 },
});
