import { createHybridObject } from "@otter-mail/mobile-worker";
import type { AccessToken, Credentials } from "./specs/Credentials.nitro";

export type { AccessToken, Credentials };

export const createCredentials = () => createHybridObject<Credentials>("Credentials");
