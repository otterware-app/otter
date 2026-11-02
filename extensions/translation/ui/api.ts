import { ipc, task } from "@otter-mail/web/extension-kit";

export type TranslationSettings = {
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

  detectLanguage: (text: string): Promise<{ language: string | null; confidence: number }> =>
    ipc("translation:detect", { text }),

  translate: (params: {
    segments: string[];
    source: string;
    target: string;
  }): Promise<{ status: TranslationStatus; texts: string[] }> =>
    task("translation:translate", params),
};
