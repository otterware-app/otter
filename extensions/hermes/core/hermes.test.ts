import type { AgentRun, ChatEvent } from "@otter/core/extension-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { HermesSettings } from "./settings.js";

const files = vi.hoisted(() => new Map<string, string>());
vi.mock("../../../packages/core/src/platform.js", () => ({
  platform: () => ({
    kind: "desktop",
    appVersion: "test",
    log: () => {},
    files: {
      read: async (name: string) =>
        files.has(name) ? new TextEncoder().encode(files.get(name)) : null,
      write: async (name: string, data: string) => void files.set(name, data),
    },
  }),
}));
const current = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }));
vi.mock("../../../packages/core/src/services/agent/service.js", () => ({
  saveAgentSettings: vi.fn(async () => {}),
  agentSettings: async () => current.settings,
}));
const { hermesAgent } = await import("./hermes.js");
const secrets = { get: async () => "test-key", set: async () => {}, delete: async () => {} };
const create = (id = "hermes-1") => hermesAgent.create({ id, secrets });
let hermes = create();
const settings = {
  baseUrl: "https://hermes.test/v1",
  agentModel: "hermes",
  sessions: true,
  model: "",
  reasoningEffort: "",
  serviceTier: "",
} as HermesSettings;

type Frame = Record<string, unknown>;
type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;

function sse(frames: Frame[], first = 0): Response {
  return new Response(
    `: open\n\n${frames.map((f, i) => `id: ${first + i}\ndata: ${JSON.stringify({ ...f, seq: first + i })}\n\n`).join("")}`,
  );
}

let calls: { url: URL; init: RequestInit }[] = [];
function serve(routes: Record<string, Route>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      calls.push({ url, init });
      const key = `${init.method ?? "GET"} ${url.pathname}`;
      const route = routes[key];
      if (!route) return Response.json({ error: "not found" }, { status: 404 });
      return route(url, init);
    }),
  );
}

beforeEach(() => {
  files.clear();
  hermes = create();
});
afterEach(() => {
  hermes.shutdown();
  vi.unstubAllGlobals();
});

function replies(events: ChatEvent[]): string[] {
  const text = new Map<string, string>();
  for (const event of events) {
    if (event.type === "delta") text.set(event.id!, (text.get(event.id!) ?? "") + event.text);
    else if (event.type === "text") text.set(event.id, event.text);
  }
  return [...text.values()];
}

async function send(
  input: { requestId?: string; sessionId?: string; previousResponseId?: string } = {},
) {
  const events: ChatEvent[] = [];
  await hermes.sendTurn(
    { requestId: "req-1", input: "Check", sessionId: "session-1", ...input },
    settings,
    (event) => events.push(event),
  );
  return events;
}

const started = { "POST /v1/runs": () => Response.json({ run_id: "run-1", status: "started" }) };

