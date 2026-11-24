import type { AgentTraits } from "@otter/client/agents/agent-traits";
import type { AgentSettingsPatch, ProviderSnapshot } from "@otter/client/agents/api";
import type { ExtensionManifest } from "@otter/contracts/extensions";
import type { ComponentType } from "react";

/** `color`: the text's, for a mark drawn in it (varys's, OpenAI's). */
export type AgentMarkProps = { size: number; color: string };

/** A settings row choosing among a few, in the system's menu (SwiftUI's menu `Picker`). */
export type PickerRowProps = {
  title: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

/** What an agent's settings ask of the app that the kit's imports can't draw or reach. */
export type AgentSettingsControls = {
  PickerRow: ComponentType<PickerRowProps>;
  copy: (text: string) => void;
  /** Scans a QR code with the camera; the first that `accepts` takes, or null when cancelled. */
  scan: (scanning: {
    /** What to point the camera at. */
    prompt: string;
    /** Said when a code isn't one `accepts` takes. */
    invalid: string;
    accepts: (code: string) => boolean;
  }) => Promise<string | null>;
};

/** An agent's connection on its page: the sections between its name and Remove. */
export type AgentSettingsProps = {
  provider: ProviderSnapshot;
  update: (patch: AgentSettingsPatch) => void;
  controls: AgentSettingsControls;
};

/** Rows under one of a kind's agents in your agents list (an OpenClaw gateway's agents), divided from it. */
export type AgentRowsProps = {
  provider: ProviderSnapshot;
  update: (patch: AgentSettingsPatch) => void;
};

/**
 * An extension's `./mobile` half: what it contributes to the iPhone apps' screens, as `./ui` does
 * to the web's. An agent kind's mark, the form that connects one of its agents, and what its
 * agents show under them in the list.
 */
export type MobileExtension = {
  manifest: ExtensionManifest;
  agent?: {
    Mark: ComponentType<AgentMarkProps>;
    /** What the kind says of itself (its `shared/traits.ts`). */
    traits?: AgentTraits;
    Settings?: ComponentType<AgentSettingsProps>;
    Rows?: ComponentType<AgentRowsProps>;
  };
};
