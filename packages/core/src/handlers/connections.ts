/** Connections (docs/connections.md): what each sign-in provides and what needs permission. */

import { handle } from "../ipc.js";
import { listConnections } from "../services/connections.js";

export function registerConnectionHandlers(): void {
  handle("connections:list", () => listConnections());
}
