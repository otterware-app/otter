/**
 * The made-up account's agents and chats (the iPhone Agents app's demo, DemoAgent.swift, on this
 * mailbox's mail): the relay's store starts with them, so every part of a chat shows without an
 * agent. Times are from when the store was seeded.
 */
import { type AgentMutation, type AgentRecord, type ChatRecord } from "@otter/contracts/agent-sync";
import { chatTabId, type ChatTab, type ChatTabRef, type ChatTurn } from "@otter/contracts/chats";

import { DEMO_ACCOUNTS } from "@otter/shared/demo-mailboxes";

import type {
  ChatSessionMessage,
  ProviderModel,
  ProviderModelOption,
} from "../services/agent/types.ts";

export const DEMO_AGENTS = {
  brokk: "demo-brokk",
  rata: "demo-rata",
  studio: "demo-studio",
  varys: "demo-varys",
  claude: "demo-claude",
} as const;

/** An OpenClaw gateway the account had and removed: its chats can move to Studio, which has one of their sessions. */
const GONE = "demo-gone";

/** A gateway's session for an Otter chat: its key names the gateway's agent it runs on. */
export const gatewaySession = (agent: string, id: string) => `agent:${agent}:otter-mail:${id}`;

/** The session Studio has of the removed gateway's chats: reconnecting it reads this. */
export const STUDIO_SESSIONS: Record<string, ChatSessionMessage[]> = {
  [gatewaySession("main", "demo-session-12")]: [
    { role: "user", text: "Ask the Alfama venue whether they can hold the 15th for twelve." },
    {
      role: "assistant",
      text: "I wrote to Casa do Fado's events team for the 15th, twelve people, lunch included. They answer by Friday.",
    },
  ],
};

/** Hermes's options for a model that reasons, as its /api/model/options capabilities give them. */
const REASONING: ProviderModelOption = {
  id: "reasoningEffort",
  label: "Reasoning",
  choices: [
    { id: "", label: "Default", description: "Hermes' configured effort", isDefault: true },
    { id: "none", label: "Off" },
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
  ],
};
const FAST: ProviderModelOption = {
  id: "serviceTier",
  label: "Service Tier",
  choices: [
    { id: "default", label: "Standard", isDefault: true },
    { id: "priority", label: "Fast", description: "Priority processing, increased usage" },
  ],
};

/** What each pretend agent offers to choose from. */
export const DEMO_MODELS: Record<string, ProviderModel[]> = {
  [DEMO_AGENTS.brokk]: [
    {
      slug: "anthropic::claude-opus-5.5",
      name: "claude-opus-5.5",
      subProvider: "Anthropic",
      isDefault: true,
      options: [REASONING],
    },
    { slug: "openai::gpt-5.5", name: "gpt-5.5", subProvider: "OpenAI", options: [REASONING, FAST] },
  ],
  [DEMO_AGENTS.rata]: [{ slug: "hermes-agent", name: "hermes-agent", isDefault: true }],
  [DEMO_AGENTS.studio]: [
    { slug: "main", name: "Molty", isDefault: true },
    { slug: "research", name: "Scout", emoji: "🔭" },
  ],
  [DEMO_AGENTS.varys]: [{ slug: "varys", name: "varys", isDefault: true }],
};

const WORK = "sam@acme.example";
/** The Work mailbox's first thread (fake/gmail.ts numbers them in the seed's order). */
const Q4_THREAD = "191000000000001";
/** The Work mailbox's draft, as fake/gmail.ts numbers its messages: "Performance review — self assessment". */
const REVIEW_DRAFT = (() => {
  const messages = DEMO_ACCOUNTS[1]!.threads(0).flatMap((thread) => thread.messages);
  return `r-191${(messages.findIndex((m) => m.draft) + 1).toString(16).padStart(12, "0")}`;
})();

/** The brokk chat that used and made the most: a scheduled task belongs to its session. */
export const PLANNING_PACK_SESSION = "demo-session-14";

