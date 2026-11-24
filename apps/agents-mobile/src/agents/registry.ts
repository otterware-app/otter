import claude from "@otter/extension-claude/mobile";
import codex from "@otter/extension-codex/mobile";
import hermes from "@otter/extension-hermes/mobile";
import openclaw from "@otter/extension-openclaw/mobile";
import varys from "@otter/extension-varys/mobile";
import type { MobileExtension } from "@otter/mobile/extension-kit";

/**
 * The extensions' `./mobile` halves (apps/web's extensions/registry.ts is the web's). Every
 * agent kind's is here, not only those that run on the phone: a chat a Mac's Claude agent had
 * still shows its mark.
 */
export const EXTENSIONS: readonly MobileExtension[] = [hermes, openclaw, varys, claude, codex];

/** A kind of agent's mark, by its extension's id. */
export const agentMark = (kind: string | undefined) =>
  EXTENSIONS.find((e) => e.manifest.id === kind)?.agent?.Mark;
