import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap rounded-full border text-xs [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3",
  {
    defaultVariants: { variant: "outline", size: "default" },
    variants: {
      variant: {
        outline: "border-border text-muted-foreground",
        secondary: "border-transparent bg-accent-surface text-foreground",
        primary: "border-transparent bg-primary text-primary-foreground",
        destructive: "border-transparent bg-error-surface text-error-foreground",
        warning: "border-transparent bg-warning-surface text-warning-foreground",
      },
      size: {
        default: "h-5 px-2",
        sm: "h-4 px-1.5 text-3xs",
      },
    },
  },
);

/** A label, a count or a state, small and inline: a tag, a folder, a status. */
function Badge({
  className,
  variant,
  size,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">(
      { className: cn(badgeVariants({ variant, size }), className) },
      { "data-slot": "badge" } as object,
      props,
    ),
  });
}

/** The colored dot a badge or a row leads with (a label's color). */
function BadgeDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="badge-dot"
      className={cn("size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}

export { Badge, BadgeDot, badgeVariants };
