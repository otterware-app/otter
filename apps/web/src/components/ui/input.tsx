import type * as React from "react";

import { cn } from "~/lib/utils";

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

export { Input };
