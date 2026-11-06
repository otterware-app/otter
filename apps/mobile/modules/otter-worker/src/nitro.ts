import type { HybridObject } from "react-native-nitro-modules";

type Proxy = { createHybridObject<T extends HybridObject<{}>>(name: string): T };

/**
 * Nitro's proxy on whichever runtime this runs: React Native's installs it
 * when react-native-nitro-modules loads, the worker's when `installNitro`
 * has put it there. Never the package's JS, which asks for a TurboModule.
 */
export function createHybridObject<T extends HybridObject<{}>>(name: string): T {
  const proxy = (globalThis as { NitroModulesProxy?: Proxy }).NitroModulesProxy;
  if (!proxy) throw new Error(`Nitro isn't installed on this runtime (creating ${name}).`);
  return proxy.createHybridObject<T>(name);
}
