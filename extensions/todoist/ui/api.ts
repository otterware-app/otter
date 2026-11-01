import { ipc, task } from "@otter-mail/web/extension-kit";
import type {
  TodoistPage,
  TodoistProject,
  TodoistTaskInput,
  TodoistTaskUpdate,
  TodoistSection,
  TodoistCollaborator,
  TodoistReminder,
  TodoistReminderInput,
} from "@otter-mail/contracts/todoist";

export const todoistApi = {
  todoistStatus: (): Promise<{ connected: boolean }> => ipc("todoist:status"),
  signInTodoist: (): Promise<void> => task("todoist:signIn", {}),
  connectTodoist: (token: string): Promise<void> => task("todoist:connect", { token }),
  disconnectTodoist: (): Promise<void> => ipc("todoist:disconnect"),
  todoistProjects: (): Promise<TodoistProject[]> => task("todoist:projects", {}),
  todoistTasks: (projectId?: string, cursor?: string, filter?: string): Promise<TodoistPage> =>
    task("todoist:tasks", { projectId, cursor, filter }),
  createTodoistTask: (input: TodoistTaskInput): Promise<void> =>
    task("todoist:create", { ...input }),
  updateTodoistTask: (input: TodoistTaskUpdate): Promise<void> =>
    task("todoist:update", { ...input }),
  todoistLabels: (): Promise<{ id: string; name: string }[]> => task("todoist:labels", {}),
  todoistSections: (projectId: string): Promise<TodoistSection[]> =>
    task("todoist:sections", { projectId }),
  todoistCollaborators: (projectId: string): Promise<TodoistCollaborator[]> =>
    task("todoist:collaborators", { projectId }),
  todoistReminders: (id: string): Promise<TodoistReminder[]> => task("todoist:reminders", { id }),
  addTodoistReminder: (input: TodoistReminderInput): Promise<void> =>
    task("todoist:addReminder", { ...input }),
  deleteTodoistReminder: (id: string, requestId: string): Promise<void> =>
    task("todoist:deleteReminder", { id, requestId }),
  completeTodoistTask: (id: string, requestId: string): Promise<void> =>
    task("todoist:complete", { id, requestId }),
};
