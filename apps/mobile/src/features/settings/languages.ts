/** apps/ios's LanguagesSettings.choices, with their names. */
export const LANGUAGES: Record<string, string> = {
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

export const languageName = (code: string) => LANGUAGES[code.split("-")[0]!] ?? code;

/**
 * Preferences.effectiveReadLanguages: the ones chosen, else the iPhone's own
 * languages (`AppleLanguages`, "en-GB" → "en"), else English.
 */
export function effectiveReadLanguages(saved: readonly string[], system: readonly string[]) {
  if (saved.length > 0) return [...saved];
  const own = [...new Set(system.map((tag) => tag.split("-")[0]!.toLowerCase()).filter(Boolean))];
  return own.length > 0 ? own : ["en"];
}

/** Settings' summary: "English, French", or "English +2". */
export function languageSummary(codes: readonly string[]): string {
  const names = codes.map(languageName);
  return names.length > 2 ? `${names[0]} +${names.length - 1}` : names.join(", ");
}
