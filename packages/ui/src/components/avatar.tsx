import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";

import { cn } from "../lib/utils";

const SIZE_CLASS = {
  xs: "size-4 text-4xs",
  sm: "size-5 text-3xs",
  md: "size-7 text-2xs",
  lg: "size-8 text-2xs",
  xl: "size-9 text-body",
} as const;

type ClassName = { className?: string };

/** A person's or a mailbox's picture, round, or `square` (a mailbox, an app). */
function Avatar({
  className,
  size = "lg",
  shape = "round",
  ...props
}: Omit<AvatarPrimitive.Root.Props, "className"> &
  ClassName & { size?: keyof typeof SIZE_CLASS; shape?: "round" | "square" }) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden",
        shape === "round" ? "rounded-full" : "rounded-md",
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({
  className,
  ...props
}: Omit<AvatarPrimitive.Image.Props, "className"> & ClassName) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      draggable={false}
      className={cn("size-full object-cover", className)}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: Omit<AvatarPrimitive.Fallback.Props, "className"> & ClassName) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center bg-accent-surface font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback, AvatarImage };
