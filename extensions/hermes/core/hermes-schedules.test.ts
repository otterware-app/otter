import type { ScheduledTaskInput } from "@otter/contracts/scheduled";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { HermesSettings } from "./settings.js";

const saved = vi.hoisted(() => [] as unknown[]);
const synced = vi.hoisted(() => [] as string[]);
vi.mock("../../../packages/core/src/services/preferences.js", () => ({
  preferenceChanged: (key: string) => void synced.push(key),
}));
vi.mock("../../../packages/core/src/services/agent/service.js", () => ({
  saveAgentSettings: async (agent: string, change: unknown) => void saved.push([agent, change]),
}));
const { hermesAgent, hermesSchedule, hermesTask } = await import("./hermes.js");
const settings = { baseUrl: "https://hermes.test/v1", enabled: true } as HermesSettings;
const secrets = { get: async () => "test-key", set: async () => {}, delete: async () => {} };
const schedules = hermesAgent.create({ id: "hermes-1", secrets }).schedules!;

afterEach(() => vi.unstubAllGlobals());

// As `hermes cron` stores it (cron/jobs.py's create_job).
const job = {
  id: "a1b2c3",
  name: "Morning brief",
  prompt: "Summarise my inbox",
  schedule: { kind: "cron", expr: "0 9 * * 1-5", display: "0 9 * * 1-5" },
  schedule_display: "0 9 * * 1-5",
  enabled: true,
  state: "scheduled",
  next_run_at: "2026-11-09T09:00:00+00:00",
  last_run_at: "2026-11-06T09:00:00+00:00",
  last_status: "error",
  last_error: "Model unavailable",
  deliver: "local",
};

function serve(answer: (url: URL, init: RequestInit) => Response) {
  const calls: { url: URL; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      calls.push({ url, init });
      return answer(url, init);
    }),
  );
  return calls;
}

describe("hermesTask", () => {
  it("reads a Hermes job", () => {
    expect(hermesTask(job, "hermes-1")).toEqual({
      provider: "hermes-1",
      id: "a1b2c3",
      name: "Morning brief",
      prompt: "Summarise my inbox",
      schedule: { kind: "cron", expr: "0 9 * * 1-5" },
      enabled: true,
      running: false,
      nextRunAt: Date.parse("2026-11-09T09:00:00Z"),
      lastRun: {
        at: Date.parse("2026-11-06T09:00:00Z"),
        status: "error",
        error: "Model unavailable",
      },
      delivery: { kind: "otter", chat: "new" },
    });
    expect(hermesTask(job, "hermes-1", { mutedJobs: "x,a1b2c3" }).delivery).toEqual({
      kind: "none",
    });
  });

  it("reads intervals, one-offs, pauses and deliveries", () => {
    expect(
      hermesTask(
        { ...job, schedule: { kind: "interval", minutes: 90 }, deliver: "telegram" },
        "hermes-1",
      ),
    ).toMatchObject({
      schedule: { kind: "every", everyMs: 5_400_000 },
      delivery: { kind: "elsewhere", label: "Telegram" },
    });
    expect(
      hermesTask(
        { ...job, schedule: { kind: "once", run_at: "2026-12-01T10:00:00+00:00" } },
        "hermes-1",
      ).schedule,
    ).toEqual({ kind: "at", at: "2026-12-01T10:00:00+00:00" });
    const paused = hermesTask({ ...job, enabled: false, state: "paused" }, "hermes-1");
    expect(paused.enabled).toBe(false);
    expect(paused.nextRunAt).toBeUndefined();
    expect(hermesTask({ ...job, state: "running" }, "hermes-1").running).toBe(true);
  });
});

describe("hermesSchedule", () => {
  it("writes schedules the way Hermes parses them", () => {
    expect(hermesSchedule({ kind: "cron", expr: "0 9 * * *", tz: "Europe/Paris" })).toBe(
      "0 9 * * *",
    );
    expect(hermesSchedule({ kind: "every", everyMs: 7_200_000 })).toBe("every 120m");
    expect(hermesSchedule({ kind: "at", at: "2026-12-01T10:00:00.000Z" })).toBe(
      "2026-12-01T10:00:00.000Z",
    );
  });
});

