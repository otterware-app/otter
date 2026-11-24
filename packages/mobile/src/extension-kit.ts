import type { ExtensionManifest } from "@otter/contracts/extensions";
import type { ComponentType } from "react";

/** `color`: the text's, for a mark drawn in it (varys's, OpenAI's). */
export type AgentMarkProps = { size: number; color: string };

/**
 * An extension's `./mobile` half: what it contributes to the iPhone apps' screens, as `./ui` does
 * to the web's. For now, an agent kind's mark.
 */
export type MobileExtension = {
  manifest: ExtensionManifest;
  agent?: { Mark: ComponentType<AgentMarkProps> };
};
