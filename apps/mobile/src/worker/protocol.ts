/**
 * Messages between the UI runtime and core's worker runtime. Everything in
 * them crosses by worklets' serializer: plain data only. The Effect RPC
 * core-host protocol (packages/contracts) replaces this once it lands.
 */

export type WorkerConfig = {
  appVersion: string;
  relayUrl: string;
  demo: boolean;
};

export type ToWorker =
  | { type: "invoke"; id: number; channel: string; params: unknown }
  | { type: "resume" }
  | { type: "probe"; id: number; name: string; args: unknown };

export type FromWorker =
  | { type: "ready"; bootMs: number }
  | { type: "failed"; error: string }
  | { type: "result"; id: number; result?: unknown; error?: string }
  | { type: "event"; channel: string; params: unknown }
  | { type: "effect"; effect: { kind: string; [key: string]: unknown } };
