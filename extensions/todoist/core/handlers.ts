import { runAsTask } from "@otter-mail/core/extension-kit";
import type { ExtensionContext } from "@otter-mail/core/extension-kit";
import * as todoist from "./todoist.js";

type Params = Record<string, unknown> | undefined;
const optional = (value: unknown) => (typeof value === "string" ? value : undefined);

export function registerTodoistHandlers(handle: ExtensionContext["handle"]): void {
  handle("todoist:signIn", (params: unknown) =>
    runAsTask(optional((params as Params)?.taskId), todoist.authorizeTodoist),
  );
  handle("todoist:status", () => todoist.todoistStatus());
  handle("todoist:disconnect", () => todoist.disconnectTodoist());
  handle("todoist:connect", (params: unknown) => {
    const p = params as Params;
    return runAsTask(optional(p?.taskId), () => todoist.connectTodoist(p?.token));
  });
  handle("todoist:projects", (params: unknown) =>
    runAsTask(optional((params as Params)?.taskId), todoist.todoistProjects),
  );
  handle("todoist:tasks", (params: unknown) => {
    const p = params as Params;
    return runAsTask(optional(p?.taskId), () =>
      todoist.todoistTasks(optional(p?.projectId), optional(p?.cursor), optional(p?.filter)),
    );
  });
  handle("todoist:create", (params: unknown) =>
    runAsTask(optional((params as Params)?.taskId), () => todoist.createTodoistTask(params)),
  );
  handle("todoist:labels", (p: unknown) =>
    runAsTask(optional((p as Params)?.taskId), todoist.todoistLabels),
  );
  for (const [name, action, key] of [
    ["sections", todoist.todoistSections, "projectId"],
    ["collaborators", todoist.todoistCollaborators, "projectId"],
    ["reminders", todoist.todoistReminders, "id"],
  ] as const)
    handle(`todoist:${name}`, (params: unknown) => {
      const p = params as Params;
      const id = optional(p?.[key]);
      if (!id || id.length > 200) throw new Error("Invalid Todoist request.");
      return runAsTask(optional(p?.taskId), () => action(id));
    });
  handle("todoist:update", (params: unknown) =>
    runAsTask(optional((params as Params)?.taskId), () => todoist.updateTodoistTask(params)),
  );
  handle("todoist:addReminder", (params: unknown) =>
    runAsTask(optional((params as Params)?.taskId), () => todoist.addTodoistReminder(params)),
  );
  handle("todoist:deleteReminder", (params: unknown) => {
    const p = params as Params;
    const id = optional(p?.id),
      requestId = optional(p?.requestId);
    if (!id || id.length > 200 || !requestId || !/^[\da-f-]{36}$/i.test(requestId))
      throw new Error("Invalid Todoist reminder request.");
    return runAsTask(optional(p?.taskId), () => todoist.deleteTodoistReminder(id, requestId));
  });
  handle("todoist:complete", (params: unknown) => {
    const p = params as Params;
    const id = optional(p?.id);
    const requestId = optional(p?.requestId);
    if (!id || id.length > 200 || !requestId || !/^[\da-f-]{36}$/i.test(requestId))
      throw new Error("Invalid Todoist task request.");
    return runAsTask(optional(p?.taskId), () => todoist.completeTodoistTask(id, requestId));
  });
}
