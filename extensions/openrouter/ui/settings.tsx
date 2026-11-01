/** The Otter Mail agent in Settings → Agents: its OpenRouter key, what it may do, its models. */

import {
  ModelsSection,
  RUNTIME_MODE_OPTIONS,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  SettingsSection,
  type AgentSettingsProps,
  type RuntimeMode,
} from "@otter-mail/web/extension-kit";

import { OpenRouterConnection } from "./openrouter-connection";

export function OpenRouterSettings({ provider, update }: AgentSettingsProps) {
  return (
    <>
      <OpenRouterConnection provider={provider} />
      <SettingsSection title="Access">
        <SettingsRow
          title="Tool approval"
          description="Choose how much the agent may do without asking. You can also change this in the composer."
          control={
            <Select
              value={provider.settings.runtimeMode ?? "approval-required"}
              onValueChange={(value) =>
                update({ openrouter: { runtimeMode: value as RuntimeMode } })
              }
            >
              <SelectTrigger variant="pill" aria-label="OpenRouter access">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RUNTIME_MODE_OPTIONS.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsSection>
      <ModelsSection
        provider={provider}
        selectedModel={provider.settings.model}
        onPick={(model) => update({ openrouter: { model } })}
      />
    </>
  );
}
