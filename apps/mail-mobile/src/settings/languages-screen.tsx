import { Icon } from "@otter/ui-native/components/icon";
import { SettingsPage, SettingsRow, SettingsSection } from "@otter/ui-native/components/settings";
import { ActionSheetIOS } from "react-native";

import {
  effectiveLanguages,
  languageName,
  languages,
  useTranslationSettings,
  useUpdateTranslationSettings,
} from "../mail/translation.ts";

export function LanguagesScreen() {
  const settings = useTranslationSettings();
  const update = useUpdateTranslationSettings();
  const read = effectiveLanguages(settings.data);
  const setLanguages = (readLanguages: string[]) => update.mutate({ readLanguages });

  function edit(code: string) {
    const others = read.filter((language) => language !== code);
    const actions: { title: string; run: () => void }[] = [];
    if (read[0] !== code)
      actions.push({
        title: "Use for translations",
        run: () => setLanguages([code, ...others]),
      });
    if (others.length) actions.push({ title: "Remove", run: () => setLanguages(others) });
    if (!actions.length) return;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: languageName(code),
        options: [...actions.map(({ title }) => title), "Cancel"],
        cancelButtonIndex: actions.length,
      },
      (index) => actions[index]?.run(),
    );
  }

  return (
    <SettingsPage>
      <SettingsSection footer="Mail in these isn't translated. The first is the language translations go into.">
        {read.map((code) => (
          <SettingsRow
            key={code}
            title={languageName(code)}
            chevron={read.length > 1}
            onPress={read.length > 1 && !update.isPending ? () => edit(code) : undefined}
          />
        ))}
      </SettingsSection>
      <SettingsSection>
        {Object.keys(languages)
          .filter((code) => !read.includes(code))
          .map((code) => (
            <SettingsRow
              key={code}
              title={languageName(code)}
              accessory={<Icon name="plus" color="mutedForeground" />}
              onPress={update.isPending ? undefined : () => setLanguages([...read, code])}
            />
          ))}
      </SettingsSection>
    </SettingsPage>
  );
}