describe("Hermes replies", () => {
  it("runs into the chat's session, once per message", async () => {
    serve({
      ...started,
      "GET /v1/runs/run-1/events": () =>
        sse([
          { event: "message.delta", delta: "Done." },
          { event: "run.completed", output: "Done." },
        ]),
    });
    const events = await send();
    const post = calls[0];
    expect(post.url.pathname).toBe("/v1/runs");
    expect((post.init.headers as Record<string, string>)["Idempotency-Key"]).toBe("req-1");
    expect(JSON.parse(String(post.init.body))).toEqual({ input: "Check", session_id: "session-1" });
    expect(replies(events)).toEqual(["Done."]);
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "done", responseId: null });
  });

  it("tells the agent about Otter's chats when Hermes has Otter's plugin", async () => {
    serve({
      "GET /v1/models": () => Response.json({ data: [{ id: "hermes-agent" }] }),
      "GET /api/sessions": () => Response.json({ data: [] }),
      "GET /health/detailed": () => Response.json({ platforms: { otter: { state: "connected" } } }),
      ...started,
      "GET /v1/runs/run-1/events": () => sse([{ event: "run.completed", output: "Done." }]),
    });
    expect((await hermes.checkStatus(settings)).status).toBe("ready");
    await send();
    const body = JSON.parse(String(calls.find((c) => c.url.pathname === "/v1/runs")!.init.body));
    expect(body.instructions).toContain('"otter:session-1": this chat.');
    expect(body.instructions).toContain('"otter:new"');
  });

  it("keeps commentary when the final reply has no deltas", async () => {
    serve({
      ...started,
      "GET /v1/runs/run-1/events": () =>
        sse([
          { event: "message.interim", text: "I'll check." },
          { event: "tool.started", tool: "browser", preview: "example.com", tool_call_id: "c1" },
          { event: "tool.completed", tool: "browser", tool_call_id: "c1", preview: "ok" },
          { event: "run.completed", output: "Done." },
        ]),
    });
    const events = await send();
    expect(replies(events)).toEqual(["I'll check.", "Done."]);
    expect(events.find((e) => e.type === "toolResult")).toMatchObject({ id: "c1", output: "ok" });
  });

  it("backfills a resolved image without duplicating streamed commentary", async () => {
    serve({
      ...started,
      "GET /v1/runs/run-1/events": () =>
        sse([
          { event: "message.delta", delta: "I'll check." },
          { event: "message.interim", text: "I'll check.", already_streamed: true },
          { event: "tool.started", tool: "browser" },
          { event: "message.delta", delta: "Done.\nMEDIA:/tmp/image.png" },
          { event: "run.completed", output: "Done.\n![image](data:image/png;base64,aGVsbG8=)" },
        ]),
    });
    expect(replies(await send())).toEqual([
      "I'll check.",
      "Done.\n![image](data:image/png;base64,aGVsbG8=)",
    ]);
  });

  it("follows a dropped stream again from its last event", async () => {
    let attempt = 0;
    serve({
      ...started,
      "GET /v1/runs/run-1": () => Response.json({ run_id: "run-1", status: "running" }),
      "GET /v1/runs/run-1/events": (url) =>
        attempt++ === 0
          ? sse([
              { event: "message.delta", delta: "Half " },
              { event: "message.delta", delta: "way" },
            ])
          : sse(
              [
                { event: "message.delta", delta: " there." },
                { event: "run.completed", output: "Half way there." },
              ],
              Number(url.searchParams.get("last_seq")) + 1,
            ),
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const sending = send();
      await vi.advanceTimersByTimeAsync(5_000);
      const events = await sending;
      expect(
        calls.filter((c) => c.url.pathname.endsWith("/events")).map((c) => c.url.search),
      ).toEqual(["?last_seq=-1", "?last_seq=1"]);
      expect(replies(events)).toEqual(["Half way there."]);
      expect(events.at(-1)?.type).toBe("done");
    } finally {
      vi.useRealTimers();
    }
  });

  it("names a new chat as Hermes does", async () => {
    serve({
      "POST /api/sessions": () => Response.json({ session: { id: "session-9" } }),
      ...started,
      "GET /v1/runs/run-1/events": () => sse([{ event: "run.completed", output: "Hi." }]),
      "GET /api/sessions/session-9": () =>
        Response.json({ session: { id: "session-9", title: "Greeting the user" } }),
    });
    const events = await send({ sessionId: undefined });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ source: "api_server" });
    expect(events.map((e) => e.type)).toEqual(["session", "delta", "title", "done"]);
    expect(events.find((e) => e.type === "title")).toMatchObject({ title: "Greeting the user" });
  });

  it("asks before a command, and hears when it was answered elsewhere", async () => {
    serve({
      ...started,
      "GET /v1/runs/run-1/events": () =>
        sse([
          {
            event: "approval.request",
            request_id: "ap-1",
            command: "rm -rf build",
            choices: ["once", "deny"],
          },
          { event: "approval.responded", request_id: "ap-1", choice: "once" },
          { event: "run.completed", output: "Removed." },
        ]),
    });
    const events = await send();
    expect(events.find((e) => e.type === "approval")).toMatchObject({
      approval: { id: "ap-1", detail: "rm -rf build", choices: ["once", "deny"] },
    });
    expect(events.filter((e) => e.type === "approvalResolved")).toHaveLength(1);
  });

  it("says how a run ended without a reply", async () => {
    serve({
      ...started,
      "GET /v1/runs/run-1/events": () =>
        sse([{ event: "run.failed", error: "Model unavailable", completed: false }]),
    });
    expect((await send()).at(-1)).toMatchObject({
      type: "error",
      message: "agent_error: Model unavailable",
    });
  });

  it("preserves completed commentary items in Responses chats", async () => {
    serve({
      "POST /v1/responses": () =>
        new Response(
          [
            {
              type: "response.output_item.added",
              item: {
                id: "intro",
                type: "message",
                content: [{ type: "output_text", text: "I'll check." }],
              },
            },
            { type: "response.output_item.added", item: { id: "answer", type: "message" } },
            { type: "response.output_text.delta", delta: "Done." },
            { type: "response.completed", response: { id: "response" } },
          ]
            .map((e) => `data: ${JSON.stringify(e)}\n\n`)
            .join(""),
        ),
    });
    const events = await send({ sessionId: undefined, previousResponseId: "previous" });
    expect(replies(events)).toEqual(["I'll check.", "Done."]);
    expect(events.at(-1)).toMatchObject({ type: "done", responseId: "response" });
  });
});

