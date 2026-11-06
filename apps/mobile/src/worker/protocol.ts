/** What the UI tells core's worker as it starts (worklets copies it across). */
export type WorkerConfig = {
  appVersion: string;
  relayUrl: string;
  /** `pnpm dev:fake`'s made-up mailbox (apps/web's fake Gmail), no account at all. */
  demo: boolean;
};
