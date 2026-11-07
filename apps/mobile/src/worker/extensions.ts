import calendarInvites from "@otter-mail/extension-calendar-invites/core";
import hermes from "@otter-mail/extension-hermes/core";
import openclaw from "@otter-mail/extension-openclaw/core";
import openrouter from "@otter-mail/extension-openrouter/core";
import translation from "@otter-mail/extension-translation/core";
import { runsOn } from "@otter-mail/contracts/extensions";
import type { CoreExtension } from "@otter-mail/core";

/** The extensions core runs on the phone: those whose manifest names ios. */
export const mobileExtensions: CoreExtension[] = [
  openrouter,
  hermes,
  openclaw,
  calendarInvites,
  translation,
].filter((e) => runsOn(e.manifest, "ios"));
