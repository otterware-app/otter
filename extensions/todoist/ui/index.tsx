/**
 * Todoist: tasks from email (the reader's toolbar and menus, the list's
 * menu), browsing tasks (⌘K), and connecting (Settings → Integrations). The
 * dialogs are mounted once with the app.
 */

import type { UiExtension } from "@otter-mail/web/extension-kit";
import { CheckIcon, ListTodoIcon } from "lucide-react";

import { manifest } from "../manifest";
import { TodoistDialogs, addEmailToTodoist, browseTodoist } from "./dialogs";
import { TodoistSettingsPane } from "./settings";
import { TodoistIcon } from "./icon";

export default {
  manifest,
  Icon: TodoistIcon,
  messageActions: [
    {
      id: "todoist:add",
      label: "Add to Todoist",
      menuLabel: "Add to Todoist…",
      Icon: ListTodoIcon,
      toolbar: true,
      run: addEmailToTodoist,
    },
  ],
  commands: [
    {
      id: "todoist",
      title: "Browse Todoist tasks",
      keywords: "tasks projects complete todo",
      Icon: CheckIcon,
      run: browseTodoist,
    },
  ],
  Dialogs: TodoistDialogs,
  Settings: TodoistSettingsPane,
} satisfies UiExtension;