describe("Hermes's jobs API", () => {
  it("lists paused jobs too", async () => {
    const calls = serve((url) =>
      url.pathname === "/health/detailed"
        ? Response.json({
            platforms: {
              api_server: { state: "connected" },
              otter: { state: "connected" },
              telegram: { state: "connected" },
              discord: { state: "fatal" },
            },
          })
        : Response.json({ jobs: [job] }),
    );
    const listed = await schedules.list(settings);
    const jobs = calls.find((c) => c.url.pathname === "/api/jobs")!;
    expect(jobs.url.href).toBe("https://hermes.test/api/jobs?include_disabled=true");
    expect((jobs.init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(listed?.tasks).toHaveLength(1);
    expect(listed?.channels).toEqual([{ id: "telegram", label: "Telegram", accounts: [] }]);
    expect(listed?.can).toMatchObject({ create: true, deliverToOtter: true, history: true });
  });

  it("isn't listed until Hermes is set up", async () => {
    const calls = serve(() => Response.json({ jobs: [] }));
    expect(await schedules.list({ ...settings, baseUrl: "" })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("creates, edits, pauses, resumes, runs and deletes", async () => {
    const calls = serve(() => Response.json({ job }));
    expect(
      await schedules.save(settings, null, {
        name: "Brief",
        prompt: "Go",
        schedule: { kind: "every", everyMs: 1_800_000 },
      }),
    ).toBe("a1b2c3");
    calls.length = 0;
    await schedules.save(settings, null, {
      name: "Brief",
      prompt: "Go",
      schedule: { kind: "every", everyMs: 1_800_000 },
    });
    await schedules.save(settings, "a1b2c3", {
      name: "Brief",
      prompt: "Go further",
      schedule: { kind: "cron", expr: "0 9 * * *" },
    });
    await schedules.setEnabled(settings, "a1b2c3", false);
    await schedules.setEnabled(settings, "a1b2c3", true);
    await schedules.runNow(settings, "a1b2c3");
    await schedules.remove(settings, "a1b2c3");
    expect(calls.map((c) => `${c.init.method} ${c.url.pathname}`)).toEqual([
      "POST /api/jobs",
      "GET /api/jobs/a1b2c3",
      "PATCH /api/jobs/a1b2c3",
      "POST /api/jobs/a1b2c3/pause",
      "POST /api/jobs/a1b2c3/resume",
      "POST /api/jobs/a1b2c3/run",
      "DELETE /api/jobs/a1b2c3",
    ]);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: "Brief",
      schedule: "every 30m",
      prompt: "Go",
      deliver: "local",
    });
    expect(JSON.parse(String(calls[2].init.body))).toEqual({
      name: "Brief",
      schedule: "0 9 * * *",
      prompt: "Go further",
    });
  });

  it("doesn't send an unchanged schedule, which would push its next run back", async () => {
    const calls = serve(() => Response.json({ job }));
    await schedules.save(settings, "a1b2c3", {
      name: "Renamed",
      prompt: "Summarise my inbox",
      schedule: { kind: "cron", expr: "0 9 * * 1-5" },
    });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      name: "Renamed",
      prompt: "Summarise my inbox",
    });
  });

  it("says why it failed", async () => {
    serve(() => Response.json({ error: "Cron module not available" }, { status: 501 }));
    await expect(schedules.list(settings)).rejects.toThrow(/doesn't run scheduled tasks/);
    serve(() => Response.json({ error: "Job not found" }, { status: 404 }));
    await expect(schedules.runNow(settings, "gone")).rejects.toThrow(/gone from Hermes/);
    serve(() => Response.json({ error: "Invalid schedule 'x'" }, { status: 400 }));
    await expect(
      schedules.save(settings, null, {
        name: "x",
        prompt: "x",
        schedule: { kind: "cron", expr: "x x x x x" },
      }),
    ).rejects.toThrow("Invalid schedule 'x'");
  });

  it("sends results to Otter, or leaves them on Hermes", async () => {
    const calls = serve(() => Response.json({ job }));
    saved.length = 0;
    const mine = { ...settings, mutedJobs: "" };
    await schedules.save(mine, "a1b2c3", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 9 * * 1-5" },
      resultsTo: { kind: "off" },
    });
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ deliver: "local" });
    expect(saved).toEqual([["hermes-1", { mutedJobs: "a1b2c3" }]]);
    expect(synced).toEqual(["assistant"]);
    await schedules.save(mine, "a1b2c3", {
      name: "Morning brief",
      schedule: { kind: "cron", expr: "0 9 * * 1-5" },
      resultsTo: { kind: "new-chat" },
    });
    expect(saved).toEqual([
      ["hermes-1", { mutedJobs: "a1b2c3" }],
      ["hermes-1", { mutedJobs: "" }],
    ]);
  });

  it("sends results straight to Otter through its plugin, or to another channel", async () => {
    const calls = serve((url) =>
      url.pathname === "/health/detailed"
        ? Response.json({ platforms: { otter: { state: "connected" } } })
        : Response.json({ job }),
    );
    const edit = (resultsTo: ScheduledTaskInput["resultsTo"]) =>
      schedules.save({ ...settings }, "a1b2c3", {
        name: "Morning brief",
        schedule: { kind: "cron", expr: "0 9 * * 1-5" },
        resultsTo,
      });
    const sent = () =>
      JSON.parse(String(calls.findLast((c) => c.init.method === "PATCH")!.init.body));
    await edit({ kind: "new-chat" });
    expect(sent()).toMatchObject({ deliver: "otter" });
    await edit({ kind: "channel", channel: "telegram", to: "-100123" });
    expect(sent()).toMatchObject({ deliver: "telegram:-100123" });
    expect(hermesTask({ ...job, deliver: "otter" }, "hermes-1").delivery).toEqual({
      kind: "otter",
      chat: "new",
    });
    expect(hermesTask({ ...job, deliver: "telegram:-100123" }, "hermes-1").delivery).toEqual({
      kind: "channel",
      channel: "telegram",
      label: "Telegram",
      to: "-100123",
    });
  });

  it("lists past runs, each with its transcript", async () => {
    const at = Date.parse("2026-11-08T09:00:00Z") / 1000;
    const calls = serve((url) => {
      if (url.pathname === "/api/jobs/a1b2c3") return Response.json({ job });
      if (url.pathname === "/api/sessions")
        return Response.json({
          data: [
            {
              id: "local-1",
              title: "Morning brief · Nov 08 09:00",
              started_at: at,
              ended_at: at + 42,
              end_reason: "cron_complete",
              model: "gpt-5",
            },
            {
              id: "cron_a1b2c3_20261107_090000",
              started_at: at - 86_400,
              ended_at: at - 86_380,
              end_reason: "cron_incomplete_no_output",
            },
            { id: "local-2", title: "Other job · Nov 08 09:00", started_at: at, ended_at: at + 1 },
            { id: "local-3", title: "Morning brief · Nov 09 09:00", started_at: at + 86_400 },
          ],
        });
      return Response.json({
        data: [
          { role: "user", content: "[IMPORTANT: scheduled] Summarise my inbox" },
          { role: "assistant", content: "Three new threads." },
        ],
      });
    });
    expect(await schedules.runs!(settings, "a1b2c3", 10)).toEqual([
      { id: "local-1", at: at * 1000, status: "ok", durationMs: 42_000, model: "gpt-5" },
      {
        id: "cron_a1b2c3_20261107_090000",
        at: (at - 86_400) * 1000,
        status: "error",
        durationMs: 20_000,
        error: "It finished without a result.",
      },
    ]);
    expect(calls.find((c) => c.url.pathname === "/api/sessions")?.url.search).toBe(
      "?source=cron&limit=200",
    );
    expect(await schedules.runTranscript!(settings, "a1b2c3", "local-1")).toEqual([
      { role: "assistant", text: "Three new threads." },
    ]);
  });
});
