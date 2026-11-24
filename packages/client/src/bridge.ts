import type { DesktopBridge } from "@otter/contracts";

/** The app's way to core: installed as a global by the Electron preload, the web app or the phone app. */
const bridge = () => (globalThis as unknown as { desktopBridge: DesktopBridge }).desktopBridge;

export const ipc = <T = unknown>(channel: string, params?: unknown): Promise<T> =>
  bridge().invoke<T>(channel, params);

/** Hears what core broadcasts on `channel`; returns a way to stop. */
export const listen = (channel: string, listener: (params: unknown) => void): (() => void) =>
  bridge().on(channel, listener);

export const task = <T>(channel: string, params: Record<string, unknown>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const taskId = crypto.randomUUID();
    const off = listen("task:done", (payload: unknown) => {
      const p = payload as { taskId?: string; result?: T; error?: string } | undefined;
      if (p?.taskId !== taskId) return;
      off();
      if (p.error) reject(new Error(p.error));
      else resolve(p.result as T);
    });
    ipc(channel, { ...params, taskId }).catch((err: unknown) => {
      off();
      reject(err);
    });
  });
