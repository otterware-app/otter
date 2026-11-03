/**
 * Chrome's built-in, on-device translation (the Translator and
 * LanguageDetector APIs), for the web app's Platform.translator. It runs in
 * the page (the APIs aren't in workers), in the tab where the user asked.
 * Chrome downloads a language pack only after a click: without one, a
 * translation answers `needsDownload`, and the banner's Try Again is the click.
 */

import type { LanguageDetection, TranslationResult } from "@otter-mail/core";

type Availability = "unavailable" | "downloadable" | "downloading" | "available";

interface ChromeTranslator {
  translate(text: string): Promise<string>;
}
interface ChromeLanguageDetector {
  detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>;
}
declare const Translator: {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
  create(options: { sourceLanguage: string; targetLanguage: string }): Promise<ChromeTranslator>;
};
declare const LanguageDetector: {
  availability(): Promise<Availability>;
  create(): Promise<ChromeLanguageDetector>;
};

export const hasBuiltInTranslator = "Translator" in window && "LanguageDetector" in window;

let detector: Promise<ChromeLanguageDetector> | null = null;
const translators = new Map<string, Promise<ChromeTranslator>>();

export async function detectLanguage(text: string): Promise<LanguageDetection> {
  try {
    detector ??= LanguageDetector.create();
    const [best] = await (await detector).detect(text);
    return best && best.detectedLanguage !== "und"
      ? { language: best.detectedLanguage, confidence: best.confidence }
      : { language: null, confidence: 0 };
  } catch {
    detector = null;
    return { language: null, confidence: 0 };
  }
}

export async function translate(
  texts: string[],
  source: string,
  target: string,
): Promise<TranslationResult> {
  const options = { sourceLanguage: source, targetLanguage: target };
  if ((await Translator.availability(options)) === "unavailable") {
    return { status: "unsupported", texts: [] };
  }
  const key = `${source}>${target}`;
  let translator = translators.get(key);
  if (!translator) {
    translator = Translator.create(options);
    translators.set(key, translator);
  }
  try {
    const ready = await translator;
    return { status: "ok", texts: await Promise.all(texts.map((text) => ready.translate(text))) };
  } catch (err) {
    translators.delete(key);
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      return { status: "needsDownload", texts: [] };
    }
    throw err;
  }
}
