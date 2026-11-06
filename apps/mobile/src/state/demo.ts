import { createWorkerHost } from "@otter-mail/mobile-worker";

/** Present while the demo mailbox is chosen (the welcome's "Try the demo mailbox"), until signing in. */
export const DEMO_FILE = "demo-mailbox";

export const demoChosen = (): boolean => createWorkerHost().readFile(DEMO_FILE) !== undefined;
