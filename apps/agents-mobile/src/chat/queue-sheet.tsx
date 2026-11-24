import { SheetPlaceholder } from "../frame/placeholder.tsx";

/** What's queued in a chat (AskCards.swift's QueueSheet): edit, send now, remove. */
export function QueueSheet() {
  return (
    <SheetPlaceholder
      title="Queued"
      line="Messages waiting for the agent's turn to end go here."
      icon="text.line.first.and.arrowtriangle.forward"
    />
  );
}
