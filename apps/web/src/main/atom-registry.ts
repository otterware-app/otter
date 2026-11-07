import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { createElement, type PropsWithChildren } from "react";

/** The main window's atoms (client-runtime's state), read with @effect/atom-react. */
export const appAtomRegistry = AtomRegistry.make();

export function AppAtomRegistryProvider({ children }: PropsWithChildren) {
  return createElement(RegistryContext.Provider, { value: appAtomRegistry }, children);
}
