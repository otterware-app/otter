/**
 * Sessions on the made-up agents that aren't Otter chats yet ("On your agents"): opening one reads
 * it and makes it a chat. brokk, as Hermes does, lists only Otter's own unless asked for every one.
 */
import type { ChatSession, ChatSessionMessage } from "../services/agent/types.ts";
import { DEMO_AGENTS, STUDIO_SESSIONS, gatewaySession } from "./chats.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Seeded = {
  id: string;
  title: string;
  source: string;
  ago: number;
  messages: ChatSessionMessage[];
  /** Not one of Otter's own: listed only when every session is asked for. */
  elsewhere?: true;
};

const SESSIONS: Record<string, Seeded[]> = {
  [DEMO_AGENTS.studio]: [
    {
      id: gatewaySession("main", "demo-newsletter"),
      title: "Draft the October newsletter",
      source: "main",
      ago: 5 * DAY,
      messages: [
        { role: "user", text: "Draft the October customer newsletter from the changelog." },
        {
          role: "assistant",
          text: "Here's a draft: **Outlook folders**, faster search and a calmer sidebar, with a short note on the Linux app. It's in your Drafts.",
        },
      ],
    },
    {
      id: gatewaySession("research", "demo-crm"),
      title: "Compare CRM vendors",
      source: "research",
      ago: 8 * DAY,
      messages: [
        { role: "user", text: "Compare three CRMs for a ten-person sales team." },
        {
          role: "assistant",
          text: "| | Seats | Price |\n| --- | --- | --- |\n| Attio | 10 | €340/mo |\n| HubSpot | 10 | €450/mo |\n| Pipedrive | 10 | €290/mo |\n\nAttio fits best if you want mail synced both ways.",
        },
      ],
    },
  ],
  [DEMO_AGENTS.brokk]: [
    {
      id: "20261119_team_dinner",
      title: "Plan the team dinner",
      source: "api_server",
      ago: 4 * DAY,
      messages: [
        {
          role: "user",
          text: "Find a place for a team dinner for nine on Friday, near the office.",
        },
        {
          role: "assistant",
          text: "Two have a table for nine at 19:30: **Tasca do Chico** (Portuguese, €35 a head) and **Mesa** (small plates, €42). Want me to book one?",
        },
      ],
    },
    {
      id: "20261123_groceries",
      title: "Grocery list",
      source: "telegram",
      ago: 20 * HOUR,
      elsewhere: true,
      messages: [
        { role: "user", text: "Add oat milk, lemons and coffee beans to the list." },
        { role: "assistant", text: "Added. The list has 11 things now." },
      ],
    },
    {
      id: "20261118_photos",
      title: "Rename the photo folders",
      source: "cli",
      ago: 6 * DAY,
      elsewhere: true,
      messages: [
        { role: "user", text: "Rename the photo folders to year-month-place." },
        { role: "assistant", text: "Renamed 42 folders, like `2026-08-lisbon`." },
      ],
    },
  ],
};

/** The agent's sessions, newest first: Otter's own, or with `everywhere` every one. */
export function fakeSessions(agent: string, everywhere = false): ChatSession[] {
  const now = Date.now();
  return (SESSIONS[agent] ?? [])
    .filter((s) => everywhere || !s.elsewhere)
    .map((s) => ({
      id: s.id,
      title: s.title,
      source: s.source,
      lastActive: now - s.ago,
      messageCount: s.messages.length,
      preview: s.messages.at(-1)!.text,
    }))
    .sort((a, b) => b.lastActive - a.lastActive);
}

/** What one of its sessions says: those above, and Studio's copy of a removed gateway's chat. */
export function fakeSession(agent: string, id: string): ChatSessionMessage[] {
  if (agent === DEMO_AGENTS.studio && STUDIO_SESSIONS[id]) return STUDIO_SESSIONS[id];
  return SESSIONS[agent]?.find((s) => s.id === id)?.messages ?? [];
}
