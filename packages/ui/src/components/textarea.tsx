import type * as React from "react";

import { cn } from "../lib/utils";

/** A text field of several lines; it grows with its text up to `max-h-*`. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-16 w-full min-w-0 resize-none rounded-lg border border-border/70 bg-surface-raised/60 px-[calc(--spacing(2.75)-1px)] py-1.5 text-sm leading-5 text-foreground outline-none transition-[box-shadow,border-color,background-color] [field-sizing:content] placeholder:text-placeholder focus-visible:border-focus-ring/60 focus-visible:bg-canvas focus-visible:ring-[3px] focus-visible:ring-focus-ring/16 disabled:opacity-64 aria-invalid:border-destructive/36",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
