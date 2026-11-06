import { requireNativeModule } from "expo";

type TranslationModule = {
  detect(text: string): Promise<{ language: string | null; confidence: number }>;
  /** `status`: "ok", "notInstalled" (the language pair needs downloading), "unsupported" or "unavailable". */
  translate(
    texts: string[],
    source: string,
    target: string,
  ): Promise<{ status: "ok" | "notInstalled" | "unsupported" | "unavailable"; texts: string[] }>;
};

/** Apple's on-device language detection and Translation (installed language pairs). */
export const translation = requireNativeModule<TranslationModule>("OtterTranslation");
