import * as React from "react";

import { cn } from "../lib/utils";

type InputProps = Omit<React.ComponentProps<"input">, "size"> & {
  size?: "sm" | "compact" | "default";
  font?: "default" | "mono";
  nativeInput?: boolean;
};

function Input({
  className,
  type = "text",
  size = "default",
  font = "default",
  nativeInput: _nativeInput,
  ...props
}: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-border/70 bg-surface-raised/60 px-[calc(--spacing(2.75)-1px)] text-sm text-foreground outline-none transition-[box-shadow,border-color,background-color] placeholder:text-placeholder focus-visible:border-focus-ring/60 focus-visible:bg-canvas focus-visible:ring-[3px] focus-visible:ring-focus-ring/16 disabled:opacity-64 aria-invalid:border-destructive/36",
        size === "sm" && "h-7 px-[calc(--spacing(2.5)-1px)]",
        size === "compact" && "h-7 rounded-md px-[calc(--spacing(2.5)-1px)] text-xs",
        font === "mono" && "font-mono tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

/** An input that commits its text on Enter or blur, and reverts on Escape. */
function DraftInput({
  value,
  onCommit,
  ...props
}: Omit<InputProps, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  const [draftFor, setDraftFor] = React.useState(value);
  if (draftFor !== value) {
    setDraftFor(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <Input
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

export { DraftInput, Input };
