/** Todoist's v1 API. Credentials stay in this device's secret store. */
import {
  broadcast,
  platform,
  listAccounts,
  getMessageLabelIds,
} from "@otter-mail/core/extension-kit";
import {
  todoistTaskInput,
  todoistTaskUpdate,
  todoistReminderInput,
  type TodoistSection,
  type TodoistCollaborator,
  type TodoistReminder,
  type TodoistPage,
  type TodoistProject,
} from "@otter-mail/contracts/todoist";

import {
  todoistAccessToken,
  hasTodoistOAuth,
  clearTodoistOAuth,
  signInTodoist,
} from "./todoist-auth.js";

const SECRET = "todoist-token";
const API = "https://api.todoist.com/api/v1";

async function request<T>(
  path: string,
  options: { token?: string; form?: URLSearchParams; retried?: boolean } = {},
): Promise<T> {
  const token = options.token ?? (await todoistAccessToken());
  if (!token) throw new Error("Connect Todoist in Settings → Integrations first.");
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: options.form === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.form === undefined
          ? {}
          : { "Content-Type": "application/x-www-form-urlencoded" }),
      },
      body: options.form,
      signal: AbortSignal.timeout(20000),
      redirect: "error",
      credentials: "omit",
    });
  } catch {
    throw new Error("Could not reach Todoist. Check your connection and try again.");
  }
  if (response.status === 401 && !options.token && !options.retried && (await hasTodoistOAuth())) {
    const refreshed = await todoistAccessToken(token);
    if (refreshed) return request(path, { ...options, token: refreshed, retried: true });
  }
  if (!response.ok) {
    if (response.status === 401)
      throw new Error("Todoist rejected this token. Reconnect in Settings → Integrations.");
    if (response.status === 403)
      throw new Error("Todoist did not allow this action. Check your project permissions.");
    if (response.status === 429)
      throw new Error("Todoist is receiving too many requests. Wait a moment, then try again.");
    if (response.status === 404)
      throw new Error("This Todoist task or project no longer exists. Refresh and try again.");
    if (response.status === 400)
      throw new Error(
        "Todoist could not accept this task. Check the task fields or filter expression.",
      );
    throw new Error(`Todoist is unavailable (${response.status}). Try again shortly.`);
  }
  if (response.status === 204) return undefined as T;
  try {
    const body = await response.text();
    return (body ? JSON.parse(body) : undefined) as T;
  } catch {
    throw new Error("Todoist returned an unreadable response. Try again shortly.");
  }
}

export async function todoistStatus(): Promise<{ connected: boolean }> {
  return { connected: Boolean(await platform().secrets.get(SECRET)) || (await hasTodoistOAuth()) };
}

export async function connectTodoist(token: unknown): Promise<void> {
  if (typeof token !== "string" || !token.trim() || /\s/.test(token.trim()) || token.length > 512)
    throw new Error("Enter a valid Todoist API token.");
  const cleaned = token.trim();
  await request("/projects?limit=1", { token: cleaned });
  await clearTodoistOAuth();
  await platform().secrets.set(SECRET, cleaned);
  broadcast("todoist:changed");
}

export async function disconnectTodoist(): Promise<void> {
  await clearTodoistOAuth();
  await platform().secrets.delete(SECRET);
  broadcast("todoist:changed");
}

