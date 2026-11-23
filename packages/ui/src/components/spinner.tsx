import { LoaderCircleIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/utils";

/** Work under way, where there's nothing better to show. */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <LoaderCircleIcon
      role="status"
      aria-label="Loading"
      data-slot="spinner"
      className={cn("size-4 animate-spin text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Spinner };
