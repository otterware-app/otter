import { handle } from "../ipc.js";
import { listConnections } from "../services/connections.js";

export function registerConnectionHandlers(): void {
  handle("connections:list", () => listConnections());
}
