import { createHybridObject } from "./nitro";
import type { FileEntry, WorkerHost } from "./specs/WorkerHost.nitro";

export { createHybridObject };
export type { FileEntry, WorkerHost };

type Installer = WorkerHost & { installNitro(workletRuntime: object): void };

export const createWorkerHost = () => createHybridObject<Installer>("WorkerHost");
