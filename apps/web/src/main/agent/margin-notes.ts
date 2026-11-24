import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { noteTargetKey, type MarginNote, type NoteTarget } from "@otter/contracts/margin-notes";

const NOTES_KEY = ["margin-notes"] as const;

/** Every open note, kept current by `notes:changed`. */
function useAllNotes() {
  const qc = useQueryClient();
  useEffect(
    () =>
      window.desktopBridge.on("notes:changed", () => {
        void qc.invalidateQueries({ queryKey: NOTES_KEY });
      }),
    [qc],
  );
  return useQuery({
    queryKey: NOTES_KEY,
    queryFn: (): Promise<MarginNote[]> => window.desktopBridge.invoke("notes:list", {}),
    staleTime: 60_000,
  });
}

/** The open notes an agent wrote beside `target` (or beside any of `targets`). */
export function useMarginNotes(target: NoteTarget | NoteTarget[] | null): MarginNote[] {
  const notes = useAllNotes().data ?? [];
  if (!target) return [];
  const keys = new Set((Array.isArray(target) ? target : [target]).map(noteTargetKey));
  return notes.filter((note) => note.state === "open" && keys.has(noteTargetKey(note.target)));
}

export function acceptNote(id: string): Promise<void> {
  return window.desktopBridge.invoke("notes:accept", { id });
}

export function dismissNote(id: string): Promise<void> {
  return window.desktopBridge.invoke("notes:dismiss", { id });
}
