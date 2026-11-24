import { describe, expect, it, vi } from "vite-plus/test";
import { applyMutation, type AgentStore } from "@otter/contracts/agent-sync";
import type { MarginNote } from "@otter/contracts/margin-notes";

import { scriptedNotes } from "../fake/notes.js";
import { notesPrompt, parseNotes, type NoteItem } from "./margin-notes.js";

vi.mock("./agent/service.js", () => ({}));

function memory(): AgentStore & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>();
  return {
    entries,
    get: (key) => entries.get(key),
    set: (key, value) => void entries.set(key, value),
    turnKeys: () => [],
    removeTurns: () => {},
    deviceKeys: () => [],
    secretKeys: () => [],
  };
}

const note: MarginNote = {
  id: "n1",
  agentId: "a1",
  target: { kind: "day", date: "2026-11-24" },
  kind: "summary",
  text: "A quiet day.",
  state: "open",
  createdAt: 1,
};

describe("note mutations", () => {
  it("writes a note once, open", () => {
    const store = memory();
    applyMutation(store, { op: "note.set", note: { ...note, state: "accepted" } });
    applyMutation(store, { op: "note.set", note: { ...note, text: "Changed." } });
    expect(store.get("note/n1")).toEqual(note);
  });

  it("answers an open note, and the first answer stays", () => {
    const store = memory();
    applyMutation(store, { op: "note.state", id: "n1", state: "dismissed" });
    expect(store.entries.has("note/n1")).toBe(false);
    applyMutation(store, { op: "note.set", note });
    applyMutation(store, { op: "note.state", id: "n1", state: "accepted" });
    applyMutation(store, { op: "note.state", id: "n1", state: "dismissed" });
    expect(store.get("note/n1")).toEqual({ ...note, state: "accepted" });
  });

  it("removes a note for good", () => {
    const store = memory();
    applyMutation(store, { op: "note.remove", id: "n1" });
    expect(store.entries.has("note/n1")).toBe(false);
    applyMutation(store, { op: "note.set", note });
    applyMutation(store, { op: "note.remove", id: "n1" });
    applyMutation(store, { op: "note.set", note });
    applyMutation(store, { op: "note.state", id: "n1", state: "accepted" });
    expect(store.get("note/n1")).toBeNull();
  });
});

const items: NoteItem[] = [
  {
    ref: "thread/robin@example.com/t1",
    target: { kind: "thread", accountId: "robin@example.com", threadId: "t1" },
    about: { kind: "conversation", subject: "Dinner Saturday?", from: "Maya <maya@example.com>" },
  },
  {
    ref: "event/primary/e1",
    target: { kind: "event", calendarId: "primary", eventId: "e1" },
    about: { kind: "event", title: "Design review", attendees: 5, start: "2026-11-24T15:00:00Z" },
  },
];

describe("asking for notes", () => {
  it("tells the agent each item and its ref", () => {
    const prompt = notesPrompt(items);
    expect(prompt).toContain('"ref": "thread/robin@example.com/t1"');
    expect(prompt).toContain('"subject": "Dinner Saturday?"');
  });

  it("keeps the agent's good notes, on the items asked about", () => {
    const answer = `Here you go:
\`\`\`json
[
  {"ref": "thread/robin@example.com/t1", "kind": "draft", "text": " Say yes. ", "action": {"label": "Draft reply", "prompt": "Draft a yes."}},
  {"ref": "thread/robin@example.com/t1", "kind": "summary", "text": "A second note on it."},
  {"ref": "event/primary/e1", "kind": "summary", "text": "Five people.", "action": {"label": ""}},
  {"ref": "thread/other/t9", "kind": "summary", "text": "Not asked about."},
  {"ref": "event/primary/e1", "kind": "rant", "text": "Not a kind."},
  {"kind": "summary", "text": "No ref."},
  "not a note"
]
\`\`\``;
    expect(parseNotes(answer, items, "a1", 5)).toEqual([
      {
        id: expect.any(String),
        agentId: "a1",
        target: items[0]!.target,
        kind: "draft",
        text: "Say yes.",
        action: { label: "Draft reply", prompt: "Draft a yes." },
        state: "open",
        createdAt: 5,
      },
      {
        id: expect.any(String),
        agentId: "a1",
        target: items[1]!.target,
        kind: "summary",
        text: "Five people.",
        state: "open",
        createdAt: 5,
      },
    ]);
  });

  it("reads a bare array, and nothing from what isn't JSON", () => {
    const bare = `[{"ref": "event/primary/e1", "kind": "done", "text": "Moved."}]`;
    expect(parseNotes(bare, items, "a1")).toHaveLength(1);
    expect(parseNotes("I couldn't find anything.", items, "a1")).toEqual([]);
    expect(parseNotes(`{"ref": "event/primary/e1"}`, items, "a1")).toEqual([]);
    expect(
      parseNotes(
        `[{"ref": "event/primary/e1", "kind": "done", "text": "${"x".repeat(700)}"}]`,
        items,
        "a1",
      ),
    ).toEqual([]);
  });

  it("is answered by the made-up agent with notes that parse", () => {
    const notes = parseNotes(scriptedNotes(notesPrompt(items))!, items, "a1");
    expect(notes.map((n) => [n.kind, n.action?.label])).toEqual([
      ["draft", "Draft reply"],
      ["summary", "Prepare a brief"],
    ]);
    expect(scriptedNotes("Find a venue")).toBeNull();
  });
});
