import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "~/lib/utils";

/** Native scrolling with a thumb over the content, shown only while scrolling
 * or pointing at its edge. Layout never reserves a scrollbar lane. */
export function ScrollArea({
  className,
  viewportClassName,
  contentClassName,
  children,
  ...props
}: Omit<ScrollAreaPrimitive.Viewport.Props, "className"> & {
  className?: string;
  viewportClassName?: string;
  contentClassName?: string;
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative min-h-0 min-w-0 overflow-hidden", className)}
    >
      <ScrollAreaPrimitive.Viewport
        {...props}
        data-slot="scroll-area-viewport"
        // Focusable once it can scroll (keys scroll it), but a click on empty
        // space focuses it too, and the next keypress would ring the whole pane.
        className={cn("size-full outline-none", viewportClassName)}
      >
        <ScrollAreaPrimitive.Content className={cn("min-h-full min-w-0!", contentClassName)}>
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        data-slot="scroll-area-scrollbar"
        className="absolute inset-y-0 right-0 z-20 flex w-2 touch-none select-none p-px opacity-0 transition-opacity delay-500 duration-150 hover:opacity-100 hover:delay-0 data-scrolling:opacity-100 data-scrolling:delay-0 motion-reduce:transition-none"
      >
        <ScrollAreaPrimitive.Thumb className="w-full rounded-full bg-(--app-scrollbar-thumb) hover:bg-(--app-scrollbar-thumb-hover)" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  );
}
