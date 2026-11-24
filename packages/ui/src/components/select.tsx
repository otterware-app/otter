import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/utils";
import { keyboardOnlyFocus } from "./dropdown-menu";

type ClassName = { className?: string };

/** Pass `items` (value → label) so the trigger can show the chosen label before the list opens. */
const Select = SelectPrimitive.Root;

function SelectTrigger({
  className,
  children,
  variant = "default",
  ...props
}: Omit<SelectPrimitive.Trigger.Props, "className"> &
  ClassName & {
    variant?: "default" | "pill";
  }) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "relative inline-flex cursor-pointer select-none items-center justify-between rounded-lg border text-left text-foreground outline-none focus-visible:border-focus-ring/60 focus-visible:ring-[3px] focus-visible:ring-focus-ring/16 data-disabled:pointer-events-none data-disabled:opacity-64",
        variant === "pill"
          ? "h-7 max-w-64 gap-1.5 border-border bg-transparent ps-2.5 pe-2 text-body hover:bg-accent-surface"
          : "h-8 min-w-36 gap-2 border-border/70 bg-surface-raised/60 px-[calc(--spacing(2.75)-1px)] text-sm hover:bg-surface-raised",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon
            className={cn("size-3.5 shrink-0 text-muted-foreground", variant !== "pill" && "-me-1")}
          />
        }
      />
    </SelectPrimitive.Trigger>
  );
}

function SelectValue({
  className,
  ...props
}: Omit<SelectPrimitive.Value.Props, "className"> & ClassName) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("min-w-0 flex-1 truncate data-placeholder:text-placeholder", className)}
      {...props}
    />
  );
}

/** The list, below its trigger (or `alignItemWithTrigger`, macOS's way: over it, on the chosen row). */
function SelectContent({
  className,
  children,
  side,
  align = "start",
  sideOffset = 4,
  alignItemWithTrigger = false,
  ...props
}: Omit<SelectPrimitive.Popup.Props, "className"> &
  ClassName &
  Pick<
    SelectPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        className="z-[130] outline-none"
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        collisionPadding={8}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          finalFocus={keyboardOnlyFocus}
          className={cn(
            "dropdown-glass max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-xl text-foreground shadow-overlay outline-none transition-[opacity,scale] duration-100 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.List className="p-1.5">{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: Omit<SelectPrimitive.Item.Props, "className"> & ClassName) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-lg py-1 pe-8 ps-2.5 text-sm outline-none data-disabled:pointer-events-none data-disabled:opacity-64 data-highlighted:bg-foreground/[0.07]",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute end-2.5 flex size-4 items-center justify-center">
        <CheckIcon className="size-4 text-foreground" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectLabel({
  className,
  ...props
}: Omit<SelectPrimitive.GroupLabel.Props, "className"> & ClassName) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-2.5 pt-1.5 pb-1 text-body text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectSeparator({ className }: ClassName) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("mx-2.5 my-1 h-px bg-border/70", className)}
    />
  );
}

export type SelectItems = React.ComponentProps<typeof SelectPrimitive.Root>["items"];

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
