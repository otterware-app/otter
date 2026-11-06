import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { LegendList } from "@legendapp/list/react-native";
import type { MessageSummary } from "@otter-mail/client-runtime/mail";
import { archiveFrom } from "@otter-mail/client-runtime/operations";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useLayoutEffect, useMemo } from "react";
import { ActionSheetIOS, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import { SymbolView } from "expo-symbols";

import type { RootStack } from "../../App";
import { mailboxes, operations, threadLists, type Mailbox } from "../../state/client";
import { markFirstContent } from "../../state/startup";
import { useAccountSync } from "../../state/sync";
import { palette } from "../theme";
import { PlacesBar } from "./PlacesBar";
import { placeAtom, placeTitle, rememberPlace, type Place } from "./places";
import { SwipeRow } from "./SwipeRow";
import { ThreadRow } from "./ThreadRow";
import { UndoToast } from "./UndoToast";

type Props = NativeStackScreenProps<RootStack, "Home">;

export function HomeScreen({ navigation }: Props) {
  const colors = palette(useColorScheme());
  const accounts = useAtomValue(mailboxes.accountsAtom);
  const place = useAtomValue(placeAtom);
  const setPlace = useAtomSet(placeAtom);
  const accountId = place.accountId ?? accounts.value[0]?.id ?? null;
  const mailbox = accounts.value.find((m) => m.id === accountId);
  const labels = useAtomValue(mailboxes.labelsAtom(accountId ?? "")).value;
  const title = placeTitle(place.labelId, labels);

  useEffect(() => {
    if (accountId) void mailboxes.refreshLabels(accountId);
  }, [accountId]);
  useAccountSync(accountId);

  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerRight: () =>
        accountId ? (
          <ComposeButton onPress={() => navigation.navigate("Compose", { accountId })} />
        ) : null,
    });
  }, [navigation, title, accountId]);

  const go = (next: Place) => {
    setPlace(next);
    rememberPlace(next);
  };

  useEffect(() => {
    if (!accounts.loading && accounts.value.length === 0 && !accounts.error) {
      navigation.navigate("Welcome");
    }
  }, [accounts, navigation]);

  const inboxUnread = labels.find((l) => l.id === "INBOX")?.unread ?? 0;

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
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
      <UndoToast />
      <PlacesBar
        mailboxes={accounts.value}
        current={mailbox}
        labelId={place.labelId}
        inboxDot={inboxUnread > 0}
        onMailbox={(id) => go({ accountId: id, labelId: "INBOX" })}
        onAddMailbox={() => navigation.navigate("Welcome")}
        onPlace={(labelId) => go({ accountId, labelId })}
        onSearch={() => accountId && navigation.navigate("Search", { accountId })}
        onMenu={() => accountId && navigation.navigate("Places", { accountId })}
        onAgent={() => navigation.navigate("Chat")}
      />
    </View>
  );
}

export function ComposeButton({ onPress }: { onPress: () => void }) {
  const colors = palette(useColorScheme());
  return (
    <Pressable onPress={onPress} hitSlop={12} accessibilityLabel="New message" testID="compose">
      <SymbolView name="square.and.pencil" size={22} tintColor={colors.text} />
    </Pressable>
  );
}

