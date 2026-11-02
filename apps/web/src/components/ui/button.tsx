import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "~/lib/utils";

const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border font-normal outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-64 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { size: "default", variant: "outline" },
    variants: {
      variant: {
        accent: "border-transparent bg-primary text-primary-foreground hover:bg-primary/88",
        destructive: "border-transparent bg-destructive text-white hover:bg-destructive/88",
        outline: "border-border bg-transparent text-foreground hover:bg-accent-surface",
        ghost: "border-transparent text-foreground hover:bg-accent-surface",
        secondary:
          "border-transparent bg-accent-surface text-foreground hover:bg-accent-surface/80",
        "ghost-destructive":
          "border-transparent text-destructive-foreground hover:bg-destructive/10 [&_svg]:text-destructive-foreground",
      },
      size: {
        small:
          "h-7 px-[calc(--spacing(2.5)-1px)] text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-8 px-[calc(--spacing(3)-1px)] text-sm [&_svg:not([class*='size-'])]:size-4",
        large: "h-9 px-[calc(--spacing(3.5)-1px)] text-sm [&_svg:not([class*='size-'])]:size-4",
        xs: "h-6 gap-1 px-[calc(--spacing(2)-1px)] text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-7 px-[calc(--spacing(2.5)-1px)] text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs": "size-6 px-0 [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, type, ...props }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants, type ButtonProps };
