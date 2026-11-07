import { createHybridObject } from "@otter-mail/mobile-worker";
import type { MailSocket } from "./specs/MailSocket.nitro";

export type { MailSocket };

export const createMailSocket = () => createHybridObject<MailSocket>("MailSocket");