export async function todoistProjects(): Promise<TodoistProject[]> {
  const projects: TodoistProject[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const query = new URLSearchParams({ limit: "200" });
    if (cursor) query.set("cursor", cursor);
    const page: { results: TodoistProject[]; next_cursor: string | null } = await request(
      `/projects?${query}`,
    );
    projects.push(...page.results.map(({ id, name }) => ({ id, name })));
    cursor = page.next_cursor;
    if (cursor && seen.has(cursor))
      throw new Error("Todoist returned a repeated page. Try refreshing.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return projects;
}

export function todoistTasks(
  projectId?: string,
  cursor?: string,
  filter?: string,
): Promise<TodoistPage> {
  const query = new URLSearchParams({ limit: "50" });
  if (projectId) query.set("project_id", projectId);
  if (cursor) query.set("cursor", cursor);
  if (filter) {
    query.delete("project_id");
    query.set("query", filter);
    query.set("lang", "en");
  }
  return request(`/tasks${filter ? "/filter" : ""}?${query}`);
}

/** Sync command UUIDs make retries safe without custom headers (Todoist's CORS
 * policy only allows Authorization and Content-Type in browsers). */
async function command(
  type:
    | "item_add"
    | "item_close"
    | "item_update"
    | "item_move"
    | "reminder_add"
    | "reminder_delete",
  requestId: string,
  args: Record<string, unknown>,
): Promise<void> {
  const result = await request<{ sync_status: Record<string, "ok" | { error_code?: number }> }>(
    "/sync",
    {
      form: new URLSearchParams({
        commands: JSON.stringify([
          { type, uuid: requestId, ...(type.endsWith("_add") ? { temp_id: requestId } : {}), args },
        ]),
      }),
    },
  );
  if (result?.sync_status?.[requestId] !== "ok")
    throw new Error(
      "Todoist could not save this change. Check the task, project permissions and due date, then try again.",
    );
}

export async function createTodoistTask(input: unknown): Promise<void> {
  const p = todoistTaskInput.parse(input);
  let description = p.description;
  if (p.email) {
    const account = (await listAccounts()).find((a) => a.id === p.email!.accountId);
    const message = account && getMessageLabelIds(account.id, p.email.messageId);
    if (!account || !message)
      throw new Error("This email is no longer available. Reopen it and try again.");
    const link = `https://mail.otterware.app/${encodeURIComponent(account.id)}/INBOX/${encodeURIComponent(p.email.messageId)}`;
    description = `${description}${description ? "\n\n" : ""}[Open conversation in Otter Mail](${link})`;
  }
  await command("item_add", p.requestId, {
    content: p.content,
    description,
    project_id: p.projectId,
    due: p.due ? { string: p.due } : undefined,
    priority: p.priority,
    section_id: p.sectionId,
    responsible_uid: p.assigneeId,
    labels: p.labels,
  });
  broadcast("todoist:tasksChanged");
}

export async function completeTodoistTask(id: string, requestId: string): Promise<void> {
  await command("item_close", requestId, { id });
  broadcast("todoist:tasksChanged", { completedId: id });
}

async function allPages<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const query = new URLSearchParams({ ...params, limit: "200" });
    if (cursor) query.set("cursor", cursor);
    const page: { results: T[]; next_cursor: string | null } = await request(`${path}?${query}`);
    results.push(...page.results);
    cursor = page.next_cursor;
    if (cursor && seen.has(cursor))
      throw new Error("Todoist returned a repeated page. Try refreshing.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return results;
}
export const todoistLabels = () => allPages<{ id: string; name: string }>("/labels");
export const todoistSections = (projectId: string) =>
  allPages<TodoistSection>("/sections", { project_id: projectId });
export const todoistCollaborators = (projectId: string) =>
  allPages<TodoistCollaborator>(`/projects/${encodeURIComponent(projectId)}/collaborators`);
export const todoistReminders = (taskId: string) =>
  allPages<TodoistReminder>("/reminders", { task_id: taskId });

export async function updateTodoistTask(input: unknown): Promise<void> {
  const p = todoistTaskUpdate.parse(input);
  // Each operation has a stable UUID so a retry can finish a partially applied save.
  if (p.projectId || p.sectionId !== undefined) {
    if (!p.sectionId && !p.projectId) throw new Error("Choose a destination project.");
    await command("item_move", p.moveRequestId, {
      id: p.id,
      ...(p.sectionId ? { section_id: p.sectionId } : { project_id: p.projectId }),
    });
    broadcast("todoist:tasksChanged");
  }
  await command("item_update", p.requestId, {
    id: p.id,
    content: p.content,
    description: p.description,
    priority: p.priority,
    labels: p.labels,
    responsible_uid: p.assigneeId,
    due: p.due === undefined ? undefined : p.due ? { string: p.due } : null,
  });
  broadcast("todoist:tasksChanged");
}
export async function addTodoistReminder(input: unknown): Promise<void> {
  const p = todoistReminderInput.parse(input);
  await command("reminder_add", p.requestId, {
    item_id: p.itemId,
    type: "absolute",
    due: { string: p.due },
  });
}
export async function deleteTodoistReminder(id: string, requestId: string): Promise<void> {
  await command("reminder_delete", requestId, { id });
}

export async function authorizeTodoist(): Promise<void> {
  await signInTodoist();
  broadcast("todoist:changed");
}
