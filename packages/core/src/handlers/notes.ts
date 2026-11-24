import type { NoteTarget } from "@otter/contracts/margin-notes";

import { handle } from "../ipc.js";
import * as notes from "../services/margin-notes.js";

type Params = Record<string, unknown> | undefined;

const TARGET_KINDS = new Set(["thread", "event", "task", "day"]);

function id(params: unknown): string {
  const value = (params as Params)?.id;
  if (typeof value !== "string" || !value) throw new Error('Invalid parameter: "id".');
  return value;
}

function targets(params: unknown): NoteTarget[] | undefined {
  const value = (params as Params)?.targets;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('Invalid parameter: "targets".');
  return value.filter(
    (t): t is NoteTarget =>
      typeof t === "object" && t !== null && TARGET_KINDS.has((t as { kind?: string }).kind ?? ""),
  );
}

export function registerNoteHandlers(): void {
  handle("notes:list", async (params: unknown) => notes.listNotes(targets(params)));
  handle("notes:accept", (params: unknown) => notes.acceptNote(id(params)));
  handle("notes:dismiss", (params: unknown) => notes.dismissNote(id(params)));
}
