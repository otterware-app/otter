import { useEffect, useState } from "react";

import { core } from "./core";

export type TranslationSettings = { readLanguages: string[]; autoTranslate: boolean };

/** The phone's own language, where Settings › Translation lists none. */
const deviceLanguage = () => Intl.DateTimeFormat().resolvedOptions().locale.split("-")[0] ?? "en";

/** Settings › Translation (core's translation extension), following its changes. */
export function useTranslationSettings(): TranslationSettings {
  const [settings, setSettings] = useState<TranslationSettings>({
    readLanguages: [],
    autoTranslate: false,
  });
  useEffect(() => {
    const take = (s: TranslationSettings) => setSettings(s);
    void core.invoke<TranslationSettings>("translation:getSettings").then(take, () => {});
    return core.on("translation:settingsChanged", (s) => take(s as TranslationSettings));
  }, []);
  return {
    readLanguages: settings.readLanguages.length ? settings.readLanguages : [deviceLanguage()],
    autoTranslate: settings.autoTranslate,
  };
}
