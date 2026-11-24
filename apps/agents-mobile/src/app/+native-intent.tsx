import { closeSheets } from "../frame/navigation.ts";

/** A link opens in front: whatever sheet or cover is up closes first. */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  if (!initial) closeSheets();
  return path;
}
