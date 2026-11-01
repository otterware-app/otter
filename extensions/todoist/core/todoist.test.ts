import { handle, setPlatform, registeredHandlers } from "@otter-mail/core/extension-kit";
import type { Platform } from "@otter-mail/core/extension-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { registerTodoistHandlers } from "./handlers.js";
import {
  updateTodoistTask,
  addTodoistReminder,
  deleteTodoistReminder,
  todoistSections,
  todoistCollaborators,
  completeTodoistTask,
  connectTodoist,
  createTodoistTask,
  disconnectTodoist,
  todoistProjects,
  todoistStatus,
  todoistTasks,
} from "./todoist.js";

vi.mock("../../../packages/core/src/services/account-store.js", () => ({
  listAccounts: async () => [{ id: "me@example.com", email: "me@example.com" }],
}));
vi.mock("../../../packages/core/src/services/mail-store.js", () => ({
  getMessageLabelIds: (_account: string, id: string) => (id === "message-1" ? ["INBOX"] : null),
}));

const secrets = new Map<string, string>();
const fetchMock = vi.fn<typeof fetch>();
const broadcast = vi.fn();
const requestId = "b97b5a38-868b-4dcf-91d2-945626345245";
const success = () => Response.json({ sync_status: { [requestId]: "ok" } });
const body = () => {
  const form = fetchMock.mock.calls.at(-1)?.[1]?.body as URLSearchParams;
  return JSON.parse(form.get("commands")!)[0] as {
    type: string;
    uuid: string;
    temp_id?: string;
    args: Record<string, unknown>;
  };
};

beforeEach(() => {
  secrets.clear();
  broadcast.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setPlatform({
    secrets: {
      get: async (key) => secrets.get(key) ?? null,
      set: async (key, value) => {
        secrets.set(key, value);
      },
      delete: async (key) => {
        secrets.delete(key);
      },
    },
    broadcast,
  } as Partial<Platform> as Platform);
});
afterEach(() => vi.unstubAllGlobals());

async function connect() {
  fetchMock.mockResolvedValueOnce(Response.json({ results: [], next_cursor: null }));
  await connectTodoist(" test-token ");
  fetchMock.mockClear();
  broadcast.mockClear();
}

