import type { Routine } from "@generalpursuit/varys";
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vite-plus/test";

import type { VarysConnection } from "./client.js";
import type { VarysSettings } from "./settings.js";

const saved = vi.hoisted(() => [] as unknown[]);
vi.mock("../../../packages/core/src/services/agent/service.js", () => ({
  saveAgentSettings: async (agent: string, change: unknown) => void saved.push({ agent, change }),
}));

// As varys's routine list view has it.
const routine: Routine = {
  id: "r1",
  title: "Invoices",
  builtIn: false,
  instructions: "File new invoices in Drive",
  trigger: {
    type: "schedule",
    schedule: { type: "interval", everyMs: 3_600_000, anchor: "2026-11-09T08:00:00.000Z" },
  },
  delivery: "each_run",
  model: {},
  mode: "standard",
  budget: { steps: 50, costUsd: 1 },
  connections: [],
  paused: false,
  nextRunAt: "2026-11-09T12:00:00.000Z",
  lastRun: {
    id: "run-1",
    routineId: "r1",
    trigger: "schedule",
    dueAt: "2026-11-09T11:00:00.000Z",
    threadId: "t9",
    state: "ended",
    outcome: "partial",
    missing: "The mailbox needs a sign-in.",
    startedAt: "2026-11-09T11:00:00.000Z",
    endedAt: "2026-11-09T11:00:30.000Z",
  },
  createdAt: "2026-11-01T08:00:00.000Z",
  updatedAt: "2026-11-01T08:00:00.000Z",
};

const routines = vi.hoisted(() => ({
  read: vi.fn(),
  create: vi.fn(),
  edit: vi.fn(),
  delete: vi.fn(),
}));
const { routineTask, varysSchedules } = await import("./schedules.js");
const schedules = varysSchedules("agent-a", {
  client: async () => ({ routines }),
  close: () => {},
} as unknown as VarysConnection);
const settings = {
  enabled: true,
  model: "",
  address: "https://mac.tail1234.ts.net",
  agentId: "agent-1",
  installation: "install-1",
} as VarysSettings;

describe("routineTask", () => {
  it("reads a varys routine", () => {
    expect(routineTask("agent-a", routine)).toEqual({
      provider: "agent-a",
      id: "r1",
      name: "Invoices",
      prompt: "File new invoices in Drive",
      schedule: { kind: "every", everyMs: 3_600_000 },
      enabled: true,
      running: false,
      nextRunAt: Date.parse("2026-11-09T12:00:00.000Z"),
      lastRun: {
        at: Date.parse("2026-11-09T11:00:00.000Z"),
        status: "error",
        error: "The mailbox needs a sign-in.",
        durationMs: 30_000,
      },
      delivery: { kind: "otter", chat: "new" },
    });
  });

  it("shows what Otter can't edit as varys says it", () => {
    const task = routineTask(
      "agent-a",
      {
        ...routine,
        builtIn: true,
        trigger: { type: "new_mail", accounts: ["gmail-1"] },
        delivery: "into_thread",
        threadId: "t3",
      },
      { mutedRoutines: "" },
    );
    expect(task).toMatchObject({
      schedule: { kind: "other", text: "When new mail arrives" },
      managedBy: "varys",
      delivery: { kind: "otter", chat: "one" },
      chats: ["t3"],
    });
    expect(routineTask("agent-a", routine, { mutedRoutines: "r1" }).delivery).toEqual({
      kind: "none",
    });
  });
});

describe("saving a routine", () => {
  const receipt = { requestId: "x", result: { routineId: "r1" } };

  it("sets one up on a schedule in your time zone, its runs each a new chat", async () => {
    routines.create.mockReturnValueOnce(okAsync({ ...receipt, result: { routineId: "r2" } }));
    const id = await schedules.save({ ...settings }, null, {
      name: "Morning brief",
      prompt: "Summarise my inbox",
      schedule: { kind: "cron", expr: "0 8 * * 1-5", tz: "Europe/Berlin" },
      resultsTo: { kind: "new-chat" },
    });
    expect(id).toBe("r2");
    expect(routines.create).toHaveBeenCalledWith({
      title: "Morning brief",
      instructions: "Summarise my inbox",
      trigger: {
        type: "schedule",
        schedule: { type: "cron", cron: "0 8 * * 1-5", zone: "Europe/Berlin" },
      },
      delivery: "each_run",
    });
  });

  it("keeps the times an interval runs at, and keeps results in varys when turned off", async () => {
    routines.read.mockReturnValueOnce(okAsync({ routine, runs: [] }));
    routines.edit.mockReturnValueOnce(okAsync(receipt));
    saved.length = 0;
    await schedules.save({ ...settings }, "r1", {
      name: "Invoices",
      prompt: "File new invoices in Drive",
      schedule: { kind: "every", everyMs: 3_600_000 },
      resultsTo: { kind: "off" },
    });
    expect(routines.edit).toHaveBeenCalledWith("r1", {
      title: "Invoices",
      instructions: "File new invoices in Drive",
      trigger: {
        type: "schedule",
        schedule: { type: "interval", everyMs: 3_600_000, anchor: "2026-11-09T08:00:00.000Z" },
      },
    });
    expect(saved).toEqual([{ agent: "agent-a", change: { mutedRoutines: "r1" } }]);
  });

  it("refuses a schedule that runs once", async () => {
    await expect(
      schedules.save({ ...settings }, null, {
        name: "Once",
        schedule: { kind: "at", at: "2026-11-10T08:00:00.000Z" },
      }),
    ).rejects.toThrow("varys's routines repeat");
  });
});

describe("deleting a routine", () => {
  it("deletes it in varys", async () => {
    routines.delete.mockReturnValueOnce(okAsync({ requestId: "x", result: { routineId: "r1" } }));
    await schedules.remove({ ...settings }, "r1");
    expect(routines.delete).toHaveBeenCalledWith("r1");
  });

  it("says why varys keeps a built-in one", async () => {
    routines.delete.mockReturnValueOnce(
      errAsync({ code: "ROUTINE_BUILT_IN", message: "Dream is built in: pause it instead." }),
    );
    await expect(schedules.remove({ ...settings }, "dream")).rejects.toThrow(
      "Dream is built in: pause it instead.",
    );
  });
});
