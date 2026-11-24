import { SheetPlaceholder } from "../frame/placeholder.tsx";

/** The agent picker and its model and effort (ModelSheet.swift). */
export function ModelSheet() {
  return (
    <SheetPlaceholder
      title="Agent and model"
      line="Your agents, then the model and options for one with several."
      icon="cpu"
    />
  );
}