describe("A run picked up again", () => {
  async function resume(requestId: string) {
    const events: ChatEvent[] = [];
    await hermes.resume!({ requestId, sessionId: "session-1" }, settings, (event) =>
      events.push(event),
    );
    return events;
  }

  it("replays the run this device started, from its first event", async () => {
    files.set(
      "hermes-runs.json",
      JSON.stringify({
        "hermes-1": { "req-7": { runId: "run-7", sessionId: "session-1", at: Date.now() } },
      }),
    );
    serve({
      "GET /v1/runs/run-7/events": () =>
        sse([
          { event: "tool.started", tool: "terminal", preview: "make" },
          { event: "message.delta", delta: "Built." },
          { event: "run.completed", output: "Built." },
        ]),
    });
    const events = await resume("req-7");
    expect(calls[0].url.search).toBe("?last_seq=-1");
    expect(events[0]).toEqual({ requestId: "req-7", type: "transcript", messages: [] });
    expect(replies(events)).toEqual(["Built."]);
    expect(events.at(-1)?.type).toBe("done");
    expect(JSON.parse(files.get("hermes-runs.json")!)).toEqual({});
  });

  it("reads the session when the gateway has forgotten the run", async () => {
    files.set(
      "hermes-runs.json",
      JSON.stringify({
        "hermes-1": { "req-7": { runId: "run-7", sessionId: "session-1", at: Date.now() } },
      }),
    );
    serve({
      "GET /api/sessions/session-1/messages": () =>
        Response.json({
          data: [
            { role: "user", content: "Build it" },
            { role: "assistant", content: "", tool_calls: [{ function: { name: "terminal" } }] },
            { role: "tool", content: "ok", tool_name: "terminal" },
            { role: "assistant", content: "Built." },
          ],
        }),
    });
    const events = await resume("req-7");
    expect(events[1]).toMatchObject({ type: "transcript" });
    const transcript = events[1] as Extract<ChatEvent, { type: "transcript" }>;
    expect(transcript.messages.map((m) => m.role)).toEqual(["assistant", "tool", "assistant"]);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("is another agent's run to pick up, not this one's", async () => {
    files.set(
      "hermes-runs.json",
      JSON.stringify({
        "hermes-1": { "req-7": { runId: "run-7", sessionId: "session-1", at: Date.now() } },
      }),
    );
    serve({
      "GET /api/sessions/session-1/messages": () =>
        Response.json({ data: [{ role: "user", content: "Build it" }] }),
    });
    const other = create("hermes-2");
    const events: ChatEvent[] = [];
    await other.resume!({ requestId: "req-7", sessionId: "session-1" }, settings, (event) =>
      events.push(event),
    );
    expect(calls.map((c) => c.url.pathname)).toEqual(["/api/sessions/session-1/messages"]);
    expect(events.at(-1)).toMatchObject({ message: "detached" });
  });

  it("shows what another device's run wrote, or waits for it", async () => {
    serve({
      "GET /api/sessions/session-1/messages": () =>
        Response.json({ data: [{ role: "user", content: "Build it" }] }),
    });
    expect((await resume("req-elsewhere")).at(-1)).toMatchObject({ message: "detached" });
    serve({
      "GET /api/sessions/session-1/messages": () =>
        Response.json({
          data: [
            { role: "user", content: "Build it" },
            { role: "assistant", content: "Built." },
          ],
        }),
    });
    expect((await resume("req-elsewhere")).map((e) => e.type)).toEqual(["transcript", "done"]);
  });

  it("lets a run go on when the app closes", async () => {
    serve({
      ...started,
      "GET /v1/runs/run-1/events": (_url, init) =>
        new Response(
          new ReadableStream({
            start: (stream) =>
              init.signal?.addEventListener("abort", () => stream.error(new Error("aborted"))),
          }),
        ),
    });
    const sending = send();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    hermes.shutdown();
    const events = await sending;
    expect(events.at(-1)).toMatchObject({ type: "error", message: "detached" });
    expect(calls.some((c) => c.url.pathname.endsWith("/stop"))).toBe(false);
    expect(JSON.parse(files.get("hermes-runs.json")!)).toMatchObject({
      "hermes-1": { "req-1": { runId: "run-1" } },
    });
  });
});

describe("Scheduled runs that come to Otter", () => {
  const now = Date.now() / 1000;
  const jobs = [
    { id: "a1b2c3", name: "Morning brief", deliver: "local", schedule_display: "0 9 * * *" },
    { id: "d4e5f6", name: "Alerts", deliver: "telegram" },
  ];
  const run = (id: string, title: string, ended: number | null = now - 60) => ({
    id,
    source: "cron",
    title,
    started_at: now - 120,
    ended_at: ended,
    end_reason: ended ? "cron_complete" : null,
  });
  const replyTo = (id: string) => (id === "local-quiet" ? "[SILENT]" : `Report ${id}`);
  const commentary = (id: string) =>
    id === "local-quiet" ? [{ role: "assistant", content: "Checking your inbox." }] : [];

  function watch(
    sessions: ReturnType<typeof run>[],
    watched: string[] = [],
    options: Partial<HermesSettings> = {},
  ) {
    serve({
      "GET /api/sessions": (url) =>
        Response.json({ data: url.searchParams.get("source") === "cron" ? sessions : [] }),
      "GET /api/jobs": () => Response.json({ jobs }),
      ...Object.fromEntries(
        sessions.map((s) => [
          `GET /api/sessions/${s.id}/messages`,
          () =>
            Response.json({
              data: [
                { role: "user", content: "[IMPORTANT: You are running as a scheduled cron job.]" },
                ...commentary(s.id),
                { role: "assistant", content: replyTo(s.id) },
              ],
            }),
        ]),
      ),
    });
    const runs: AgentRun[] = [];
    current.settings = { ...settings, ...options };
    hermes.watch!(
      { ...settings, ...options },
      watched.map((id) => ({ id, since: 0 })),
      (r) => runs.push(r),
    );
    return runs;
  }

  it("starts a chat for each finished run of a job that keeps its results", async () => {
    const runs = watch(
      [
        run("cron_a1b2c3_20261109_090000", "Morning brief · Nov 09 09:00"),
        run("local-abc", "Morning brief · Nov 08 09:00"),
        run("local-running", "Morning brief · Nov 09 10:00", null),
        run("local-quiet", "Morning brief · Nov 07 09:00"),
        run("local-telegram", "Alerts · Nov 09 09:00"),
        run("local-old", "Morning brief · Nov 01 09:00", now - 9 * 86_400),
        run("local-shown", "Morning brief · Nov 06 09:00"),
      ],
      ["local-shown"],
    );
    await vi.waitFor(() => expect(runs).toHaveLength(2));
    expect(runs.map((r) => r.sessionId)).toEqual(["cron_a1b2c3_20261109_090000", "local-abc"]);
    expect(runs[0]).toMatchObject({
      requestId: "delivered:cron_a1b2c3_20261109_090000",
      chat: { title: expect.stringMatching(/^Morning brief · /) },
      delivery: {
        kind: "automation",
        jobId: "a1b2c3",
        name: "Morning brief",
        schedule: "0 9 * * *",
      },
    });
  });

  it("leaves a job's results on Hermes when Otter was told to", async () => {
    const runs = watch([run("local-muted", "Morning brief · Nov 09 09:00")], [], {
      mutedJobs: "a1b2c3",
    });
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runs).toEqual([]);
  });

  it("is that run's reply in its chat, without the prompt Hermes sent it", async () => {
    serve({
      "GET /api/sessions/local-abc/messages": () =>
        Response.json({
          data: [
            { role: "user", content: "[IMPORTANT: scheduled]" },
            { role: "assistant", content: "Good morning." },
          ],
        }),
    });
    const events: ChatEvent[] = [];
    await hermes.resume!(
      { requestId: "delivered:local-abc", sessionId: "local-abc" },
      settings,
      (e) => events.push(e),
    );
    expect(events).toEqual([
      {
        requestId: "delivered:local-abc",
        type: "transcript",
        messages: [{ role: "assistant", text: "Good morning." }],
      },
      { requestId: "delivered:local-abc", type: "done", responseId: null },
    ]);
  });
});

describe("What Hermes sends to Otter", () => {
  const now = Date.now() / 1000;
  const jobs = [
    { id: "a1b2c3", name: "Morning brief", deliver: "otter", schedule_display: "0 9 * * *" },
  ];

  it("starts a chat for what its plugin delivered", async () => {
    serve({
      "GET /api/sessions": (url) =>
        Response.json({
          data:
            url.searchParams.get("source") === "otter"
              ? [
                  { id: "otter-1", source: "otter", title: "Morning brief #3", last_active: now },
                  { id: "otter-2", source: "otter", title: "Hermes #2", last_active: now },
                ]
              : [],
        }),
      "GET /api/jobs": () => Response.json({ jobs }),
      "GET /api/sessions/otter-1/messages": () =>
        Response.json({ data: [{ id: 1, role: "assistant", content: "Three new threads." }] }),
      "GET /api/sessions/otter-2/messages": () =>
        Response.json({ data: [{ id: 1, role: "assistant", content: "The build finished." }] }),
    });
    current.settings = settings;
    const runs: AgentRun[] = [];
    hermes.watch!(settings, [], (r) => runs.push(r));
    await vi.waitFor(() => expect(runs).toHaveLength(2));
    expect(runs[0]).toMatchObject({
      sessionId: "otter-1",
      requestId: "delivered:otter-1",
      chat: { title: expect.stringMatching(/^Morning brief · /) },
      delivery: { kind: "automation", jobId: "a1b2c3", name: "Morning brief" },
    });
    expect(runs[1]).toMatchObject({
      chat: { title: expect.stringMatching(/^Hermes · /) },
      delivery: { kind: "message", from: "Hermes" },
    });
  });

  it("shows what it wrote into a chat on its own, not the replies to your messages", async () => {
    let rows = [
      { id: 7, role: "user", content: "Watch the build" },
      { id: 8, role: "assistant", content: "Watching." },
    ];
    let active = now;
    serve({
      "GET /api/sessions": (url) =>
        Response.json({
          data: url.searchParams.get("source") ? [] : [{ id: "chat-1", last_active: active }],
        }),
      "GET /api/jobs": () => Response.json({ jobs: [] }),
      "GET /api/sessions/chat-1/messages": () => Response.json({ data: rows }),
    });
    current.settings = settings;
    const runs: AgentRun[] = [];
    const reads: string[] = [];
    const watch = (cursor?: string) =>
      hermes.watch!(
        settings,
        [{ id: "chat-1", since: 0, ...(cursor && { cursor }) }],
        (r) => runs.push(r),
        (_id, at) => reads.push(at),
      );
    watch();
    await vi.waitFor(() => expect(reads).toEqual(["8"]));
    expect(runs).toEqual([]);

    rows = [...rows, { id: 9, role: "assistant", content: "The build passed." }];
    active += 60;
    hermes.delivered!(settings);
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0]).toMatchObject({
      sessionId: "chat-1",
      requestId: "delivered:chat-1@8",
      delivery: { kind: "message", from: "Hermes" },
    });
    expect(reads).toEqual(["8", "9"]);

    rows = [
      ...rows,
      { id: 10, role: "user", content: "Thanks" },
      { id: 11, role: "assistant", content: "Any time." },
    ];
    active += 60;
    hermes.delivered!(settings);
    await vi.waitFor(() => expect(reads).toEqual(["8", "9", "11"]));
    expect(runs).toHaveLength(1);

    const events: ChatEvent[] = [];
    await hermes.resume!({ requestId: "delivered:chat-1@8", sessionId: "chat-1" }, settings, (e) =>
      events.push(e),
    );
    expect(events[0]).toMatchObject({
      type: "transcript",
      messages: [{ role: "assistant", text: "The build passed." }],
    });
  });

  it("tells a delivery right after your turn from the turn itself", async () => {
    // The delivery is in before the turn has said it's done.
    const rows = [
      { id: 10, role: "user", content: "Check" },
      { id: 11, role: "assistant", content: "Done." },
      { id: 12, role: "assistant", content: "Also: the deploy finished." },
    ];
    let active = now;
    serve({
      ...started,
      "GET /v1/runs/run-1/events": () => sse([{ event: "run.completed", output: "Done." }]),
      "GET /api/sessions": (url) =>
        Response.json({
          data: url.searchParams.get("source") ? [] : [{ id: "session-1", last_active: active }],
        }),
      "GET /api/jobs": () => Response.json({ jobs: [] }),
      "GET /api/sessions/session-1/messages": (url) =>
        Response.json({ data: url.searchParams.get("limit") === "1" ? rows.slice(-1) : rows }),
    });
    current.settings = settings;
    const runs: AgentRun[] = [];
    const reads: string[] = [];
    hermes.watch!(
      settings,
      [{ id: "session-1", since: Number.MAX_SAFE_INTEGER }],
      (r) => runs.push(r),
      (_id, at) => reads.push(at),
    );
    await send();
    active += 60;
    hermes.watch!(
      settings,
      [{ id: "session-1", since: Date.now(), cursor: "9" }],
      (r) => runs.push(r),
      (_id, at) => reads.push(at),
    );
    hermes.delivered!(settings);
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0].requestId).toBe("delivered:session-1@11");
  });

  it("catches a chat it hasn't read yet up on what came after its last turn", async () => {
    const since = Date.now() - 60_000;
    serve({
      "GET /api/sessions": (url) =>
        Response.json({
          data: url.searchParams.get("source") ? [] : [{ id: "chat-2", last_active: now }],
        }),
      "GET /api/jobs": () => Response.json({ jobs: [] }),
      "GET /api/sessions/chat-2/messages": () =>
        Response.json({
          data: [
            { id: 3, role: "user", content: "Hi", timestamp: since / 1000 - 30 },
            { id: 4, role: "assistant", content: "Hello.", timestamp: since / 1000 - 20 },
            { id: 5, role: "assistant", content: "Your report is ready.", timestamp: now },
          ],
        }),
    });
    current.settings = settings;
    const runs: AgentRun[] = [];
    hermes.watch!(settings, [{ id: "chat-2", since }], (r) => runs.push(r));
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0].requestId).toBe("delivered:chat-2@4");
  });

  it("takes a newer message of yours from another of Hermes's apps for a turn", async () => {
    const since = Date.now() - 60_000;
    serve({
      "GET /api/sessions": (url) =>
        Response.json({
          data: url.searchParams.get("source") ? [] : [{ id: "chat-3", last_active: now }],
        }),
      "GET /api/jobs": () => Response.json({ jobs: [] }),
      "GET /api/sessions/chat-3/messages": () =>
        Response.json({
          data: [
            { id: 3, role: "user", content: "From the CLI", timestamp: now - 5 },
            { id: 4, role: "assistant", content: "Answered there.", timestamp: now },
          ],
        }),
    });
    current.settings = settings;
    const runs: AgentRun[] = [];
    const reads: string[] = [];
    hermes.watch!(
      settings,
      [{ id: "chat-3", since }],
      (r) => runs.push(r),
      (_id, at) => reads.push(at),
    );
    await vi.waitFor(() => expect(reads).toEqual(["4"]));
    expect(runs).toEqual([]);
  });
});

