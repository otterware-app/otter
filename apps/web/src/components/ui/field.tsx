import * as React from "react";

import { cn } from "~/lib/utils";

function Field({
  label,
  description,
  error,
  orientation = "vertical",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  orientation?: "vertical" | "horizontal";
}) {
  const generatedId = React.useId();
  const items = React.Children.toArray(children);
  const single = items.length === 1 && React.isValidElement(items[0]) ? items[0] : null;
  const child = single as React.ReactElement<{ id?: string }> | null;
  const controlId = child?.props.id || generatedId;
  const control = child ? React.cloneElement(child, { id: controlId }) : children;

  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      data-invalid={error ? "" : undefined}
      className={cn(
        "flex gap-1.5",
        orientation === "vertical" ? "flex-col" : "items-center justify-between gap-3",
        className,
      )}
      {...props}
    >
      {label || description ? (
        <div className="flex min-w-0 flex-col gap-0.5">
          {label ? (
            <label
              htmlFor={controlId}
              data-slot="field-label"
              className="text-[13px] text-muted-foreground"
            >
              {label}
            </label>
          ) : null}
          {description ? (
            <p data-slot="field-description" className="text-xs text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      {control}
      {error ? (
        <p data-slot="field-error" className="text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { Field };
