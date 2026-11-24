import { handle } from "../ipc.ts";
import { listConnections } from "../services/connections.ts";

export function registerConnectionHandlers(): void {
  handle("connections:list", () => listConnections());
}
