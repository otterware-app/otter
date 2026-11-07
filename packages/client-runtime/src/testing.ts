import type { CoreBridge } from "./connection/index.ts";
import { memoryStorage, type ClientPlatform } from "./platform/index.ts";

type Answer = (params: any) => unknown;

/** A pretend core: invokes answered by `answers`, broadcasts sent with `emit`. */
export function fakeCore(answers: Record<string, Answer> = {}) {
  const listeners = new Map<string, Set<(params: unknown) => void>>();
  const calls: { channel: string; params: any }[] = [];
  const core: CoreBridge = {
    async invoke<T>(channel: string, params?: unknown): Promise<T> {
      calls.push({ channel, params });
      const answer = answers[channel];
      if (!answer) throw new Error(`No handler for ${channel}.`);
      return (await answer(params)) as T;
    },
    on(channel, listener) {
      const set = listeners.get(channel) ?? new Set();
      listeners.set(channel, set);
      set.add(listener);
      return () => void set.delete(listener);
    },
  };
  return {
    core,
    calls,
    answers,
    emit(channel: string, params?: unknown) {
      for (const listener of listeners.get(channel) ?? []) listener(params);
    },
    called: (channel: string) => calls.filter((c) => c.channel === channel),
  };
}

export function testPlatform(): ClientPlatform {
  let id = 0;
  return {
    storage: memoryStorage(),
    focus: { isFocused: () => true, onFocus: () => () => {} },
    newId: () => `id-${++id}`,
  };
}

export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
