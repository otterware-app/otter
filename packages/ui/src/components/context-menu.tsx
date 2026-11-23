import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";

import { cn } from "../lib/utils";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  keyboardOnlyFocus,
  menuPopupClassName,
} from "./dropdown-menu";

/** The menu a right-click opens. Its rows are the dropdown menu's. */
function ContextMenu(props: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root {...props} />;
}

/** Without `render` the trigger adds no box (display: contents), like the native one. */
function ContextMenuTrigger({
  render,
  className,
  ...props
}: Omit<ContextMenuPrimitive.Trigger.Props, "className"> & { className?: string }) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      render={render}
      className={render ? className : cn("contents", className)}
      {...props}
    />
  );
}

function ContextMenuContent({
  className,
  ...props
}: Omit<ContextMenuPrimitive.Popup.Props, "className"> & { className?: string }) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner className="z-[130] outline-none" collisionPadding={8}>
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          finalFocus={keyboardOnlyFocus}
          className={cn(menuPopupClassName, className)}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  DropdownMenuCheckboxItem as ContextMenuCheckboxItem,
  DropdownMenuGroup as ContextMenuGroup,
  DropdownMenuItem as ContextMenuItem,
  DropdownMenuLabel as ContextMenuLabel,
  DropdownMenuRadioGroup as ContextMenuRadioGroup,
  DropdownMenuRadioItem as ContextMenuRadioItem,
  DropdownMenuSeparator as ContextMenuSeparator,
  DropdownMenuSub as ContextMenuSub,
};
