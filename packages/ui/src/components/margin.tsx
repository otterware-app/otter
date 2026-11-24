import type * as React from "react";

import { cn } from "../lib/utils";

/**
 * The Margin layout's page: rows of a time gutter, the column at the reading measure and the
 * margin beside it, centered. Narrower than the three, the gutter goes and the margin falls
 * under its column.
 */
function MarginPage({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="margin-page"
      className={cn("@container/margin mx-auto w-full max-w-[85rem] px-6", className)}
      {...props}
    />
  );
}

function MarginRow({
  gutter,
  margin,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** What sits left of the column: a time, a day. */
  gutter?: React.ReactNode;
  /** What sits beside it: details, an agent's note. */
  margin?: React.ReactNode;
}) {
  return (
    <div
      data-slot="margin-row"
      className={cn(
        "grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-3 @min-[64rem]/margin:grid-cols-[5rem_minmax(0,var(--reading-width,42.5rem))_15rem] @min-[64rem]/margin:justify-center",
        className,
      )}
      {...props}
    >
      <div
        data-slot="margin-gutter"
        className="hidden pt-0.5 text-right font-mono text-2xs text-placeholder tabular-nums @min-[64rem]/margin:block"
      >
        {gutter}
      </div>
      <div data-slot="margin-column" className="min-w-0">
        {children}
      </div>
      <aside data-slot="margin-margin" className="flex min-w-0 flex-col gap-4">
        {margin}
      </aside>
    </div>
  );
}

/** A section of a Margin page: a label on an ink rule, with a count. */
function SectionHead({
  label,
  count,
  attention = false,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  count?: React.ReactNode;
  /** Something in it needs you. */
  attention?: boolean;
}) {
  return (
    <div
      data-slot="section-head"
      className={cn(
        "flex items-center gap-2.5 border-t border-foreground py-2.5 font-mono text-2xs tracking-widest uppercase",
        attention ? "text-question-foreground" : "text-foreground",
        className,
      )}
      {...props}
    >
      <span>{label}</span>
      {count != null ? <span className="text-placeholder">{count}</span> : null}
    </div>
  );
}

/** What an agent writes in the margin beside an item: who, what, and what you can do with it. */
function MarginNote({
  who,
  actions,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** The agent and the kind of note: "Pilot · draft ready". */
  who: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      data-slot="margin-note"
      className={cn(
        "flex flex-col gap-1.5 border-l-2 border-question-foreground pl-3.5",
        className,
      )}
      {...props}
    >
      <span className="font-mono text-3xs tracking-wider text-question-foreground uppercase">
        {who}
      </span>
      <div className="font-reading text-sm leading-snug text-muted-foreground italic">
        {children}
      </div>
      {actions ? <div className="flex items-center gap-3.5 pt-1">{actions}</div> : null}
    </div>
  );
}

export { MarginNote, MarginPage, MarginRow, SectionHead };
