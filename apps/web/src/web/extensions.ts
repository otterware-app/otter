import calendarInvites from "@otter/extension-calendar-invites/core";
import hermes from "@otter/extension-hermes/core";
import openclaw from "@otter/extension-openclaw/core";
import openrouter from "@otter/extension-openrouter/core";
import otterDrive from "@otter/extension-otter-drive/core";
import todoist from "@otter/extension-todoist/core";
import translation from "@otter/extension-translation/core";
import varys from "@otter/extension-varys/core";
import { runsOn } from "@otter/contracts/extensions";
import type { CoreExtension } from "@otter/core";

const ALL: CoreExtension[] = [
  calendarInvites,
  translation,
  todoist,
  otterDrive,
  openrouter,
  hermes,
  openclaw,
  varys,
];

export const webExtensions = ALL.filter((e) => runsOn(e.manifest, "web"));
