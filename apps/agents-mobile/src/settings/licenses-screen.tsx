import { Icon } from "@otter/ui-native/components/icon";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { FlashList } from "@shopify/flash-list";
import { Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

type License = {
  name: string;
  version: string | null;
  license: string;
  noticeText: string;
  sourceUrl: string | null;
};

/** The generated list (`pnpm licenses:mobile:agents`), 1 MB: read when the page opens, not at start. */
const loadLicenses = () => import("./licenses.json").then((module) => module.default as License[]);

/** What the app is built on, with its licenses (Licenses.swift): a row each, its notice under it when opened. */
export function LicensesScreen() {
  const theme = useTheme();
  const [licenses, setLicenses] = useState<License[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    void loadLicenses().then(setLicenses);
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: "Open-source licenses" }} />
      {licenses ? (
        <FlashList
          data={licenses}
          extraData={open}
          keyExtractor={(license) => `${license.name}@${license.version ?? ""}`}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12 }}
          renderItem={({ item }) => {
            const key = `${item.name}@${item.version ?? ""}`;
            const shown = open === key;
            return (
              <View style={{ paddingVertical: 12, gap: 8 }}>
                <Pressable
                  onPress={() => setOpen(shown ? null : key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${item.license}`}
                  accessibilityState={{ expanded: shown }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "baseline",
                    gap: 8,
                    opacity: pressed ? 0.5 : 1,
                  })}
                >
                  <Text
                    size="lg"
                    weight="semibold"
                    numberOfLines={shown ? undefined : 1}
                    style={{ flex: 1 }}
                  >
                    {item.name}
                  </Text>
                  <Text size="body" color="mutedForeground">
                    {item.license}
                  </Text>
                  <Icon
                    name={shown ? "chevron.up" : "chevron.down"}
                    size={11}
                    weight="semibold"
                    color="faintForeground"
                  />
                </Pressable>
                {shown ? (
                  <>
                    {item.sourceUrl ? (
                      <Text
                        size="body"
                        color="primary"
                        accessibilityRole="link"
                        onPress={() => void WebBrowser.openBrowserAsync(item.sourceUrl!)}
                      >
                        {item.sourceUrl.replace("https://", "")}
                      </Text>
                    ) : null}
                    <Text
                      size="xs"
                      selectable
                      style={{
                        fontFamily: theme.fonts.mono,
                        color: alpha(theme.colors.foreground, 0.8),
                      }}
                    >
                      {item.noticeText}
                    </Text>
                  </>
                ) : null}
              </View>
            );
          }}
        />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Spinner />
        </View>
      )}
    </>
  );
}