function ThreadList({
  mailbox,
  accountId,
  labelId,
  onOpen,
}: {
  mailbox: Mailbox | undefined;
  accountId: string;
  labelId: string;
  onOpen: (row: MessageSummary) => void;
}) {
  const colors = palette(useColorScheme());
  const key = useMemo(() => ({ accountId, labelId }), [accountId, labelId]);
  const view = useAtomValue(threadLists.listAtom(key));
  const labels = useAtomValue(mailboxes.labelsAtom(accountId)).value;
  const rows = useMemo(() => view.pages.flatMap((page) => page.messages), [view.pages]);

  useEffect(() => threadLists.show(key), [key]);
  useEffect(() => {
    if (rows.length > 0) markFirstContent(rows.length);
  }, [rows.length]);

  const capabilities = mailbox?.capabilities;
  const archive = (row: MessageSummary) => {
    const from = capabilities
      ? archiveFrom(
          row.threadLabelIds ?? row.labelIds,
          labels.find((l) => l.id === labelId),
          capabilities,
        )
      : "INBOX";
    if (from) void operations.archiveThread(accountId, row.threadId, from).catch(() => {});
  };
  const trash = (row: MessageSummary) =>
    void operations.trashThread(accountId, row.threadId).catch(() => {});
  // Gmail's untrash leaves the conversation in no folder, so it's put back in Inbox too.
  const untrash = (row: MessageSummary) =>
    void operations
      .untrashThread(accountId, row.threadId)
      .then(() =>
        mailbox?.provider === "gmail"
          ? operations.modifyThread(
              { accountId, threadId: row.threadId, addLabelIds: ["INBOX"] },
              { quiet: true },
            )
          : undefined,
      )
      .catch(() => {});
  const toggleRead = (row: MessageSummary) => {
    const unread = row.threadUnread ?? row.unread;
    void operations
      .modifyThread(
        unread
          ? { accountId, threadId: row.threadId, removeLabelIds: ["UNREAD"] }
          : { accountId, threadId: row.threadId, addLabelIds: ["UNREAD"] },
      )
      .catch(() => {});
  };
  const toggleStar = (row: MessageSummary) => {
    const starred = row.threadStarred ?? row.starred;
    void operations
      .modifyThread(
        starred
          ? { accountId, threadId: row.threadId, removeLabelIds: ["STARRED"] }
          : { accountId, threadId: row.threadId, addLabelIds: ["STARRED"] },
      )
      .catch(() => {});
  };
  const userLabels = labels.filter((l) => l.type === "user");
  const moreActions = (row: MessageSummary) => {
    const unread = row.threadUnread ?? row.unread;
    const starred = row.threadStarred ?? row.starred;
    const options = [
      unread ? "Mark as Read" : "Mark as Unread",
      starred ? "Unstar" : "Star",
      ...(userLabels.length > 0 ? ["Label…"] : []),
      ...(labelId === "TRASH" ? ["Move to Inbox"] : ["Archive", "Move to Trash"]),
      "Cancel",
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        destructiveButtonIndex: labelId === "TRASH" ? undefined : options.length - 2,
        cancelButtonIndex: options.length - 1,
      },
      (index) => {
        const choice = options[index];
        if (choice === "Mark as Read" || choice === "Mark as Unread") toggleRead(row);
        else if (choice === "Star" || choice === "Unstar") toggleStar(row);
        else if (choice === "Archive") archive(row);
        else if (choice === "Move to Trash") trash(row);
        else if (choice === "Move to Inbox") untrash(row);
        else if (choice === "Label…") {
          const names = [...userLabels.map((l) => l.name), "Cancel"];
          ActionSheetIOS.showActionSheetWithOptions(
            { title: "Label", options: names, cancelButtonIndex: names.length - 1 },
            (i) => {
              const label = userLabels[i];
              if (label) {
                void operations
                  .modifyThread({ accountId, threadId: row.threadId, addLabelIds: [label.id] })
                  .catch(() => {});
              }
            },
          );
        }
      },
    );
  };

  if (view.error && rows.length === 0) {
    return <Text style={[styles.message, { color: colors.secondary }]}>{view.error}</Text>;
  }
  return (
    <LegendList
      data={rows}
      keyExtractor={(row) => row.threadId}
      renderItem={({ item }) => (
        <SwipeRow
          leading={
            labelId === "TRASH"
              ? {
                  title: "Inbox",
                  symbol: "tray.and.arrow.up.fill",
                  tint: colors.archive,
                  perform: () => untrash(item),
                }
              : {
                  title: "Archive",
                  symbol: "archivebox.fill",
                  tint: colors.archive,
                  perform: () => archive(item),
                }
          }
          trailing={{
            title: "Trash",
            symbol: "trash.fill",
            tint: colors.trash,
            perform: () => trash(item),
          }}
        >
          <ThreadRow row={item} onOpen={onOpen} onLongPress={moreActions} />
        </SwipeRow>
      )}
      estimatedItemSize={80}
      recycleItems
      onEndReached={() => void threadLists.fetchNextPage(key)}
      onEndReachedThreshold={0.5}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 120 }}
      ListEmptyComponent={
        view.isLoading ? null : (
          <Text style={[styles.empty, { color: colors.secondary }]}>Nothing here.</Text>
        )
      }
      testID="thread-list"
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  message: { padding: 24, paddingTop: 160, fontSize: 15 },
  empty: { textAlign: "center", paddingTop: 80, fontSize: 15 },
});
