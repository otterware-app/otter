import { SheetPlaceholder } from "../frame/placeholder.tsx";

/** Chat details (ChatDetails.swift): the agent, where it ran, what it made and read. */
export function DetailsSheet() {
  return (
    <SheetPlaceholder
      title="Chat details"
      line="The agent, the session, outputs and sources go here."
      icon="info.circle"
    />
  );
}
