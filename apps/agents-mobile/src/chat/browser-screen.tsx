import { SheetPlaceholder } from "../frame/placeholder.tsx";

/** OpenClaw's live browser (BrowserScreen.swift), full screen. */
export function BrowserScreen() {
  return (
    <SheetPlaceholder
      title="Browser"
      line="The page the agent drives, and Take control, go here."
      icon="globe"
    />
  );
}
