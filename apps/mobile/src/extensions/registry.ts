import calendarInvites from "@otter-mail/extension-calendar-invites/mobile";
import hermes from "@otter-mail/extension-hermes/mobile";
import openclaw from "@otter-mail/extension-openclaw/mobile";
import openrouter from "@otter-mail/extension-openrouter/mobile";
import signInCodes from "@otter-mail/extension-sign-in-codes/mobile";
import { runsOn } from "@otter-mail/contracts/extensions";

import type { MobileExtension } from "./kit";

/** The extensions' `./mobile` halves, those whose manifest names ios. */
export const mobileExtensions: MobileExtension[] = [
  signInCodes,
  calendarInvites,
  openrouter,
  hermes,
  openclaw,
].filter((e) => runsOn(e.manifest, "ios"));

export const messageCards = mobileExtensions.flatMap((e) => e.messageCards ?? []);

/** An agent's contribution, by its kind (the extension's id). */
export const agentContribution = (kind: string) =>
  mobileExtensions.find((e) => e.manifest.id === kind)?.agent;
