import type { LucideIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "~/lib/utils";

function EmptyState({
  title,
  description,
  actions,
  media,
  icon: Icon,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  media?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex min-w-0 flex-col items-center justify-center gap-4 p-6 text-center text-balance",
        className,
      )}
      {...props}
    >
      {media ? <div className="flex items-center justify-center">{media}</div> : null}
      {Icon ? <Icon className="size-10 text-icon-muted" strokeWidth={1.5} aria-hidden /> : null}
      {title || description ? (
        <div className="flex max-w-md flex-col items-center gap-2">
          {title ? (
            <h1 className="text-2xl leading-[30px] font-normal tracking-[-0.01em] text-foreground">
              {title}
            </h1>
          ) : null}
          {description ? (
            <p className="text-sm leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      {actions ? <div className="mt-1 flex flex-col items-center gap-2">{actions}</div> : null}
      {children}
    </div>
  );
}

export { EmptyState };