describe("Todoist connection", () => {
  it("verifies a token before saving it and never returns it in status", async () => {
    expect(await todoistStatus()).toEqual({ connected: false });
    await connect();
    expect(await todoistStatus()).toEqual({ connected: true });
    expect(secrets.get("todoist-token")).toBe("test-token");
    await disconnectTodoist();
    expect(await todoistStatus()).toEqual({ connected: false });
    expect(broadcast).toHaveBeenCalledWith("todoist:changed", undefined);
  });

  it("keeps a working token if its replacement is rejected", async () => {
    await connect();
    fetchMock.mockResolvedValueOnce(new Response("secret upstream detail", { status: 401 }));
    await expect(connectTodoist("invalid")).rejects.toThrow("Todoist rejected this token");
    expect(secrets.get("todoist-token")).toBe("test-token");
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("rejects invalid tokens and disconnected requests without hitting the network", async () => {
    await expect(connectTodoist("bad\ntoken")).rejects.toThrow("valid Todoist API token");
    await expect(todoistTasks()).rejects.toThrow("Connect Todoist");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([403, 404, 429, 500])(
    "surfaces HTTP %s without exposing upstream contents",
    async (status) => {
      await connect();
      fetchMock.mockResolvedValueOnce(new Response("secret upstream detail", { status }));
      await expect(todoistTasks()).rejects.toThrow(/Todoist/);
    },
  );

  it("reports network failure and does not automatically repeat a write", async () => {
    await connect();
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(completeTodoistTask("one", requestId)).rejects.toThrow("Check your connection");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Todoist projects and tasks", () => {
  it("loads every project page and strips unneeded response fields", async () => {
    await connect();
    fetchMock.mockResolvedValueOnce(
      Response.json({ results: [{ id: "1", name: "Work", secret: "omit" }], next_cursor: "a.b" }),
    );
    fetchMock.mockResolvedValueOnce(
      Response.json({ results: [{ id: "2", name: "Home" }], next_cursor: null }),
    );
    expect(await todoistProjects()).toEqual([
      { id: "1", name: "Work" },
      { id: "2", name: "Home" },
    ]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("cursor=a.b");
  });

  it("does not loop forever on a repeated cursor", async () => {
    await connect();
    fetchMock.mockImplementation(async () => Response.json({ results: [], next_cursor: "a.b" }));
    await expect(todoistProjects()).rejects.toThrow("repeated page");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves project filtering while paginating tasks", async () => {
    await connect();
    const page = { results: [{ id: "one", content: "Task" }], next_cursor: "next.page" };
    fetchMock.mockResolvedValueOnce(Response.json(page));
    expect(await todoistTasks("a&b", "page.one")).toEqual(page);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("project_id")).toBe("a&b");
    expect(url.searchParams.get("cursor")).toBe("page.one");
  });

  it("creates an email task using only explicit notes and a link, with safe retry IDs", async () => {
    await connect();
    fetchMock.mockImplementation(async () => success());
    const input = {
      content: " Follow up ",
      description: "My notes",
      projectId: "work",
      due: "every Monday",
      priority: 4,
      requestId,
      email: { accountId: "me@example.com", messageId: "message-1" },
    };
    await createTodoistTask(input);
    const first = body();
    expect(first).toEqual({
      type: "item_add",
      uuid: requestId,
      temp_id: requestId,
      args: {
        content: "Follow up",
        description:
          "My notes\n\n[Open conversation in Otter Mail](https://mail.otterware.app/me%40example.com/INBOX/message-1)",
        project_id: "work",
        due: { string: "every Monday" },
        priority: 4,
      },
    });
    await createTodoistTask(input);
    expect(body()).toEqual(first);
    const options = fetchMock.mock.calls[0]?.[1];
    expect(options?.headers).toEqual({
      Authorization: "Bearer test-token",
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(options?.credentials).toBe("omit");
    expect(broadcast).toHaveBeenCalledWith("todoist:tasksChanged", undefined);
  });

  it("supports standalone tasks with Todoist's Inbox and normal priority defaults", async () => {
    await connect();
    fetchMock.mockResolvedValueOnce(success());
    await createTodoistTask({ content: "A task", requestId });
    expect(body().args).toEqual({ content: "A task", description: "", priority: 1 });
  });

  it("rejects invalid input and missing source emails before creating anything", async () => {
    await connect();
    await expect(createTodoistTask({ content: " ", requestId })).rejects.toThrow();
    await expect(createTodoistTask({ content: "Task", priority: 5, requestId })).rejects.toThrow();
    await expect(
      createTodoistTask({
        content: "Task",
        requestId,
        email: { accountId: "me@example.com", messageId: "gone" },
      }),
    ).rejects.toThrow("no longer available");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("closes tasks with item_close so recurring tasks advance, and rejects per-command errors", async () => {
    await connect();
    fetchMock.mockResolvedValueOnce(success());
    await completeTodoistTask("recurring-task", requestId);
    expect(body()).toEqual({ type: "item_close", uuid: requestId, args: { id: "recurring-task" } });
    broadcast.mockClear();
    fetchMock.mockResolvedValueOnce(
      Response.json({ sync_status: { [requestId]: { error_code: 20 } } }),
    );
    await expect(completeTodoistTask("gone", requestId)).rejects.toThrow("could not save");
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("acknowledges slow IPC requests immediately and delivers their result as a task event", async () => {
    await connect();
    registerTodoistHandlers(handle);
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const handler = registeredHandlers().get("todoist:tasks")!;
    expect(await handler({ taskId: "ui-task", projectId: "work" })).toEqual({ accepted: true });
    finish(Response.json({ results: [], next_cursor: null }));
    await vi.waitFor(() =>
      expect(broadcast).toHaveBeenCalledWith("task:done", {
        taskId: "ui-task",
        result: { results: [], next_cursor: null },
      }),
    );
  });
});

describe("Todoist task management", () => {
  it("sends server-side filters and preserves them across pages", async () => {
    await connect();
    fetchMock.mockResolvedValueOnce(Response.json({ results: [], next_cursor: null }));
    await todoistTasks(undefined, "a.b", "today | overdue");
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe("/api/v1/tasks/filter");
    expect(url.searchParams.get("query")).toBe("today | overdue");
    expect(url.searchParams.get("cursor")).toBe("a.b");
  });
  it("creates task labels, section and assignee using Sync field names", async () => {
    await connect();
    fetchMock.mockResolvedValueOnce(success());
    await createTodoistTask({
      content: "Task",
      projectId: "work",
      sectionId: "planning",
      assigneeId: "sam",
      labels: ["followup"],
      requestId,
    });
    expect(body().args).toMatchObject({
      section_id: "planning",
      responsible_uid: "sam",
      labels: ["followup"],
    });
  });
  it("edits without moving subtasks and leaves an unchanged due date alone", async () => {
    await connect();
    fetchMock.mockResolvedValueOnce(success());
    await updateTodoistTask({
      id: "child",
      content: "Edited",
      labels: [],
      assigneeId: null,
      requestId,
      moveRequestId: crypto.randomUUID(),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body().type).toBe("item_update");
    expect(body().args).toEqual({
      id: "child",
      content: "Edited",
      labels: [],
      responsible_uid: null,
    });
  });
  it("can clear the due date and resume a failed save after moving", async () => {
    await connect();
    const moveRequestId = crypto.randomUUID();
    fetchMock.mockImplementation(async (_url, options) => {
      const c = JSON.parse((options!.body as URLSearchParams).get("commands")!)[0];
      return Response.json({ sync_status: { [c.uuid]: "ok" } });
    });
    const input = {
      id: "one",
      projectId: "work",
      sectionId: "planning",
      due: "",
      requestId,
      moveRequestId,
    };
    await updateTodoistTask(input);
    const first = JSON.parse(
      (fetchMock.mock.calls[0]![1]!.body as URLSearchParams).get("commands")!,
    )[0];
    expect(first).toEqual({
      type: "item_move",
      uuid: moveRequestId,
      args: { id: "one", section_id: "planning" },
    });
    expect(body().args.due).toBeNull();
    await updateTodoistTask(input);
    expect(
      JSON.parse((fetchMock.mock.calls[2]![1]!.body as URLSearchParams).get("commands")!)[0],
    ).toEqual(first);
  });
  it("adds a timed reminder for the item, then removes it", async () => {
    await connect();
    fetchMock.mockImplementation(async () => success());
    await addTodoistReminder({ itemId: "one", due: "tomorrow at 9am", requestId });
    expect(body()).toMatchObject({
      type: "reminder_add",
      temp_id: requestId,
      args: { item_id: "one", type: "absolute", due: { string: "tomorrow at 9am" } },
    });
    await deleteTodoistReminder("reminder", requestId);
    expect(body()).toEqual({ type: "reminder_delete", uuid: requestId, args: { id: "reminder" } });
  });
  it("loads project-specific sections and collaborators", async () => {
    await connect();
    fetchMock.mockImplementation(async () => Response.json({ results: [], next_cursor: null }));
    await todoistSections("work");
    await todoistCollaborators("a/b");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("project_id=work");
    expect(String(fetchMock.mock.calls[1]![0])).toContain("projects/a%2Fb/collaborators");
  });
});