describe("The sessions listed", () => {
  const row = (id: string, source: string, lastActive: number) => ({
    id,
    source,
    title: id,
    last_active: lastActive,
  });
  const sessions = [
    row("chat-old", "api_server", 100),
    row("slack-dm", "slack", 400),
    row("delivered", "otter", 300),
    row("chat-new", "api_server", 500),
    row("cron-run", "cron", 600),
  ];
  beforeEach(() =>
    serve({
      "GET /api/sessions": (url) => {
        const source = url.searchParams.get("source");
        return Response.json({
          data: sessions
            .filter((s) => !source || s.source === source)
            .sort((a, b) => b.last_active - a.last_active)
            .slice(0, Number(url.searchParams.get("limit"))),
        });
      },
    }),
  );

  it("are Otter's own, newest first: the chats started here and what Hermes sent", async () => {
    expect(hermes.otherSessions).toBe(true);
    expect((await hermes.listSessions(settings, 2)).map((s) => s.id)).toEqual([
      "chat-new",
      "delivered",
    ]);
    expect(calls.map((c) => c.url.search).sort()).toEqual([
      "?source=api_server&limit=2",
      "?source=otter&limit=2",
    ]);
    expect((await hermes.listSessions(settings, 10)).map((s) => s.id)).toEqual([
      "chat-new",
      "delivered",
      "chat-old",
    ]);
  });

  it("are every one when asked for those from elsewhere", async () => {
    expect((await hermes.listSessions(settings, 10, true)).map((s) => s.id)).toEqual([
      "cron-run",
      "chat-new",
      "slack-dm",
      "delivered",
      "chat-old",
    ]);
    expect(calls.map((c) => c.url.search)).toEqual(["?limit=10"]);
  });
});
