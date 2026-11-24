import type { NoteKind, NoteTarget } from "@otter/contracts/margin-notes";
import { Button } from "@otter/ui/components/button";
import { MarginNote } from "@otter/ui/components/margin";
import { useAgentProviders } from "./agent-providers";
import { acceptNote, dismissNote, useMarginNotes } from "./margin-notes";

const KIND_LABEL: Record<NoteKind, string> = {
  summary: "",
  draft: "draft ready",
  question: "question",
  done: "done",
};

/** What the agents wrote beside `target`, in its margin: accept runs its action, dismiss hides it. */
export function AgentNotes({ target }: { target: NoteTarget | NoteTarget[] | null }) {
  const notes = useMarginNotes(target);
  const providers = useAgentProviders().data?.providers ?? [];
  if (notes.length === 0) return null;
  return (
    <>
      {notes.map((note) => {
        const agent = providers.find((p) => p.id === note.agentId)?.name ?? "Agent";
        const kind = KIND_LABEL[note.kind];
        return (
          <MarginNote
            key={note.id}
            who={kind ? `${agent} · ${kind}` : agent}
            actions={
              <>
                {note.action ? (
                  <Button size="xs" variant="ghost" onClick={() => void acceptNote(note.id)}>
                    {note.action.label}
                  </Button>
                ) : null}
                <Button size="xs" variant="ghost-muted" onClick={() => void dismissNote(note.id)}>
                  Dismiss
                </Button>
              </>
            }
          >
            {note.text}
          </MarginNote>
        );
      })}
    </>
  );
}
