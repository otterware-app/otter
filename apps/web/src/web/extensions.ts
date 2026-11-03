import calendarInvites from "@otter-mail/extension-calendar-invites/core";
import hermes from "@otter-mail/extension-hermes/core";
import openclaw from "@otter-mail/extension-openclaw/core";
import openrouter from "@otter-mail/extension-openrouter/core";
import otterDrive from "@otter-mail/extension-otter-drive/core";
import todoist from "@otter-mail/extension-todoist/core";
import translation from "@otter-mail/extension-translation/core";
import { runsOn } from "@otter-mail/contracts/extensions";
import type { CoreExtension } from "@otter-mail/core";

const ALL: CoreExtension[] = [
  calendarInvites,
  translation,
  todoist,
  otterDrive,
  openrouter,
  hermes,
  openclaw,
];

export const webExtensions = ALL.filter((e) => runsOn(e.manifest, "web"));
