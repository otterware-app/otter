import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import * as React from "react";

import { cn } from "../lib/utils";

/** At the app's root: one tooltip after another opens at once, as on macOS. */
function TooltipProvider({
  delay = 500,
  timeout = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delay={delay} timeout={timeout} {...props} />;
}

const Tooltip = TooltipPrimitive.Root;

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipPopup({
  className,
  align = "center",
  sideOffset = 6,
  side = "top",
  variant = "default",
  anchor,
  children,
  ...props
}: Omit<TooltipPrimitive.Popup.Props, "className"> & {
  className?: string;
  align?: TooltipPrimitive.Positioner.Props["align"];
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: TooltipPrimitive.Positioner.Props["sideOffset"];
  variant?: "default" | "glass" | "code";
  anchor?: TooltipPrimitive.Positioner.Props["anchor"];
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        anchor={anchor}
        className="pointer-events-none z-[140] h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] data-instant:transition-none"
        collisionPadding={6}
        data-slot="tooltip-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          className={cn(
            "relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) text-balance rounded-lg text-popover-foreground text-xs transition-[width,height,scale,opacity] duration-120 data-ending-style:scale-98 data-ending-style:opacity-0 data-instant:duration-0 data-starting-style:scale-98 data-starting-style:opacity-0",
            variant === "glass"
              ? "dropdown-glass shadow-xl shadow-black/25"
              : "border border-border/60 bg-popover shadow-lg/10",
            variant === "code"
              ? "max-w-120 wrap-anywhere text-left font-mono text-2xs leading-relaxed"
              : "max-w-80 wrap-anywhere whitespace-normal leading-snug",
            className,
          )}
          data-slot="tooltip-popup"
          {...props}
        >
          <TooltipPrimitive.Viewport
            className="relative size-full overflow-clip px-(--viewport-inline-padding) py-1 [--viewport-inline-padding:--spacing(2)] data-instant:transition-none **:data-current:data-ending-style:opacity-0 **:data-current:data-starting-style:opacity-0 **:data-previous:data-ending-style:opacity-0 **:data-previous:data-starting-style:opacity-0 **:data-current:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:truncate **:data-current:opacity-100 **:data-previous:opacity-100 **:data-current:transition-opacity **:data-previous:transition-opacity"
            data-slot="tooltip-viewport"
          >
            {children}
          </TooltipPrimitive.Viewport>
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

/**
 * The tooltip most controls wear: what it is, and a hint after it (a
 * shortcut). `children` is the one element it describes.
 */
function HintTooltip({
  label,
  hint,
  side = "top",
  disabled = false,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  disabled?: boolean;
  children: React.ReactElement;
}) {
  return (
    <Tooltip disabled={disabled} disableHoverablePopup>
      <TooltipTrigger render={children} />
      <TooltipPopup side={side}>
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span>{label}</span>
          {hint ? <span className="text-muted-foreground empty:hidden">{hint}</span> : null}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

export {
  HintTooltip,
  Tooltip,
  TooltipPopup,
  TooltipPopup as TooltipContent,
  TooltipProvider,
  TooltipTrigger,
};
