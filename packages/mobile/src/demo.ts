import { reloadAppAsync } from "expo";
import { SQLiteStorage } from "expo-sqlite/kv-store";

// Its own file: read before core starts, to choose which home core opens.
const launch = new SQLiteStorage("launch-storage.db");

/**
 * The demo mailbox (Session.swift's `tryDemo`): core's made-up services (`@otter/core/fake`), in
 * their own home, storage and Keychain service, apart from the user's own.
 */
export const demo = launch.getItemSync("demo") === "true";

/** Core starts once per launch, so turning the demo on or off starts the app over. */
export async function setDemo(on: boolean): Promise<void> {
  if (on) launch.setItemSync("demo", "true");
  else launch.removeItemSync("demo");
  await reloadAppAsync();
}
