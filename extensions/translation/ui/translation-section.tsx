import { features, searchableSetting } from "@otter/web/extension-kit";
import { toast } from "@otter/ui/components/toast";
import { DEFAULT_SETTINGS } from "@otter/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon, StarIcon, XIcon } from "lucide-react";
import { Button, IconButton } from "@otter/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";
import { Switch } from "@otter/ui/components/switch";
import { HintTooltip } from "@otter/ui/components/tooltip";
import {
  systemReadLanguages,
  languageName,
  TRANSLATION_LANGUAGES,
  useTranslationSettings,
} from "./translation";
import { translationApi, type TranslationSettings } from "./api";
import { SettingsResetButton, SettingsRow, SettingsSection } from "@otter/ui/components/settings";

export function TranslationSection() {
  const queryClient = useQueryClient();
  const { readLanguages, autoTranslate } = useTranslationSettings();

  const save = async (patch: Partial<TranslationSettings>) => {
    console.log("[Settings:setTranslation]", patch);
    try {
      const saved = await translationApi.setTranslationSettings(patch);
      queryClient.setQueryData(["translation-settings"], saved);
    } catch (error) {
      toast.error(`Failed to save translation settings: ${error}`);
    }
  };

  if (!features.translation) return null;

  const setLanguages = (languages: string[]) => void save({ readLanguages: languages });
  const addable = TRANSLATION_LANGUAGES.filter((code) => !readLanguages.includes(code)).sort(
    (a, b) => languageName(a).localeCompare(languageName(b)),
  );

  return (
    <SettingsSection title="Translation">
      <SettingsRow
        {...searchableSetting("read-languages")}
        resetAction={
          JSON.stringify(readLanguages) !== JSON.stringify(systemReadLanguages()) ? (
            <SettingsResetButton
              label="reading languages"
              onClick={() => setLanguages(DEFAULT_SETTINGS.readLanguages)}
            />
          ) : null
        }
        description="Mail in any other language offers a translation into your starred language. The translator runs on this device, so nothing is sent anywhere."
        control={
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
              <PlusIcon className="size-3.5" />
              Add language
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
              {addable.map((code) => (
                <DropdownMenuItem key={code} onClick={() => setLanguages([...readLanguages, code])}>
                  {languageName(code)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <ul className="-mx-2.5 mt-2 mb-2 flex flex-col gap-0.5">
          {readLanguages.map((code, i) => (
            <li
              key={code}
              className="group/lang flex h-8 items-center gap-1 rounded-lg px-2.5 hover:bg-foreground/[0.04]"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {languageName(code)}
              </span>
              {/* The starred language is where translations go. */}
              {i === 0 ? (
                <HintTooltip label="Translations go into this language">
                  <span className="flex size-6 items-center justify-center">
                    <StarIcon className="size-3.5 fill-current text-warning-foreground" />
                  </span>
                </HintTooltip>
              ) : (
                <HintTooltip label="Translate into this language">
                  <IconButton
                    label={`Translate into ${languageName(code)}`}
                    size="icon-xs"
                    className="opacity-0 group-hover/lang:opacity-100 focus-visible:opacity-100"
                    onClick={() => setLanguages([code, ...readLanguages.filter((c) => c !== code)])}
                  >
                    <StarIcon className="size-3.5" />
                  </IconButton>
                </HintTooltip>
              )}
              <IconButton
                label={`Remove ${languageName(code)}`}
                size="icon-xs"
                disabled={readLanguages.length === 1}
                onClick={() => setLanguages(readLanguages.filter((c) => c !== code))}
              >
                <XIcon className="size-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      </SettingsRow>
      <SettingsRow
        {...searchableSetting("auto-translate")}
        resetAction={
          autoTranslate !== DEFAULT_SETTINGS.autoTranslate ? (
            <SettingsResetButton
              label="auto translate"
              onClick={() => void save({ autoTranslate: DEFAULT_SETTINGS.autoTranslate })}
            />
          ) : null
        }
        description="Show mail in other languages already translated, without asking."
        control={
          <Switch
            id="autoTranslate"
            checked={autoTranslate}
            onCheckedChange={(checked) => void save({ autoTranslate: checked })}
          />
        }
      />
    </SettingsSection>
  );
}
