import type { TodoistTask, TodoistReminder } from "@otter-mail/contracts/todoist";
import type { Platform } from "@otter-mail/core";

const FILE = "demo-todoist.json";
const projects = [
  { id: "inbox", name: "Inbox" },
  { id: "work", name: "Work" },
];
const sections = [
  { id: "planning", name: "Planning", project_id: "work" },
  { id: "doing", name: "In progress", project_id: "work" },
];
type State = {
  tasks: TodoistTask[];
  commands: string[];
  reminders?: (TodoistReminder & { item_id: string })[];
};
const dueDate = (string: string) => {
  const date = new Date();
  if (/tomorrow/i.test(string)) date.setDate(date.getDate() + 1);
  const explicit = /\d{4}-\d{2}-\d{2}/.exec(string);
  return {
    string,
    date: explicit?.[0] ?? date.toISOString().slice(0, 10),
    is_recurring: /every/i.test(string),
  };
};

export async function fakeTodoist(files: Platform["files"]) {
  const saved = await files.read(FILE);
  const state: State = saved
    ? JSON.parse(new TextDecoder().decode(saved))
    : {
        tasks: [
          {
            id: "demo-plan",
            content: "Review the launch plan",
            description: "Check the milestones before Friday.",
            project_id: "work",
            priority: 3,
            due: null,
          },
          {
            id: "demo-inbox",
            content: "Follow up on the proposal",
            description: "",
            project_id: "inbox",
            priority: 1,
            due: null,
          },
          {
            id: "demo-recurring",
            content: "Review the inbox",
            description: "This recurring task advances when completed.",
            project_id: "work",
            priority: 2,
            due: {
              date: new Date().toISOString().slice(0, 10),
              string: "every day",
              is_recurring: true,
            },
          },
        ],
        commands: [],
      };
  state.reminders ??= [];
  return async (url: URL, init?: RequestInit): Promise<Response> => {
    if (new Headers(init?.headers).get("Authorization") !== "Bearer demo")
      return new Response("Unauthorized", { status: 401 });
    if (url.pathname === "/api/v1/projects")
      return Response.json({ results: projects, next_cursor: null });
    if (url.pathname === "/api/v1/labels")
      return Response.json({
        results: [
          { id: "followup", name: "followup" },
          { id: "work", name: "work" },
        ],
        next_cursor: null,
      });
    if (url.pathname === "/api/v1/sections")
      return Response.json({
        results: sections.filter((s) => s.project_id === url.searchParams.get("project_id")),
        next_cursor: null,
      });
    if (url.pathname.endsWith("/collaborators"))
      return Response.json({
        results: url.pathname.includes("/work/")
          ? [
              { id: "sam", name: "Sam Rivera", email: "sam@acme.example" },
              { id: "alex", name: "Alex Morgan", email: "alex@acme.example" },
            ]
          : [],
        next_cursor: null,
      });
    if (url.pathname === "/api/v1/reminders")
      return Response.json({
        results: state.reminders!.filter((r) => r.item_id === url.searchParams.get("task_id")),
        next_cursor: null,
      });
    if (url.pathname === "/api/v1/tasks" || url.pathname === "/api/v1/tasks/filter") {
      const project = url.searchParams.get("project_id");
      const filter = url.searchParams.get("query") ?? "";
      const today = new Date().toISOString().slice(0, 10);
      const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const matches = (task: TodoistTask, expression: string): boolean => {
        if (expression.includes("|")) return expression.split("|").some((p) => matches(task, p));
        if (expression.includes("&")) return expression.split("&").every((p) => matches(task, p));
        const part = expression.trim().replace(/^\(|\)$/g, "");
        if (!part) return true;
        if (part === "today") return task.due?.date.slice(0, 10) === today;
        if (part === "overdue") return !!task.due && task.due.date < today;
        if (part === "7 days")
          return !!task.due && task.due.date >= today && task.due.date < nextWeek;
        if (/^p[1-4]$/.test(part)) return task.priority === 5 - Number(part[1]);
        if (part.startsWith("@")) return !!task.labels?.includes(part.slice(1));
        if (part.startsWith("search:"))
          return `${task.content} ${task.description}`
            .toLowerCase()
            .includes(part.slice(7).trim().toLowerCase());
        return false;
      };
      const tasks = state.tasks.filter(
        (task) => (!project || task.project_id === project) && matches(task, filter),
      );
      const start = Number(url.searchParams.get("cursor") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      return Response.json({
        results: tasks.slice(start, start + limit),
        next_cursor: start + limit < tasks.length ? String(start + limit) : null,
      });
    }
    if (url.pathname !== "/api/v1/sync" || init?.method !== "POST")
      return new Response(null, { status: 404 });
    const form = new URLSearchParams(String(init.body));
    const commands = JSON.parse(form.get("commands") ?? "[]") as {
      type: string;
      uuid: string;
      args: {
        id?: string;
        content?: string;
        description?: string;
        project_id?: string;
        priority?: number;
        due?: { string: string } | null;
        section_id?: string;
        responsible_uid?: string | null;
        labels?: string[];
        item_id?: string;
        type?: string;
      };
    }[];
    const sync_status: Record<string, "ok" | { error_code: number }> = {};
    for (const command of commands) {
      if (state.commands.includes(command.uuid)) {
        sync_status[command.uuid] = "ok";
        continue;
      }
      const args = command.args;
      if (command.type === "item_add" && args.content) {
        state.tasks.push({
          id: `demo-${command.uuid}`,
          content: args.content,
          description: args.description ?? "",
          project_id: args.project_id ?? "inbox",
          priority: args.priority ?? 1,
          section_id: args.section_id ?? null,
          responsible_uid: args.responsible_uid ?? null,
          labels: args.labels ?? [],
          due: args.due ? dueDate(args.due.string) : null,
        });
      } else if (command.type === "reminder_add" && args.item_id && args.due) {
        state.reminders!.push({
          id: `reminder-${command.uuid}`,
          item_id: args.item_id,
          type: "absolute",
          minute_offset: 0,
          due: dueDate(args.due.string),
        });
      } else if (command.type === "reminder_delete") {
        state.reminders = state.reminders!.filter((r) => r.id !== args.id);
      } else if (command.type === "item_update" || command.type === "item_move") {
        const task = state.tasks.find((t) => t.id === args.id);
        if (!task) {
          sync_status[command.uuid] = { error_code: 20 };
          continue;
        }
        if (command.type === "item_move") {
          task.section_id = args.section_id ?? null;
          task.project_id =
            args.project_id ??
            sections.find((s) => s.id === args.section_id)?.project_id ??
            task.project_id;
        } else {
          if (args.content !== undefined) task.content = args.content;
          if (args.description !== undefined) task.description = args.description;
          if (args.priority !== undefined) task.priority = args.priority;
          if (args.labels !== undefined) task.labels = args.labels;
          if (args.responsible_uid !== undefined) task.responsible_uid = args.responsible_uid;
          if (args.due !== undefined) task.due = args.due ? dueDate(args.due.string) : null;
        }
      } else if (command.type === "item_close") {
        const task = state.tasks.find((task) => task.id === args.id);
        if (!task) {
          sync_status[command.uuid] = { error_code: 20 };
          continue;
        }
        if (task.due?.is_recurring) {
          const date = new Date(`${task.due.date}T12:00:00Z`);
          date.setUTCDate(date.getUTCDate() + 1);
          task.due.date = date.toISOString().slice(0, 10);
        } else state.tasks = state.tasks.filter((task) => task.id !== args.id);
      } else {
        sync_status[command.uuid] = { error_code: 20 };
        continue;
      }
      state.commands.push(command.uuid);
      sync_status[command.uuid] = "ok";
    }
    await files.write(FILE, JSON.stringify(state));
    return Response.json({ sync_status });
  };
}
