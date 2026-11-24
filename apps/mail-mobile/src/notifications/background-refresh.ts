import { mailApi } from "@otter/client/mail/api";
import { otterApi } from "@otter/client/otter-account";
import { syncAllAccounts, turnedOffMailboxes } from "@otter/core";
import {
  BackgroundTaskResult,
  getStatusAsync,
  BackgroundTaskStatus,
  registerTaskAsync,
  unregisterTaskAsync,
} from "expo-background-task";
import { defineTask, isTaskRegisteredAsync } from "expo-task-manager";

import { coreStarted, fake } from "../core.ts";

const taskName = "otter-mail-refresh";
let configuring = Promise.resolve();

if (!fake) {
  defineTask(taskName, async () => {
    try {
      await coreStarted;
      if (!(await otterApi.getState()).user) return BackgroundTaskResult.Success;
      const off = turnedOffMailboxes();
      const accounts = (await mailApi.listAccounts()).filter(
        ({ id, signedOut }) => !signedOut && !off.has(id),
      );
      if (!accounts.length) return BackgroundTaskResult.Success;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          syncAllAccounts({ force: true, trigger: "timer", wait: true }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("Mail refresh ran out of time.")), 25_000);
          }),
        ]);
        const statuses = await Promise.all(accounts.map(({ id }) => mailApi.getSyncStatus(id)));
        return statuses.some(({ error }) => error)
          ? BackgroundTaskResult.Failed
          : BackgroundTaskResult.Success;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      console.warn("Couldn't refresh Mail in the background", error);
    }
    return BackgroundTaskResult.Failed;
  });
}

export function configureMailRefresh(enabled: boolean): void {
  if (fake) return;
  configuring = configuring
    .then(async () => {
      const registered = await isTaskRegisteredAsync(taskName);
      if (!enabled && registered) await unregisterTaskAsync(taskName);
      if (enabled && !registered && (await getStatusAsync()) === BackgroundTaskStatus.Available)
        await registerTaskAsync(taskName, { minimumInterval: 15 });
    })
    .catch((error: unknown) => console.warn("Couldn't schedule Mail refresh", error));
}
