import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/utils";

/** Focus goes back to the trigger only after keyboard use: WebKit paints a
 *  restored focus as keyboard focus (a ring) even after a click. */
const keyboardOnlyFocus = (closeType: string) => closeType === "keyboard";

const POPUP =
  "dropdown-glass z-[130] max-h-(--available-height) min-w-44 origin-(--transform-origin) overflow-y-auto rounded-xl p-1.5 text-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-none transition-[opacity,scale] duration-100 data-ending-style:scale-98 data-ending-style:opacity-0 data-instant:duration-0 data-starting-style:scale-98 data-starting-style:opacity-0 dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]";

const ROW =
  "relative flex min-h-8 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-1 text-sm outline-none data-disabled:pointer-events-none data-disabled:opacity-64 data-highlighted:bg-foreground/[0.07] data-highlighted:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground";

const DESTRUCTIVE =
  "text-destructive-foreground [&_svg:not([class*='text-'])]:text-destructive-foreground";

type ClassName = { className?: string };
/** Base UI items act on `onClick` (with `closeOnClick`); a DOM `onSelect` would never fire. */
type NoSelect = { onSelect?: never };

/** Menus are non-modal: the page keeps scrolling and an outside click still lands. */
function DropdownMenu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root modal={false} {...props} />;
}

function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

type PositionProps = Pick<
  MenuPrimitive.Positioner.Props,
  "side" | "align" | "sideOffset" | "alignOffset" | "anchor" | "collisionPadding"
>;

/** The popup, positioned against its trigger (or `anchor`). */
function DropdownMenuContent({
  className,
  side,
  align = "start",
  sideOffset = 4,
  alignOffset,
  anchor,
  collisionPadding = 8,
  ...props
}: Omit<MenuPrimitive.Popup.Props, "className"> & ClassName & PositionProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="z-[130] outline-none"
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        anchor={anchor}
        collisionPadding={collisionPadding}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          finalFocus={keyboardOnlyFocus}
          className={cn(POPUP, className)}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

type ItemExtras = {
  icon?: React.ReactNode;
  /** A shortcut shown at the end of the row (⌘K). */
  accelerator?: string;
  variant?: "default" | "destructive";
};

function DropdownMenuItem({
  className,
  icon,
  accelerator,
  variant = "default",
  children,
  ...props
}: Omit<MenuPrimitive.Item.Props, "className" | "onSelect"> & ClassName & ItemExtras & NoSelect) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(ROW, variant === "destructive" && DESTRUCTIVE, className)}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {accelerator ? <MenuShortcut>{accelerator}</MenuShortcut> : null}
    </MenuPrimitive.Item>
  );
}

function MenuShortcut({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="dropdown-menu-shortcut"
      className={cn("ms-auto font-sans text-xs tracking-widest text-muted-foreground", className)}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  closeOnClick = true,
  ...props
}: Omit<MenuPrimitive.CheckboxItem.Props, "className" | "onSelect"> & ClassName & NoSelect) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      closeOnClick={closeOnClick}
      className={cn(ROW, "ps-8", className)}
      {...props}
    >
      <span className="absolute start-2.5 flex size-4 items-center justify-center">
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-3.5 text-foreground" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </MenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
  className,
  children,
  closeOnClick = true,
  ...props
}: Omit<MenuPrimitive.RadioItem.Props, "className" | "onSelect"> & ClassName & NoSelect) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      closeOnClick={closeOnClick}
      className={cn(ROW, "ps-8", className)}
      {...props}
    >
      <span className="absolute start-2.5 flex size-4 items-center justify-center">
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon className="size-3.5 text-foreground" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </MenuPrimitive.RadioItem>
  );
}

function DropdownMenuSeparator({ className }: ClassName) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("mx-2.5 my-1 h-px bg-border/70", className)}
    />
  );
}

function DropdownMenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

/** A heading over the rows that follow; inside a `DropdownMenuGroup` it names the group. */
function DropdownMenuLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dropdown-menu-label"
      className={cn("px-2.5 pt-1.5 pb-1 text-body text-muted-foreground", className)}
      {...props}
    />
  );
}

/** A row that opens a submenu of `children`. `trigger` replaces the row (an icon button). */
function DropdownMenuSub({
  label,
  icon,
  detail,
  trigger,
  inset,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  detail?: string;
  trigger?: React.ReactElement;
  inset?: boolean;
  children: React.ReactNode;
}) {
  return (
    <MenuPrimitive.SubmenuRoot>
      {trigger ? (
        <MenuPrimitive.SubmenuTrigger aria-label={label} render={trigger} />
      ) : (
        <MenuPrimitive.SubmenuTrigger
          data-slot="dropdown-menu-sub-trigger"
          className={cn(ROW, inset && "ps-8", "data-popup-open:bg-foreground/[0.07]")}
        >
          {icon}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {detail ? <span className="text-body text-muted-foreground">{detail}</span> : null}
          <ChevronRightIcon className="ms-auto size-3.5 text-muted-foreground" />
        </MenuPrimitive.SubmenuTrigger>
      )}
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          className="z-[130] outline-none"
          sideOffset={4}
          alignOffset={-6}
          collisionPadding={8}
        >
          <MenuPrimitive.Popup data-slot="dropdown-menu-sub-content" className={POPUP}>
            {children}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.SubmenuRoot>
  );
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuTrigger,
  MenuShortcut,
  POPUP as menuPopupClassName,
  keyboardOnlyFocus,
};
