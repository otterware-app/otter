/**
 * The made-up agents (the iPhone Agents app's DemoAgent.swift): every kind keeps its own settings
 * and face, but answers from a script with the steps, approvals and questions a real one has, so
 * every part of a chat can be tried without an agent. "ask" or "plan" asks questions first; "send",
 * "run" or "approve" asks before a step; "delegate" waits on a subagent (on two with "both");
 * "fail" fails; "take your time" takes its time. A steer is read after the step running when it's
 * sent; one still unread when the run ends comes back. An OpenClaw gateway's sessions are on its
 * agents, Molty (`main`) and Scout (`research`), and Studio has the session of one chat whose
 * gateway was removed. Files open by what they are (files.ts); sessions not yet chats are in
 * sessions.ts.
 */
import type { CoreExtension } from "../extensions.ts";
import type {
  AgentSettings,
  ApprovalDecision,
  ChatProvider,
  Emit,
  SendTurnInput,
  ToolStep,
} from "../services/agent/types.ts";
import { DEMO_AGENTS, DEMO_MODELS, gatewaySession } from "./chats.ts";
import { readFakeFile } from "./files.ts";
import { fakeSession, fakeSessions } from "./sessions.ts";
import { scriptedSchedules } from "./schedules.ts";

/** Each kind of agent the extensions bring, run by the script. */
export function withFakeAgents(extensions: readonly CoreExtension[]): CoreExtension[] {
  return extensions.map((extension) => ({
    ...extension,
    activate: (context) =>
      extension.activate({
        ...context,
        registerAgent: (type) =>
          context.registerAgent({
            ...type,
            create: (agent) =>
              scriptedAgent(agent.id, type.kind) as unknown as ReturnType<typeof type.create>,
          }),
      }),
  }));
}

const SKILLS = [
  {
    name: "triage",
    description: "Sort today's mail into what needs you and what doesn't",
    category: "Mail",
  },
  { name: "brief", description: "A morning brief of mail and calendar", category: "Mail" },
  { name: "draft-reply", description: "Draft a reply in your voice", category: "Writing" },
];

const FINAL = `Here's where things stand.

## What's decided

- Offline search ships **before the redesign**
- Thursday's meeting moves to **2pm**, as Tom asked

## Still open

| Item | Owner | Due |
| --- | --- | --- |
| Hiring plan | You | Wed |
| Agenda | Priya | Thu |

Source: [the draft agenda](notes/q4-agenda.md).

If you want, I can draft the note to the team:

\`\`\`sh
gog draft --to platform@acme.example --subject "Q4 planning at 2pm"
\`\`\`

Say *send it* and I'll ask before it goes out.`;

/** What each kind's settings page reads of a connected agent, beside its settings. */
const SETTINGS_VIEW: Record<string, Record<string, unknown>> = {
  openclaw: {
    hasToken: true,
    pairingRequest: null,
    fullAccess: { allowed: true, request: null },
    owner: true,
  },
  hermes: { hasKey: true },
  varys: { paired: true, relay: "off" },
};

const setup = (model: string | null) => ({
  model,
  fallbacks: null,
  thinking: null,
  fast: null,
  utilityModel: null,
});

const THINKING = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

/** What each kind's settings page asks of a connected agent beyond chatting: OpenClaw's gateway agents and their models. */
const SETTINGS_CALLS: Record<string, Record<string, unknown>> = {
  openclaw: {
    models: async () => ({
      defaults: setup("anthropic/claude-opus-5.5"),
      agents: [
        { id: "main", name: "Molty", avatar: null, emoji: null, ...setup(null) },
        { id: "research", name: "Scout", avatar: null, emoji: "🔭", ...setup("openai/gpt-5.5") },
      ],
      models: [
        {
          id: "anthropic/claude-opus-5.5",
          name: "Claude Opus 5.5",
          thinkingLevels: THINKING,
          thinkingDefault: "medium",
          fast: false,
        },
        {
          id: "openai/gpt-5.5",
          name: "GPT-5.5",
          thinkingLevels: THINKING,
          thinkingDefault: "medium",
          fast: true,
        },
      ],
    }),
    change: async () => {},
  },
};

/** The gateway's agent a new chat starts on, as OpenClaw picks it: the chosen one while it's on, else the first on. */
function startingAgent(id: string, settings: AgentSettings): string {
  const { model, disabledAgents } = settings as { model?: string; disabledAgents?: string[] };
  const off = new Set(disabledAgents);
  const agents = (DEMO_MODELS[id] ?? []).map((m) => m.slug);
  return [model, ...agents].find((a) => a && !off.has(a)) ?? "main";
}

