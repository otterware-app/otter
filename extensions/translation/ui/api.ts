/** Translation's calls (core: translation:*). */

import { ipc, task } from "@otter-mail/web/extension-kit";

export type TranslationSettings = {
  /** Languages the user reads; empty until set (system languages apply). */
  readLanguages: string[];
  autoTranslate: boolean;
};

export type TranslationStatus =
  | "ok"
  | "notInstalled"
  | "needsDownload"
  | "unsupported"
  | "unavailable";

export const translationApi = {
  getTranslationSettings: (): Promise<TranslationSettings> => ipc("translation:getSettings"),

  setTranslationSettings: (params: Partial<TranslationSettings>): Promise<TranslationSettings> =>
    ipc("translation:setSettings", params),

  /** Apple's on-device language detection. */
  detectLanguage: (text: string): Promise<{ language: string | null; confidence: number }> =>
    ipc("translation:detect", { text }),

  /** Apple's on-device translation, one result per segment. */
  translate: (params: {
    segments: string[];
    source: string;
    target: string;
  }): Promise<{ status: TranslationStatus; texts: string[] }> =>
    task("translation:translate", params),
};
