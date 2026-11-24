import { ipc, listen } from "@otter/client/bridge";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { requireNativeView } from "expo";
import { getLocales } from "expo-localization";
import { useEffect } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

import { mailFailure } from "./mail-actions.tsx";

type TranslationSettings = { readLanguages: string[]; autoTranslate: boolean };
type Translation = { text: string; source: string; languages: string[] };
const queryKey = ["translation:settings"];

export const NativeMailTranslation = requireNativeView<
  ViewProps & {
    text: string;
    presented: boolean;
    automatic: boolean;
    languages: string[];
    onDismiss: () => void;
    onTranslated: (event: NativeSyntheticEvent<Translation>) => void;
  }
>("OtterMobile", "MailTranslationView");

export function useTranslationSettings() {
  return useQuery({
    queryKey,
    queryFn: () => ipc<TranslationSettings>("translation:getSettings"),
  });
}

export function useUpdateTranslationSettings() {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<TranslationSettings>) =>
      ipc<TranslationSettings>("translation:setSettings", patch),
    onSuccess: (value) => queries.setQueryData(queryKey, value),
    onError: mailFailure,
  });
}

export function useFollowTranslationSettings() {
  const queries = useQueryClient();
  useEffect(
    () => listen("translation:settingsChanged", () => void queries.invalidateQueries({ queryKey })),
    [queries],
  );
}

export function effectiveLanguages(settings: TranslationSettings | undefined): string[] {
  const languages = settings?.readLanguages;
  return languages?.length
    ? languages
    : [
        ...new Set(
          getLocales().flatMap(({ languageCode }) => (languageCode ? [languageCode] : [])),
        ),
      ];
}

export const languages = {
  en: "English",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  sv: "Swedish",
  pl: "Polish",
  tr: "Turkish",
  ru: "Russian",
  uk: "Ukrainian",
  ar: "Arabic",
  hi: "Hindi",
  vi: "Vietnamese",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
};
const languageNames =
  typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames([getLocales()[0].languageTag], { type: "language" })
    : null;
export const languageName = (code: string) =>
  languageNames?.of(code) ?? languages[code as keyof typeof languages] ?? code;
