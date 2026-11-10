import type { AgentSettings } from "@otter/core/extension-kit";

export type VarysSettings = AgentSettings & {
  /** The agent's address and ID, as this device paired with them. */
  address: string;
  agentId: string;
  /** Otter on this device, the same each time it pairs: pairing again replaces its grant. */
  installation: string;
  /** The account's agent channel this device's grant tells (relay.ts). */
  relayChannel?: string;
  /** Routines whose runs stay in varys rather than coming to Otter as chats (comma-separated ids). */
  mutedRoutines?: string;
};

export const VARYS_DEFAULTS: VarysSettings = {
  enabled: true,
  model: "",
  address: "",
  agentId: "",
  installation: "",
};
