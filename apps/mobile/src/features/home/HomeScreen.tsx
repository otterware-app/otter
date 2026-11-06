import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useLayoutEffect, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";

import type { RootStack } from "../../App";
import { appAtomRegistry, mailboxes, operations, threadLists } from "../../state/client";
import { useAccountSync } from "../../state/sync";
import { usePalette } from "../theme";
import { PlacesBar } from "./PlacesBar";
import { PlacesPanel } from "./PlacesPanel";
import { placeAtom, placeTitle, rememberPlace, type Place } from "./places";
import { ThreadList } from "./ThreadList";
import { UndoToast } from "./UndoToast";

type Props = NativeStackScreenProps<RootStack, "Home">;

/** apps/ios's HomeView: a place's list, the places bar over it, and the places panel out of the bar. */
export function HomeScreen({ navigation }: Props) {
  const colors = usePalette();
  const accounts = useAtomValue(mailboxes.accountsAtom);
  const place = useAtomValue(placeAtom);
  const setPlace = useAtomSet(placeAtom);
  const accountId =
    (accounts.value.some((m) => m.id === place.accountId) ? place.accountId : null) ??
    accounts.value[0]?.id ??
    null;
  const mailbox = accounts.value.find((m) => m.id === accountId);
  const labels = useAtomValue(mailboxes.labelsAtom(accountId ?? "")).value;
  const title = placeTitle(place.labelId, labels);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    for (const m of accounts.value) void mailboxes.refreshLabels(m.id);
  }, [accounts.value]);
  useAccountSync(accountId);

  const go = (next: Place) => {
    setPlace(next);
    rememberPlace(next);
    setMenuOpen(false);
  };

  const markAllRead = () => {
    if (!accountId) return;
    const view = appAtomRegistry.get(threadLists.listAtom({ accountId, labelId: place.labelId }));
    for (const row of view.pages.flatMap((p) => p.messages)) {
      if (row.threadUnread ?? row.unread) {
        void operations
          .modifyThread(
            { accountId, threadId: row.threadId, removeLabelIds: ["UNREAD"] },
            { quiet: true },
          )
          .catch(() => {});
      }
    }
    AccessibilityInfo.announceForAccessibility("Marked all as read");
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerTitle: "",
      unstable_headerLeftItems: () => [
        {
          type: "custom",
          hidesSharedBackground: true,
          element: (
            <HomeTitle
              title={title}
              mailbox={mailbox?.displayName ?? mailbox?.name ?? ""}
              onPress={() => setMenuOpen(true)}
            />
          ),
        },
      ],
      unstable_headerRightItems: () =>
        accountId
          ? [
              {
                type: "button",
                label: "Compose",
                icon: { type: "sfSymbol", name: "square.and.pencil" },
                accessibilityLabel: "New message",
                onPress: () => navigation.navigate("Compose", { accountId }),
              },
              {
                type: "menu",
                label: "More",
                icon: { type: "sfSymbol", name: "ellipsis" },
                accessibilityLabel: "More",
                menu: {
                  items: [
                    {
                      type: "action",
                      label: "Mark all as read",
                      icon: { type: "sfSymbol", name: "envelope.open" },
                      onPress: markAllRead,
                    },
                    {
                      type: "action",
                      label: "Settings",
                      icon: { type: "sfSymbol", name: "gearshape" },
                      onPress: () => navigation.navigate("Settings"),
                    },
                  ],
                },
              },
            ]
          : [],
    });
  });

  useEffect(() => {
    if (!accounts.loading && accounts.value.length === 0 && !accounts.error) {
      navigation.navigate("Welcome");
    }
  }, [accounts, navigation]);

  const inboxUnread = (id: string) =>
    appAtomRegistry.get(mailboxes.labelsAtom(id)).value.find((l) => l.id === "INBOX")?.unread ?? 0;

  return (
    <View style={[styles.fill, { backgroundColor: colors.canvas }]}>
      {accountId ? (
        <ThreadList
          key={`${accountId}:${place.labelId}`}
          mailbox={mailbox}
          accountId={accountId}
          labelId={place.labelId}
          onOpen={(row) =>
            navigation.navigate("Thread", {
              accountId,
              threadId: row.threadId,
              subject: row.subject || "(no subject)",
              labelId: place.labelId,
            })
          }
        />
      ) : (
        <Text style={[styles.message, { color: colors.secondary }]}>
          {accounts.error ?? "Starting…"}
        </Text>
      )}
      {menuOpen ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setMenuOpen(false)}
          accessibilityLabel="Close places"
          accessibilityRole="button"
        />
      ) : (
        <UndoToast />
      )}
      <PlacesBar
        mailboxes={accounts.value}
        current={mailbox}
        labelId={place.labelId}
        inboxDot={(labels.find((l) => l.id === "INBOX")?.unread ?? 0) > 0}
        unread={inboxUnread}
        panel={
          menuOpen && accountId ? (
            <PlacesPanel
              mailbox={mailbox}
              labels={labels}
              labelId={place.labelId}
              onPlace={(labelId) => go({ accountId, labelId })}
              onSearch={() => {
                setMenuOpen(false);
                navigation.navigate("Search", { accountId });
              }}
              onSettings={() => {
                setMenuOpen(false);
                navigation.navigate("Settings");
              }}
            />
          ) : null
        }
        onMailbox={(id) =>
          go({
            accountId: id,
            labelId:
              place.labelId === "INBOX" || place.labelId === "DRAFT" ? place.labelId : "INBOX",
          })
        }
        onAddMailbox={() => navigation.navigate("Welcome")}
        onPlace={(labelId) => go({ accountId, labelId })}
        onSearch={() => accountId && navigation.navigate("Search", { accountId })}
        onMenu={() => setMenuOpen((open) => !open)}
        onAgent={() => navigation.navigate("Chat")}
      />
    </View>
  );
}

/** apps/ios's Header: the place, then the mailbox, muted; it opens every place. */
function HomeTitle({
  title,
  mailbox,
  onPress,
}: {
  title: string;
  mailbox: string;
  onPress: () => void;
}) {
  const colors = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${mailbox}`}
      accessibilityHint="Shows every folder and label"
      testID="home-title"
    >
      <Text style={styles.header} numberOfLines={1}>
        <Text style={{ color: colors.text, fontWeight: "600" }}>{title}</Text>
        <Text style={{ color: colors.secondary }}>
          {"  "}
          {mailbox}
        </Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { fontSize: 20, paddingHorizontal: 8, maxWidth: 260 },
  message: { padding: 24, paddingTop: 160, fontSize: 15 },
});
