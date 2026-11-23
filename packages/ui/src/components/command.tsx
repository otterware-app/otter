import { Autocomplete } from "@base-ui/react/autocomplete";
import { SearchIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/utils";

type ClassName = { className?: string };

/**
 * A searchable list of choices, always open (a command palette, a label
 * picker): Base UI's Autocomplete inline. Pass the choices as `items`; the
 * list renders them through a function, filtered by what's typed.
 */
function Command<ItemValue>({
  className,
  children,
  ...props
}: Omit<Autocomplete.Root.Props<ItemValue>, "open" | "inline" | "items"> &
  ClassName & { items?: readonly ItemValue[] }) {
  return (
    <Autocomplete.Root open inline autoHighlight="always" keepHighlight {...props}>
      <div
        data-slot="command"
        className={cn("flex size-full min-h-0 flex-col overflow-hidden text-foreground", className)}
      >
        {children}
      </div>
    </Autocomplete.Root>
  );
}

function CommandInput({
  className,
  ...props
}: Omit<Autocomplete.Input.Props, "className"> & ClassName) {
  return (
    <Autocomplete.InputGroup
      data-slot="command-input-wrapper"
      className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border/50 px-4"
    >
      <SearchIcon className="size-4 shrink-0 text-icon-muted" aria-hidden />
      <Autocomplete.Input
        data-slot="command-input"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-placeholder",
          className,
        )}
        {...props}
      />
    </Autocomplete.InputGroup>
  );
}

function CommandList({
  className,
  ...props
}: Omit<Autocomplete.List.Props, "className"> & ClassName) {
  return (
    <Autocomplete.List
      data-slot="command-list"
      className={cn(
        "max-h-90 scroll-py-1.5 overflow-y-auto overflow-x-hidden p-1.5 empty:hidden",
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: Omit<Autocomplete.Empty.Props, "className"> & ClassName) {
  return (
    <Autocomplete.Empty
      data-slot="command-empty"
      className={cn("text-center text-sm text-muted-foreground not-empty:py-10", className)}
      {...props}
    />
  );
}

/** A heading over the list's rows. */
function CommandLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="command-label"
      className={cn("px-2.5 pt-2 pb-1 text-body text-muted-foreground", className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  ...props
}: Omit<Autocomplete.Item.Props, "className"> & ClassName) {
  return (
    <Autocomplete.Item
      data-slot="command-item"
      className={cn(
        "flex min-h-8 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-none data-disabled:pointer-events-none data-disabled:opacity-64 data-highlighted:bg-foreground/[0.07] data-highlighted:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Command, CommandEmpty, CommandInput, CommandItem, CommandLabel, CommandList };
