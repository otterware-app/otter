import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/utils";

const chipVariants = cva(
  "group/chip relative inline-flex w-fit shrink-0 items-center whitespace-nowrap border outline-none focus-visible:ring-2 focus-visible:ring-focus-ring [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { size: "xs", variant: "outline" },
    variants: {
      variant: {
        outline: "border-border bg-transparent text-muted-foreground",
        selected: "border-foreground/20 bg-transparent text-muted-foreground",
        active: "border-transparent bg-accent-surface text-foreground",
        filled: "border-border/40 bg-accent-surface/60 text-foreground",
        destructive: "border-destructive/50 bg-destructive/10 text-destructive-foreground",
      },
      size: {
        /** A label on a message: Inbox, a Gmail label, a category. */
        xs: "h-5 max-w-32 gap-1.5 rounded-pill px-2 text-2xs font-medium leading-none [&_svg:not([class*='size-'])]:size-3",
        /** A recipient, a filter. */
        sm: "h-6.5 max-w-64 gap-1.5 rounded-pill px-2.5 text-body [&_svg:not([class*='size-'])]:size-3.5",
        /** A file. */
        md: "h-8 max-w-64 gap-1.5 rounded-xl pl-2.5 pr-1 text-sm [&_svg:not([class*='size-'])]:size-3",
      },
    },
  },
);

/** A small rounded token: a label, a recipient, a filter, a file. `render` makes it a button. */
function Chip({
  className,
  variant,
  size,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof chipVariants>) {
  return useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">(
      { className: cn(chipVariants({ variant, size }), className) },
      { "data-slot": "chip" } as object,
      props,
    ),
  });
}

/** The colored dot a chip leads with (a label's color). */
function ChipDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      data-slot="chip-dot"
      className="size-1.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

/** The × that removes a chip; on the smallest chips it shows on hover. */
function ChipRemove({
  label,
  onRemove,
  reveal = false,
  className,
}: {
  label: string;
  onRemove: () => void;
  /** Hidden until the chip is hovered or focused. */
  reveal?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-slot="chip-remove"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className={cn(
        "-me-1 flex shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-foreground/15",
        reveal ? "hidden size-3.5 group-hover/chip:flex focus-visible:flex" : "size-5 rounded-md",
        className,
      )}
    >
      <XIcon className={reveal ? "size-2.5" : "size-3"} strokeWidth={reveal ? 3 : 2} />
    </button>
  );
}

export { Chip, ChipDot, ChipRemove, chipVariants };
export type ChipProps = React.ComponentProps<typeof Chip>;