export function scriptedAgent(id: string, kind: string): ChatProvider<AgentSettings> {
  const runs = new Map<string, AbortController>();
  const steers = new Map<string, string[]>();
  const waiting = new Map<string, (answer: string) => void>();

  const asked = (key: string, signal: AbortSignal) =>
    new Promise<string>((resolve) => {
      waiting.set(key, resolve);
      signal.addEventListener("abort", () => resolve("deny"), { once: true });
    });

  async function run(
    input: SendTurnInput,
    settings: AgentSettings,
    emit: Emit,
    signal: AbortSignal,
  ): Promise<boolean> {
    const { requestId } = input;
    const pause = (ms: number) =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(true), ms);
        signal.addEventListener("abort", () => (clearTimeout(timer), resolve(false)), {
          once: true,
        });
      });
    const say = async (text: string) => {
      for (const word of text.split(" ")) {
        if (!(await pause(28))) return false;
        emit({ requestId, type: "delta", text: `${word} ` });
      }
      return true;
    };
    const look = async (stepId: string, toolStep: ToolStep, output: string, ms: number) => {
      emit({ requestId, type: "tool", id: stepId, step: toolStep });
      if (!(await pause(ms))) return false;
      emit({ requestId, type: "toolResult", id: stepId, output });
      return true;
    };
    const step = async (stepId: string, toolStep: ToolStep, output: string, ms: number) => {
      if (!(await look(stepId, toolStep, output, ms))) return false;
      for (const [i, steer] of (steers.get(requestId)?.splice(0) ?? []).entries()) {
        const search = {
          kind: "search" as const,
          title: `Searched mail for “${steer.slice(0, 28)}”`,
        };
        if (
          !(await say(`Noted: “${steer.slice(0, 60)}”. Let me check that first.`)) ||
          !(await look(`${stepId}-steer-${i}`, search, '{"threads": 2}', 900))
        )
          return false;
      }
      return true;
    };

    if (!input.sessionId) {
      const session = `demo-${requestId.slice(0, 8)}`;
      emit({
        requestId,
        type: "session",
        sessionId:
          kind === "openclaw" ? gatewaySession(startingAgent(id, settings), session) : session,
      });
    }
    const text = input.input.toLowerCase();
    if (!(await pause(500))) return false;
    if (text.includes("fail")) {
      emit({
        requestId,
        type: "error",
        message: "The agent stopped answering: the request timed out.",
      });
      return false;
    }
    if (text.includes("delegate")) {
      const subagents = text.includes("both")
        ? ["Research venue prices", "Check flight times"]
        : ["Research venue prices"];
      if (!(await say(`I'll hand ${subagents.length > 1 ? "these" : "this"} off and wait.`)))
        return false;
      emit({ requestId, type: "waiting", subagents });
      if (!(await pause(6_000))) return false;
      emit({ requestId, type: "waiting", subagents: null });
      return say(
        "\n\nBack from the subagents: the Alfama venue is €40 a night cheaper, and the 9:40 TAP flight lands before noon.",
      );
    }
    if (text.includes("ask") || text.includes("plan")) {
      if (!(await say("Before I plan it, two things I can't tell from here."))) return false;
      const questionId = `q-${requestId.slice(0, 6)}`;
      emit({
        requestId,
        type: "question",
        question: {
          id: questionId,
          expiresAt: Date.now() + 60 * 60_000,
          questions: [
            {
              id: "when",
              header: "Timing",
              question: "When should the offsite happen?",
              options: [
                {
                  label: "Second week of December",
                  description: "Before the holidays; flights are cheaper",
                },
                { label: "Mid January", description: "After the release freeze" },
              ],
              multiSelect: false,
              secret: false,
            },
            {
              id: "who",
              header: "People",
              question: "Who's coming?",
              options: [{ label: "Engineering" }, { label: "Design" }, { label: "Support" }],
              multiSelect: true,
              secret: false,
            },
          ],
        },
      });
      const answer = await asked(questionId, signal);
      emit({ requestId, type: "questionResolved", questionId });
      if (signal.aborted) return false;
      return say(
        `\n\nGot it: ${answer || "no preference"}. I'll draft the plan around that and check the venue's calendar next.`,
      );
    }
    if (
      !(await step(
        "s1",
        {
          kind: "search",
          title: `Searched mail for “${input.input.slice(0, 28)}”`,
          source: "Otter",
        },
        '{"threads": 4, "newest": "Q4 planning — draft agenda", "from": "priya@acme.example"}',
        900,
      )) ||
      !(await step(
        "s2",
        {
          kind: "read",
          title: "Read Q4 planning — draft agenda",
          detail: "5 messages",
          source: "Otter",
        },
        "Tom: Offline search first, IMO.\nPriya: Sam, can you own item 3?",
        800,
      ))
    )
      return false;
    if (text.includes("send") || text.includes("run") || text.includes("approve")) {
      if (!(await say("I have what I need. One step needs your say-so first."))) return false;
      const approvalId = `a-${requestId.slice(0, 6)}`;
      const command = 'gog send --to priya@acme.example --subject "Thursday at 2pm"';
      emit({
        requestId,
        type: "tool",
        id: "s3",
        step: { kind: "command", title: `Ran ${command}` },
      });
      emit({
        requestId,
        type: "approval",
        approval: {
          id: approvalId,
          kind: "command",
          title: "Run a command",
          detail: command,
          reason: "Sends an email from your account.",
          choices: ["once", "session", "always", "deny"],
        },
      });
      const decision = await asked(approvalId, signal);
      emit({ requestId, type: "approvalResolved", approvalId });
      if (signal.aborted) return false;
      emit({
        requestId,
        type: "toolResult",
        id: "s3",
        output: decision === "deny" ? "(declined)" : "Sent.",
      });
      return say(
        decision === "deny"
          ? "\n\nUnderstood, I left it unsent. The draft is in your Drafts."
          : "\n\nSent. Priya has the new time, and I moved it on the team calendar.",
      );
    }
    if (
      !(await step(
        "s3",
        {
          kind: "web",
          title: "Opened otterware.app/changelog",
          detail: "https://otterware.app/mail/changelog",
        },
        "200 OK",
        700,
      ))
    )
      return false;
    if (text.includes("take your time")) {
      if (
        !(await step(
          "s4",
          { kind: "command", title: "Ran gog search --since yesterday" },
          "14 threads",
          12_000,
        ))
      )
        return false;
    }
    return say(FINAL);
  }

  return {
    ...SETTINGS_CALLS[kind],
    settingsView: async () => SETTINGS_VIEW[kind] ?? {},
    async checkStatus() {
      return {
        installed: true,
        version: "demo",
        status: "ready",
        auth: { status: "authenticated" },
        models: DEMO_MODELS[id] ?? [{ slug: "demo", name: "Demo", isDefault: true }],
        model: null,
        sessions: true,
      };
    },
    async sendTurn(input, settings, emit) {
      const controller = new AbortController();
      runs.set(input.requestId, controller);
      try {
        if (await run(input, settings, emit, controller.signal)) {
          for (const text of steers.get(input.requestId) ?? [])
            emit({ requestId: input.requestId, type: "steerReturned", text });
          emit({ requestId: input.requestId, type: "done", responseId: null });
        } else if (controller.signal.aborted) {
          emit({ requestId: input.requestId, type: "error", message: "cancelled" });
        }
      } finally {
        runs.delete(input.requestId);
        steers.delete(input.requestId);
      }
    },
    cancel: (requestId) => runs.get(requestId)?.abort(),
    async steer(requestId, input) {
      if (!runs.has(requestId)) return false;
      steers.set(requestId, [...(steers.get(requestId) ?? []), input]);
      return true;
    },
    async respondApproval(_requestId, approvalId, decision: ApprovalDecision) {
      waiting.get(approvalId)?.(decision);
      waiting.delete(approvalId);
    },
    async answerQuestion(_requestId, questionId, answers) {
      waiting.get(questionId)?.(answers ? Object.values(answers).flat().join(", ") : "");
      waiting.delete(questionId);
    },
    listSkills: async () => SKILLS,
    listSessions: async (_settings, limit, everywhere) =>
      fakeSessions(id, everywhere).slice(0, limit),
    otherSessions: id === DEMO_AGENTS.brokk,
    readSession: async (_settings, sessionId) => fakeSession(id, sessionId),
    readFile: async (_settings, _sessionId, href) => readFakeFile(href),
    async retitle(_settings, _sessionId, name) {
      if ("title" in name) return name.title;
      const words = name.message.trim().split(/\s+/).slice(0, 6).join(" ");
      return words ? words[0]!.toUpperCase() + words.slice(1) : null;
    },
    deleteSession: async () => {},
    schedules: scriptedSchedules(id),
    shutdown: () => {
      for (const controller of runs.values()) controller.abort();
    },
  };
}
