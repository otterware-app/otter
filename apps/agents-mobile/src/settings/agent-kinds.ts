import { EXTENSIONS } from "../agents/registry.ts";

/** What a kind of agent brings to its agents' settings (its extension's `./mobile` half). */
export const agentKind = (kind: string | undefined) =>
  EXTENSIONS.find((e) => e.manifest.id === kind)?.agent;
