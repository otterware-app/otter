import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border font-normal outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-64 data-disabled:pointer-events-none data-disabled:opacity-64 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { size: "default", variant: "outline" },
    variants: {
      variant: {
        primary: "border-transparent bg-primary text-primary-foreground hover:bg-primary/88",
        outline: "border-border bg-transparent text-foreground hover:bg-accent-surface",
        secondary:
          "border-transparent bg-accent-surface text-foreground hover:bg-accent-surface/80",
        ghost: "border-transparent text-foreground hover:bg-accent-surface",
        "ghost-muted":
          "border-transparent text-muted-foreground hover:bg-accent-surface hover:text-foreground",
        destructive: "border-transparent bg-destructive text-white hover:bg-destructive/88",
        "ghost-destructive":
          "border-transparent text-destructive-foreground hover:bg-destructive/10 [&_svg]:text-destructive-foreground",
        link: "h-auto border-transparent px-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-6 gap-1 px-[calc(--spacing(2)-1px)] text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-7 px-[calc(--spacing(2.5)-1px)] text-body [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-8 px-[calc(--spacing(3)-1px)] text-sm [&_svg:not([class*='size-'])]:size-4",
        lg: "h-9 px-[calc(--spacing(3.5)-1px)] text-sm [&_svg:not([class*='size-'])]:size-4",
        xl: "h-10 px-5 text-md [&_svg:not([class*='size-'])]:size-4",
        "icon-xs": "size-6 px-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7 px-0 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-8 px-0 [&_svg:not([class*='size-'])]:size-4",
      },
    },
  },
);

type ButtonProps = Omit<ButtonPrimitive.Props, "className"> &
  VariantProps<typeof buttonVariants> & { className?: string };

function Button({ className, variant, size, type, ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      type={type ?? "button"}
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

/** A square, quiet button showing only an icon; `label` is what it reads as. */
function IconButton({
  label,
  active = false,
  size = "icon-sm",
  className,
  ...props
}: Omit<ButtonProps, "variant" | "size"> & {
  label: string;
  active?: boolean;
  size?: "icon-xs" | "icon-sm" | "icon";
}) {
  return (
    <Button
      aria-label={label}
      data-active={active ? "" : undefined}
      variant="ghost-muted"
      size={size}
      className={cn(active && "bg-accent-surface text-foreground", className)}
      {...props}
    />
  );
}

export { Button, IconButton, buttonVariants, type ButtonProps };
