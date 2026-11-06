import { scheduleOnRN } from "react-native-worklets";

import { createWorkerHost } from "@otter-mail/mobile-worker";

import { installPolyfills } from "./polyfills";
import type { FromWorker, ToWorker, WorkerConfig } from "./protocol";

/**
 * Core's host on the worker runtime, as apps/web's worker.ts is in the
 * browser: it starts core with the phone's Platform, runs the UI's invokes
 * through callHandler and sends core's broadcasts back. `deliver` is a UI
 * runtime function; worklets calls it there.
 */

type Deliver = (message: FromWorker) => void;

let deliver: Deliver | null = null;
let ready: Promise<void> | null = null;
const resumeListeners = new Set<() => void>();

const post = (message: FromWorker) => {
  if (deliver) scheduleOnRN(deliver, message);
};

export function startHost(target: Deliver, config: WorkerConfig): void {
  deliver = target;
  const host = createWorkerHost();
  const started = host.now();
  installPolyfills(host);

  ready = (async () => {
    // After the polyfills: core's modules read globals as they load.
    const core = require("@otter-mail/core") as typeof import("@otter-mail/core");
    const { mobilePlatform } =
      require("../persistence/platform") as typeof import("../persistence/platform");
    const platform = await mobilePlatform({
      host,
      appVersion: config.appVersion,
      relayUrl: config.relayUrl,
      demo: config.demo,
      shell: {
        broadcast: (channel, params) => post({ type: "event", channel, params }),
        effect: (effect) => post({ type: "effect", effect }),
        onResume(listener) {
          resumeListeners.add(listener);
          return () => resumeListeners.delete(listener);
        },
      },
    });
    await core.startCore(platform, []);
  })();

  ready.then(
    () => post({ type: "ready", bootMs: host.now() - started }),
    (error: unknown) => {
      host.log("error", `Core failed to start: ${describe(error)}`);
      post({ type: "failed", error: describe(error) });
    },
  );
}

export function receive(message: ToWorker): void {
  if (message.type === "resume") {
    for (const listener of resumeListeners) listener();
  } else if (message.type === "invoke") {
    void ready?.then(async () => {
      const { callHandler } = require("@otter-mail/core") as typeof import("@otter-mail/core");
      post({
        type: "result",
        id: message.id,
        ...(await callHandler(message.channel, message.params)),
      });
    });
  } else if (message.type === "probe") {
    void (async () => {
      try {
        const { runProbe } = require("./probes") as typeof import("./probes");
        post({
          type: "result",
          id: message.id,
          result: await runProbe(message.name, message.args, ready),
        });
      } catch (error) {
        post({ type: "result", id: message.id, error: describe(error) });
      }
    })();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
}
