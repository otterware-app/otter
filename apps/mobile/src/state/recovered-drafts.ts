import { OTTER_ACCOUNT_STATE_CHANNEL } from "@otter-mail/contracts";

import type { core as coreBridge } from "./core";

/** The Swift app's recovery copies become drafts: at launch, and once the Otter account they're under signs in. */
export function startRecoveredDrafts(core: typeof coreBridge, ready: Promise<unknown>): void {
  const run = () => void core.invoke("drafts:importRecovered").catch(() => {});
  void ready.then(run);
  core.on(OTTER_ACCOUNT_STATE_CHANNEL, run);
  core.on("gmail:accounts-changed", run);
}
