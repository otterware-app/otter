import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "~/lib/utils";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 cursor-pointer items-center rounded-full p-[2px] outline-none [--thumb-size:--spacing(4.5)] focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-canvas data-checked:bg-focus-ring data-unchecked:bg-foreground/16 data-disabled:cursor-not-allowed data-disabled:opacity-64",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[calc(var(--thumb-size)-2px)] shrink-0 rounded-full bg-white shadow-sm/20 transition-transform duration-200 data-checked:translate-x-[calc(var(--thumb-size)-4px)]"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
