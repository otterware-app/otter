import { Button, List, Text, Toolbar, ToolbarItem } from "@expo/ui/swift-ui";
import { environment, foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import { useEffect, useState } from "react";
import { Settings } from "react-native";

import { core } from "../../state/core";
import type { Palette } from "../theme";
import { effectiveReadLanguages, LANGUAGES, languageName } from "./languages";
import { Group, SettingsForm } from "./SettingsScreen";

type TranslationSettings = { readLanguages: string[]; autoTranslate: boolean };

const systemLanguages = (): string[] => {
  const value: unknown = Settings.get("AppleLanguages");
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
};

/** The translation extension's settings (`translation:*`), synced with the Otter account. */
export function useTranslationSettings(): [
  { readLanguages: string[]; autoTranslate: boolean },
  (patch: Partial<TranslationSettings>) => void,
] {
  const [saved, setSaved] = useState<TranslationSettings>({
    readLanguages: [],
    autoTranslate: false,
  });
  useEffect(() => {
    void core.invoke<TranslationSettings>("translation:getSettings").then(setSaved, () => {});
    return core.on("translation:settingsChanged", (s) => setSaved(s as TranslationSettings));
  }, []);
  const set = (patch: Partial<TranslationSettings>) => {
    setSaved((s) => ({ ...s, ...patch }));
    void core
      .invoke<TranslationSettings>("translation:setSettings", patch)
      .then(setSaved, () => {});
  };
  return [
    {
      readLanguages: effectiveReadLanguages(saved.readLanguages, systemLanguages()),
      autoTranslate: saved.autoTranslate,
    },
    set,
  ];
}

/** The Swift app's LanguagesSettings: the languages mail isn't translated from (the first is where translations go), reordered, deleted, added. */
export function LanguagesSettings({ colors }: { colors: Palette }) {
  const [{ readLanguages: read }, set] = useTranslationSettings();
  const [editing, setEditing] = useState(false);

  return (
    <Toolbar>
      <SettingsForm colors={colors} title="Languages I read">
        <Group
          colors={colors}
          footer={
            <Text>
              Mail in these isn't translated. The first is the language translations go into.
            </Text>
          }
        >
          <List.ForEach
            data={read}
            keyExtractor={(code) => code}
            recycling={false}
            onMove={([from], to) => {
              const next = [...read];
              const [moved] = next.splice(from!, 1);
              next.splice(to > from! ? to - 1 : to, 0, moved!);
              set({ readLanguages: next });
            }}
            onDelete={(indices) => {
              const next = read.filter((_, i) => !indices.includes(i));
              if (next.length > 0) set({ readLanguages: next });
            }}
            modifiers={[environment("editMode", editing ? "active" : "inactive")]}
          >
            {({ item }) => <Text>{languageName(item)}</Text>}
          </List.ForEach>
        </Group>
        <Group colors={colors} title="Add">
          {Object.keys(LANGUAGES)
            .filter((code) => !read.includes(code))
            .map((code) => (
              <Button
                key={code}
                onPress={() => set({ readLanguages: [...read, code] })}
                modifiers={[foregroundStyle(colors.text)]}
              >
                <Text>{languageName(code)}</Text>
              </Button>
            ))}
        </Group>
      </SettingsForm>
      <Toolbar.Content>
        <ToolbarItem placement="primaryAction">
          <Button label={editing ? "Done" : "Edit"} onPress={() => setEditing(!editing)} />
        </ToolbarItem>
      </Toolbar.Content>
    </Toolbar>
  );
}
