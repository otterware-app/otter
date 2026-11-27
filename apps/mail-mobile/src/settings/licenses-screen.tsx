import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { FlashList } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { openBrowserAsync } from "expo-web-browser";
import { View } from "react-native";

type License = {
  name: string;
  version: string | null;
  license: string;
  noticeText: string;
  sourceUrl: string | null;
};

export function LicensesScreen() {
  const theme = useTheme();
  const { data } = useQuery({
    queryKey: ["mail:licenses"],
    queryFn: () => import("./licenses.json").then(({ default: entries }) => entries as License[]),
    staleTime: Infinity,
  });

  if (!data) return <Spinner />;

  return (
    <FlashList
      data={data}
      keyExtractor={({ name, version }) => `${name}@${version ?? ""}`}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20 }}
      renderItem={({ item, index }) => (
        <View style={{ gap: 8, paddingBottom: index === data.length - 1 ? 0 : 28 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
            <Text size="lg" weight="semibold" style={{ flex: 1 }}>
              {item.name}
            </Text>
            <Text size="sm" color="mutedForeground">
              {item.license}
            </Text>
          </View>
          {item.sourceUrl ? (
            <Text
              size="sm"
              color="primary"
              accessibilityRole="link"
              onPress={() => void openBrowserAsync(item.sourceUrl!)}
            >
              {item.sourceUrl.replace("https://", "")}
            </Text>
          ) : null}
          <Text
            size="xs"
            selectable
            style={{ fontFamily: theme.fonts.mono, color: alpha(theme.colors.foreground, 0.8) }}
          >
            {item.noticeText}
          </Text>
        </View>
      )}
    />
  );
}
