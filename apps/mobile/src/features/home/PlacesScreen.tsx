import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SymbolView } from "expo-symbols";
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";

import type { RootStack } from "../../App";
import { mailboxes } from "../../state/client";
import { palette } from "../theme";
import { orderedPlaces, placeAtom, placeSymbol, placeTitle, rememberPlace } from "./places";

type Props = NativeStackScreenProps<RootStack, "Places">;

/** apps/ios's PlacesPanel: every place of the mailbox, then Search and Settings. */
export function PlacesScreen({ navigation, route }: Props) {
  const colors = palette(useColorScheme());
  const { accountId } = route.params;
  const labels = useAtomValue(mailboxes.labelsAtom(accountId)).value;
  const place = useAtomValue(placeAtom);
  const setPlace = useAtomSet(placeAtom);

  const item = (
    key: string,
    symbol: Parameters<typeof SymbolView>[0]["name"],
    title: string,
    onPress: () => void,
    selected = false,
    count?: number,
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      style={({ pressed }) => [
        styles.item,
        (pressed || selected) && { backgroundColor: colors.card },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={`place-${key}`}
    >
      <SymbolView name={symbol} size={20} tintColor={colors.text} />
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
        {title}
      </Text>
      {count ? <Text style={{ color: colors.secondary }}>{count}</Text> : null}
    </Pressable>
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      {orderedPlaces(labels).map((label) =>
        item(
          label.id,
          placeSymbol(label.id),
          placeTitle(label.id, labels),
          () => {
            const next = { accountId, labelId: label.id };
            setPlace(next);
            rememberPlace(next);
            navigation.goBack();
          },
          place.labelId === label.id && place.accountId === accountId,
          label.id === "INBOX" || label.type === "user" ? label.unread : undefined,
        ),
      )}
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      {item("search", "magnifyingglass", "Search", () =>
        navigation.replace("Search", { accountId }),
      )}
      {item("settings", "gearshape", "Settings", () => navigation.replace("Settings"))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12, paddingBottom: 40 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 14,
  },
  title: { flex: 1, fontSize: 16 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8, marginHorizontal: 12 },
});
