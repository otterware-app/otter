import { Avatar as AvatarPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "~/lib/utils";

const SIZE_CLASS = {
  small: "size-7 text-2xs",
  medium: "size-8 text-2xs",
  large: "size-9 text-[13px]",
} as const;

function Avatar({
  className,
  size = "medium",
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & { size?: keyof typeof SIZE_CLASS }) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative inline-flex shrink-0 select-none overflow-hidden rounded-full",
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
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
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-accent-surface font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback, AvatarImage };
