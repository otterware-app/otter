import calendarInvites from "@otter-mail/extension-calendar-invites/mobile";
import signInCodes from "@otter-mail/extension-sign-in-codes/mobile";
import { runsOn } from "@otter-mail/contracts/extensions";

import type { MobileExtension } from "./kit";

/** The extensions' `./mobile` halves, those whose manifest names ios. */
export const mobileExtensions: MobileExtension[] = [signInCodes, calendarInvites].filter((e) =>
  runsOn(e.manifest, "ios"),
);

export const messageCards = mobileExtensions.flatMap((e) => e.messageCards ?? []);