/** A picture as you'd give an agent one: an emoji on a color. */
const picture = (emoji: string, color: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${color}"/><text x="48" y="66" font-size="52" text-anchor="middle">${emoji}</text></svg>`,
  )}`;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type Step = { kind: "command" | "read" | "edit" | "search" | "web" | "tool"; title: string };

export function seedAgents(now: number): AgentMutation[] {
  const agents: (Omit<AgentRecord, "addedAt"> & { avatar?: string })[] = [
    {
      id: DEMO_AGENTS.studio,
      kind: "openclaw",
      name: "Studio",
      settings: { enabled: true, url: "wss://studio.tail.ts.net", model: "" },
    },
    {
      id: DEMO_AGENTS.brokk,
      kind: "hermes",
      name: "brokk",
      avatar: picture("🦉", "#2f5d50"),
      settings: { enabled: true, baseUrl: "https://brokk.tail.ts.net/v1", model: "" },
    },
    {
      id: DEMO_AGENTS.rata,
      kind: "hermes",
      name: "rata",
      avatar: picture("🐀", "#6b4e8e"),
      settings: { enabled: true, baseUrl: "https://rata.tail.ts.net/v1", model: "" },
    },
    {
      id: DEMO_AGENTS.varys,
      kind: "varys",
      name: "varys",
      settings: {
        enabled: true,
        address: "https://studio.tail.ts.net",
        agentId: "varys",
        model: "",
      },
    },
    {
      id: DEMO_AGENTS.claude,
      kind: "claude",
      name: "Claude",
      settings: { enabled: true, model: "" },
    },
  ];

  const user = (id: string, text: string, at: number, more: Partial<ChatTurn> = {}): ChatTurn => ({
    id: `u-${id}`,
    role: "user",
    text,
    startedAt: at,
    ...more,
  });
  const reply = (
    id: string,
    at: number,
    took: number,
    items: ({ text: string } | (Step & { output: string; source?: string }))[],
    more: Partial<ChatTurn> = {},
  ): ChatTurn => ({
    id: `a-${id}`,
    role: "assistant",
    text: "",
    items: items.map((item) =>
      "kind" in item
        ? {
            kind: "step",
            step: {
              kind: item.kind,
              title: item.title,
              ...(item.source ? { source: item.source } : {}),
            },
            output: item.output,
          }
        : { kind: "text", text: item.text },
    ),
    startedAt: at,
    finishedAt: at + took,
    ...more,
  });
  const tab = (ref: ChatTabRef, title: string, at: number, made?: true): ChatTab => ({
    id: chatTabId(ref),
    title,
    ref,
    addedAt: at,
    ...(made ? { made } : {}),
  });

  const chats: (Partial<ChatRecord> & {
    title: string;
    provider: string;
    ago: number;
    turns: ChatTurn[];
    /** On an OpenClaw gateway: the gateway's agent its session runs on. */
    on?: string;
  })[] = [
    {
      title: "Plan the Lisbon offsite",
      provider: DEMO_AGENTS.studio,
      on: "research",
      ago: 9 * DAY,
      pinnedAt: now - 8 * DAY,
      turns: [
        user(
          "1",
          "Plan a three-day offsite in Lisbon for twelve people in January.",
          now - 9 * DAY,
        ),
        reply("1", now - 9 * DAY, 95_000, [
          {
            kind: "search",
            title: "Searched flights LIS, 14–17 Jan",
            output: '{"cheapest": 148, "currency": "EUR", "carrier": "TAP"}',
          },
          { kind: "web", title: "Opened booking.com", output: "200 OK" },
          {
            text: "Three options hold twelve people within budget. **Bairro Alto** is closest to the venue; **Alfama** is quieter and €40 a night cheaper.\n\n1. Bairro Alto, 6 twin rooms, €1,980\n2. Alfama, 12 singles, €2,400\n3. Parque das Nações, 6 twin rooms, €1,740",
          },
        ]),
      ],
      tabs: [
        tab({ kind: "page", url: "https://www.booking.com" }, "booking.com", now - 9 * DAY),
        tab({ kind: "file", href: "offsite-plan.md" }, "offsite-plan.md", now - 9 * DAY, true),
      ],
    },
    {
      title: "What do I owe Priya for Q4 planning?",
      provider: DEMO_AGENTS.studio,
      on: "main",
      ago: 12 * MINUTE,
      turns: [
        user(
          "2",
          "What did Priya and Tom settle on for Q4 planning, and what do I owe them?",
          now - 14 * MINUTE,
        ),
        reply("2", now - 14 * MINUTE, 48_000, [
          {
            kind: "search",
            title: "Searched mail for “Q4 planning”",
            output: '{"threads": 1, "messages": 5}',
            source: "Otter",
          },
          {
            kind: "read",
            title: "Read Q4 planning — draft agenda",
            output:
              "Tom: Offline search first, IMO: the redesign depends on the new index anyway.\nPriya: Sam, can you own item 3?",
            source: "Otter",
          },
          {
            text: "They agreed to ship **offline search before the redesign**. You owe them two things:\n\n- item 3 of the agenda, **the hiring plan**, with numbers for two backend hires\n- an answer to Tom: he'd like to move Thursday's meeting **to 2pm**\n\nI drafted a reply with both; it's in your Drafts.",
          },
        ]),
        user("3", "Make it shorter and send it.", now - 12 * MINUTE, {
          citations: [{ text: "he'd like to move Thursday's meeting to 2pm", comment: "say yes" }],
        }),
        reply("3", now - 12 * MINUTE, 21_000, [
          {
            kind: "edit",
            title: "Updated the draft to Priya and Tom",
            output: "Saved.",
            source: "Otter",
          },
          {
            text: "Shortened to three lines and sent. They have your yes on 2pm, and you'll bring the hiring numbers.",
          },
        ]),
      ],
      tabs: [
        tab(
          { kind: "thread", accountId: WORK, id: Q4_THREAD },
          "Q4 planning — draft agenda",
          now - 14 * MINUTE,
        ),
      ],
    },
    {
      title: "Call about the boiler email",
      provider: DEMO_AGENTS.studio,
      on: "main",
      ago: 40 * MINUTE,
      turns: [
        user("call", "Can you give me an overview of the email to Nikolas?", now - 41 * MINUTE, {
          spoken: true,
        }),
        reply("call-ack", now - 41 * MINUTE, 2_000, [{ text: "Yep, heard you." }], {
          spoken: true,
        }),
        reply("call", now - 41 * MINUTE, 16_000, [
          { kind: "search", title: "Searched mail for “boiler”", output: '{"drafts": 1}' },
          {
            text: "It's a short email to Nikolas explaining that the boiler keeps running even in hot-water-only mode and the pressure is very low. It says this seems similar to the issue someone checked earlier this year, possibly around April, and asks him to arrange another visit. We left the photos out for now.",
          },
        ]),
        reply(
          "call-said",
          now - 40 * MINUTE,
          9_000,
          [
            {
              text: "It's a quick note to Nikolas saying the boiler still runs in hot-water-only mode and the pressure's very low. It suggests it's the same issue as in April and asks him to come again.",
            },
          ],
          { spoken: true },
        ),
      ],
    },
    {
      title: "Morning brief",
      provider: DEMO_AGENTS.brokk,
      ago: 3 * HOUR,
      turns: [
        reply(
          "4",
          now - 3 * HOUR,
          64_000,
          [
            { kind: "tool", title: "Read today's calendar", output: "3 events" },
            {
              kind: "search",
              title: "Searched mail since yesterday",
              output: '{"unread": 14, "needs_reply": 3}',
            },
            {
              text: "Good morning. Three things need you today:\n\n1. **14:00** design review of the new reader layout, the invite is from Priya\n2. Olu is waiting on the Northwind contract renewal\n3. Your flight to Lisbon checks in from 16:20\n\nEverything else can wait until tomorrow.",
            },
          ],
          {
            delivered: {
              kind: "automation",
              jobId: "brief",
              name: "Morning brief",
              schedule: "Weekdays at 8:00",
            },
          },
        ),
      ],
    },
    {
      title: "Compare the hiring options",
      provider: DEMO_AGENTS.brokk,
      ago: 30 * HOUR,
      turns: [
        user("10", "Compare one backend hire with two for Q4, with costs.", now - 30 * HOUR),
        reply("10", now - 30 * HOUR, 132_000, [
          { kind: "read", title: "Read Q4-planning-agenda.pdf", output: "3. Hiring plan (20 min)" },
          {
            kind: "command",
            title: "Ran python3 headcount.py --hires 1 2",
            output: "1 hire: €96k\n2 hires: €184k",
          },
          {
            text: "## Two hires pay for themselves by spring\n\n| | One hire | Two hires |\n| --- | --- | --- |\n| Cost to March | €96k | €184k |\n| Offline search ships | February | mid January |\n| On-call load | 1 in 4 weeks | 1 in 5 weeks |\n\nWith two, offline search lands **four weeks earlier**, before the redesign needs the new index.\n\nThe numbers come from this:\n\n```python\ndef cost(hires, months=5, salary=7_400, overhead=1.3):\n    return hires * months * salary * overhead\n```\n\n> Recruiting takes about six weeks here, so the second hire only helps if you open the role this month.",
          },
        ]),
      ],
    },
    {
      title: "Why is the nightly build red?",
      provider: DEMO_AGENTS.brokk,
      ago: 26 * HOUR,
      turns: [
        user("5", "The nightly build has been red since Monday. Find out why.", now - 26 * HOUR),
        reply("5", now - 26 * HOUR, 212_000, [
          {
            kind: "command",
            title: "Ran gh run list --workflow release.yml --limit 5",
            output: "completed  failure  Release  main  2026-11-09",
          },
          { kind: "read", title: "Read .github/workflows/release.yml", output: "" },
          { kind: "edit", title: "Edited scripts/notarize-mac.ts", output: "+4 −1" },
          {
            text: "The notarization step times out since Apple's service moved regions. I raised the wait from 10 to 30 minutes in `scripts/notarize-mac.ts` and re-ran the workflow: it's green.",
          },
        ]),
      ],
    },
    {
      title: "Summarize the board deck",
      provider: DEMO_AGENTS.rata,
      ago: 2 * DAY,
      turns: [
        user("6", "Summarize this for me in five bullets.", now - 2 * DAY, {
          attachments: [{ name: "Board deck Q3.pdf", kind: "file", size: 2_480_000 }],
        }),
        reply("6", now - 2 * DAY, 37_000, [
          {
            text: "- Revenue is up 18% quarter over quarter\n- Churn fell to 2.1%, the lowest yet\n- Hiring is two engineers behind plan\n- The Linux app shipped and is 9% of new installs\n- Runway is 22 months at current burn",
          },
        ]),
      ],
    },
    {
      title: "Find the receipt for order 4821",
      provider: DEMO_AGENTS.varys,
      ago: 5 * HOUR,
      snoozedUntil: now + 20 * HOUR,
      turns: [
        user("7", "Find the receipt for order 4821 and tell me the total.", now - 5 * HOUR),
        reply("7", now - 5 * HOUR, 19_000, [
          { kind: "search", title: "Searched mail for “4821”", output: "1 match" },
          { text: "Receipt for order **#4821-OTTR**: **€86.42**, paid by card on the 5th." },
        ]),
      ],
    },
    {
      title: "Check the status page",
      provider: DEMO_AGENTS.rata,
      ago: 7 * HOUR,
      turns: [
        user("11", "Is anything down on our status page right now?", now - 7 * HOUR),
        reply(
          "11",
          now - 7 * HOUR,
          30_000,
          [{ kind: "web", title: "Opened status.acme.example", output: "" }],
          {
            error: "rata stopped answering: the request timed out after 30 seconds.",
          },
        ),
      ],
    },
    {
      title: "Draft the release note",
      provider: DEMO_AGENTS.rata,
      ago: 11 * DAY,
      settledAt: now - 10 * DAY,
      turns: [
        user("8", "Draft a short release note for 0.14.", now - 11 * DAY),
        reply("8", now - 11 * DAY, 28_000, [
          { text: "**Otter 0.14** brings Outlook folders, faster search and a calmer sidebar." },
        ]),
      ],
    },
    {
      title: "Unsubscribe from the newsletters I never open",
      provider: DEMO_AGENTS.brokk,
      ago: 13 * DAY,
      turns: [
        user(
          "9",
          "Unsubscribe me from newsletters I haven't opened in three months.",
          now - 13 * DAY,
        ),
        reply("9", now - 13 * DAY, 151_000, [
          {
            kind: "search",
            title: "Searched mail for list-unsubscribe",
            output: "38 senders",
            source: "Otter",
          },
          {
            text: "Unsubscribed from 23 senders. 15 need a click on their own page; I listed them in a draft.",
          },
        ]),
      ],
    },
    {
      title: "Fix the flaky calendar sync test",
      provider: DEMO_AGENTS.claude,
      device: { id: "demo-mac", name: "Robin's MacBook Pro" },
      ago: 4 * HOUR,
      turns: [
        user(
          "12",
          "The calendar sync test fails about one run in five. Find out why and fix it.",
          now - 4 * HOUR,
        ),
        reply("12", now - 4 * HOUR, 186_000, [
          {
            kind: "command",
            title: "Ran pnpm vitest run calendar-sync --repeat 20",
            output: "4 failed, 16 passed",
          },
          { kind: "read", title: "Read packages/core/src/calendar/sync.test.ts", output: "" },
          {
            kind: "edit",
            title: "Edited packages/core/src/calendar/sync.test.ts",
            output: "+3 −2",
          },
          {
            text: "The test built its events from today's date, so runs near midnight UTC crossed into the next day. It uses a fixed date now, and twenty runs in a row pass.",
          },
        ]),
      ],
    },
    {
      title: "Book the venue in Alfama",
      provider: GONE,
      on: "main",
      ago: 3 * DAY,
      turns: [
        user(
          "13",
          "Ask the Alfama venue whether they can hold the 15th for twelve.",
          now - 3 * DAY,
        ),
        reply("13", now - 3 * DAY, 41_000, [
          {
            text: "I wrote to Casa do Fado's events team for the 15th, twelve people, lunch included. They answer by Friday.",
          },
        ]),
      ],
    },
    {
      title: "Draft the visa letters",
      provider: GONE,
      on: "research",
      ago: 6 * DAY,
      settledAt: now - 5 * DAY,
      turns: [
        user(
          "14",
          "Draft invitation letters for the two people who need a visa for Lisbon.",
          now - 6 * DAY,
        ),
        reply("14", now - 6 * DAY, 33_000, [
          {
            text: "Both letters are drafted on the company letterhead, with the dates, the hotel and who pays. They're in your Drafts for a signature.",
          },
        ]),
      ],
    },
    {
      title: "Get ready for Thursday's planning",
      provider: DEMO_AGENTS.brokk,
      ago: 50 * MINUTE,
      turns: [
        user(
          "15",
          "Get me ready for Thursday's Q4 planning: the hiring numbers, a chart, and finish my self assessment while you're at it.",
          now - 50 * MINUTE,
        ),
        reply("15", now - 50 * MINUTE, 236_000, [
          {
            kind: "read",
            title: "Read Q4 planning — draft agenda",
            output: "3. Hiring plan (20 min)",
            source: "Otter",
          },
          { kind: "web", title: "Opened levels.fyi", output: "200 OK" },
          { kind: "web", title: "Opened acme.example/careers", output: "200 OK" },
          {
            kind: "command",
            title: "Ran python3 scripts/headcount.py --hires 1 2 --chart",
            output: "1 hire: €96k\n2 hires: €184k\nWrote headcount-chart.bmp",
          },
          { kind: "edit", title: "Updated your self assessment draft", output: "Saved." },
          {
            text: "You're ready for Thursday.\n\n- [The agenda notes](notes/q4-agenda.md), with the hiring plan as item 3\n- [The cost model](scripts/headcount.py), and [the line that sets the overhead](scripts/headcount.py:13)\n- [The chart](headcount-chart.bmp): two hires land offline search four weeks earlier\n- [The sync log](logs/sync.log) behind the latency numbers Tom will ask about\n- [The board deck](exports/board-deck.key) is Keynote, so open it on your Mac\n- [My scratch notes](/tmp/scratch.txt) didn't make it into the workspace\n\nI also finished the draft of your self assessment: it's in Drafts.",
          },
        ]),
      ],
      tabs: [
        tab(
          { kind: "thread", accountId: WORK, id: Q4_THREAD },
          "Q4 planning — draft agenda",
          now - 50 * MINUTE,
        ),
        tab({ kind: "page", url: "https://www.levels.fyi" }, "levels.fyi", now - 49 * MINUTE),
        tab(
          { kind: "page", url: "https://acme.example/careers" },
          "Careers at Acme",
          now - 49 * MINUTE,
        ),
        tab({ kind: "file", href: "notes/q4-agenda.md" }, "q4-agenda.md", now - 48 * MINUTE, true),
        tab(
          { kind: "file", href: "scripts/headcount.py" },
          "headcount.py",
          now - 48 * MINUTE,
          true,
        ),
        tab(
          { kind: "file", href: "headcount-chart.bmp" },
          "headcount-chart.bmp",
          now - 47 * MINUTE,
          true,
        ),
        tab({ kind: "file", href: "logs/sync.log" }, "sync.log", now - 47 * MINUTE),
        tab(
          { kind: "draft", accountId: WORK, id: REVIEW_DRAFT },
          "Performance review — self assessment",
          now - 46 * MINUTE,
          true,
        ),
      ],
    },
  ];

  return [
    ...agents.map((agent, i): AgentMutation => ({
      op: "agent.set",
      ...agent,
      addedAt: now - 30 * DAY + i,
    })),
    { op: "select", id: DEMO_AGENTS.studio },
    ...chats.flatMap(({ ago, turns, on, ...chat }, i): AgentMutation[] => {
      const id = `demo-chat-${i + 1}`;
      const session = `demo-session-${i + 1}`;
      const last = turns.at(-1)!;
      return [
        {
          op: "chat.set",
          chat: {
            id,
            sessionId: on ? gatewaySession(on, session) : session,
            sessionOwned: true,
            lastResponseId: null,
            device: null,
            createdAt: now - ago,
            updatedAt: last.finishedAt ?? last.startedAt ?? now - ago,
            tabs: [],
            ...chat,
          },
        },
        { op: "turns", chat: id, put: turns, order: turns.map((turn) => turn.id) },
      ];
    }),
  ];
}
