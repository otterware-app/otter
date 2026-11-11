import calendarInvites from "@otter/extension-calendar-invites/core";
import claude from "@otter/extension-claude/desktop";
import codex from "@otter/extension-codex/desktop";
import hermes from "@otter/extension-hermes/core";
import openclaw from "@otter/extension-openclaw/core";
import otterDrive from "@otter/extension-otter-drive/core";
import todoist from "@otter/extension-todoist/core";
import translation from "@otter/extension-translation/core";
import varys from "@otter/extension-varys/core";
import { runsOn } from "@otter/contracts/extensions";
import type { CoreExtension } from "@otter/core";

import { backendOS } from "./os/backend.js";

const ALL: CoreExtension[] = [
  calendarInvites,
  translation,
  todoist,
  otterDrive,
  hermes,
  openclaw,
  varys,
  codex,
  claude,
];

export const desktopExtensions = ALL.filter((e) => runsOn(e.manifest, backendOS.platform));
