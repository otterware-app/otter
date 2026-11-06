import { requireNativeModule, type EventSubscription } from "expo";

type BackgroundModule = {
  schedule(): void;
  complete(success: boolean): void;
  addListener(event: "onRefresh" | "onExpire", listener: () => void): EventSubscription;
};

const native = requireNativeModule<BackgroundModule>("OtterBackground");

/**
 * The background app refresh task: `run` is called when iOS wakes the app
 * for it, with a signal that aborts when iOS wants the time back. Its result
 * completes the task. A task that woke the app before this was called runs
 * as soon as it is.
 */
export function onBackgroundRefresh(run: (signal: AbortSignal) => Promise<boolean>): () => void {
  let controller: AbortController | null = null;
  const expire = native.addListener("onExpire", () => controller?.abort());
  const refresh = native.addListener("onRefresh", () => {
    controller = new AbortController();
    const { signal } = controller;
    run(signal)
      .catch(() => false)
      .then((success) => native.complete(success && !signal.aborted));
  });
  return () => {
    refresh.remove();
    expire.remove();
  };
}

export const scheduleBackgroundRefresh = () => native.schedule();
