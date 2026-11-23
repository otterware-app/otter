import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";
import { Button } from "./button";

type DialogSize = "small" | "medium" | "large" | "xl";

const SIZE_CLASS: Record<DialogSize, string> = {
  small: "max-w-80",
  medium: "max-w-100",
  large: "max-w-125",
  xl: "max-w-187.5",
};

type DialogAction = {
  label: React.ReactNode;
  onClick: () => void | Promise<void>;
};

type DialogProps = Omit<DialogPrimitive.Root.Props, "children"> & {
  children?: React.ReactNode;
  trigger?: React.ReactElement;
  title?: React.ReactNode;
  hideTitle?: boolean;
  description?: React.ReactNode;
  onConfirm?: () => void | Promise<void>;
  confirmLabel?: React.ReactNode;
  confirmVariant?: "primary" | "destructive";
  confirmDisabled?: boolean;
  destructiveAction?: DialogAction;
  secondaryAction?: DialogAction;
  size?: DialogSize;
};

/** Escape closes the dialog, unless what has focus closes on its own Escape first (a find bar). */
function keepOwnEscape(
  onOpenChange: DialogPrimitive.Root.Props["onOpenChange"],
): NonNullable<DialogPrimitive.Root.Props["onOpenChange"]> {
  return (open, details) => {
    const target = details.event?.target as Element | null | undefined;
    if (!open && details.reason === "escape-key" && target?.closest?.("[data-own-escape]")) {
      details.cancel();
      return;
    }
    onOpenChange?.(open, details);
  };
}

/**
 * A dialog. Given a `title` (and `onConfirm`, actions…) it lays itself out as a
 * confirmation; given only children it is the bare root, for `DialogContent`.
 */
function Dialog({
  trigger,
  title,
  hideTitle = false,
  description,
  onConfirm,
  confirmLabel,
  confirmVariant = "primary",
  confirmDisabled,
  destructiveAction,
  secondaryAction,
  size = "medium",
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: DialogProps) {
  const propsMode =
    trigger !== undefined ||
    title !== undefined ||
    description !== undefined ||
    onConfirm !== undefined;

  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false);
  const popupRef = React.useRef<HTMLDivElement>(null);
  const actionsRef = React.useRef<DialogPrimitive.Root.Actions>(null);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  if (!propsMode) {
    return (
      <DialogPrimitive.Root
        open={controlledOpen}
        defaultOpen={defaultOpen}
        onOpenChange={keepOwnEscape(onOpenChange)}
        {...props}
      >
        {children}
      </DialogPrimitive.Root>
    );
  }

  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
  };
  const hasBody = children !== undefined && children !== null && children !== false;

  return (
    <DialogPrimitive.Root
      open={open}
      actionsRef={actionsRef}
      onOpenChange={keepOwnEscape((next, details) => {
        setOpen(next);
        onOpenChange?.(next, details);
      })}
      {...props}
    >
      {trigger ? <DialogPrimitive.Trigger render={trigger} /> : null}
      <DialogContent
        ref={popupRef}
        size={size}
        initialFocus={() => {
          // A body with its own controls gets the default (its first control); a
          // plain confirmation focuses the default button, so Enter and Space act
          // on it as on macOS.
          const popup = popupRef.current;
          if (!popup) return true;
          const bodyControl = popup.querySelector(
            "[data-dialog-body] :is(button, input, textarea, select, a[href], [contenteditable], [tabindex]:not([tabindex='-1']))",
          );
          if (bodyControl) return true;
          return (
            popup.querySelector<HTMLButtonElement>("[data-dialog-confirm]:not(:disabled)") ?? true
          );
        }}
      >
        <PropsDialogBody
          title={title}
          hideTitle={hideTitle}
          description={description}
          onConfirm={onConfirm}
          confirmLabel={confirmLabel}
          confirmVariant={confirmVariant}
          confirmDisabled={confirmDisabled}
          destructiveAction={destructiveAction}
          secondaryAction={secondaryAction}
          onDone={() => actionsRef.current?.close()}
        >
          {hasBody ? children : null}
        </PropsDialogBody>
      </DialogContent>
    </DialogPrimitive.Root>
  );
}

function PropsDialogBody({
  title,
  hideTitle,
  description,
  onConfirm,
  confirmLabel,
  confirmVariant,
  confirmDisabled,
  destructiveAction,
  secondaryAction,
  onDone,
  children,
}: Pick<
  DialogProps,
  | "title"
  | "hideTitle"
  | "description"
  | "onConfirm"
  | "confirmLabel"
  | "confirmVariant"
  | "confirmDisabled"
  | "destructiveAction"
  | "secondaryAction"
> & { onDone: () => void; children: React.ReactNode }) {
  const [pending, setPending] = React.useState(false);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = async (handler: () => void | Promise<void>, closeOnSuccess: boolean) => {
    setPending(true);
    try {
      await handler();
      if (closeOnSuccess && mounted.current) onDone();
    } catch {
      // Stay open: the handler surfaces its own error (usually a toast).
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  const canConfirm = onConfirm !== undefined && !confirmDisabled && !pending;
  const confirm = () => {
    if (onConfirm && canConfirm) void run(onConfirm, true);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.defaultPrevented) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const target = event.target as HTMLElement;
    const multiline = target.closest("textarea, [contenteditable=''], [contenteditable='true']");
    const otherControl = target.closest("button, a[href], [role='button'], [role='option']");
    const modifier = event.metaKey || event.ctrlKey;
    if ((multiline || otherControl) && !modifier) return;
    event.preventDefault();
    confirm();
  };

  const hasLeft = destructiveAction !== undefined || secondaryAction !== undefined;
  const hasFooter = onConfirm !== undefined || hasLeft;

  return (
    <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
      <DialogHeader className={cn(hideTitle && "sr-only")}>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      {children ? (
        <div
          data-dialog-body=""
          className={cn(
            "flex max-h-[60vh] min-h-0 flex-col gap-3 overflow-y-auto px-6 text-sm leading-5 text-foreground",
            hasFooter ? "pb-1" : "pb-5",
          )}
        >
          {children}
        </div>
      ) : null}
      {hasFooter ? (
        <DialogFooter className={cn(hasLeft && "sm:justify-between")}>
          {hasLeft ? (
            <div className="flex gap-2">
              {destructiveAction ? (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => void run(destructiveAction.onClick, false)}
                >
                  {destructiveAction.label}
                </Button>
              ) : null}
              {secondaryAction ? (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => void run(secondaryAction.onClick, false)}
                >
                  {secondaryAction.label}
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            {onConfirm ? (
              <Button
                data-dialog-confirm=""
                variant={confirmVariant}
                disabled={!canConfirm}
                onClick={confirm}
              >
                {confirmLabel ?? "Done"}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      ) : null}
    </div>
  );
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogBackdrop({
  className,
  ...props
}: Omit<DialogPrimitive.Backdrop.Props, "className"> & { className?: string }) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-backdrop"
      className={cn(
        "dialog-backdrop fixed inset-0 z-[100] transition-opacity duration-160 ease-out [-webkit-app-region:no-drag] data-ending-style:opacity-0 data-ending-style:duration-120 data-ending-style:ease-in data-starting-style:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  size = "medium",
  showCloseButton = false,
  backdropClassName,
  ...props
}: Omit<DialogPrimitive.Popup.Props, "className"> & {
  className?: string;
  size?: DialogSize;
  showCloseButton?: boolean;
  backdropClassName?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogBackdrop className={backdropClassName} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "dialog-glass fixed top-1/2 left-1/2 z-[100] flex max-h-[85vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border text-popover-foreground outline-none transition-[opacity,scale] duration-180 ease-drawer [-webkit-app-region:no-drag] data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:duration-120 data-ending-style:ease-in data-starting-style:scale-97 data-starting-style:opacity-0",
          SIZE_CLASS[size],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute end-3 top-3 inline-flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent-surface hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <XIcon className="size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 px-6 pt-6 pb-4", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 px-6 pt-5 pb-6 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: Omit<DialogPrimitive.Title.Props, "className"> & { className?: string }) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-base leading-[22px] font-medium text-foreground", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: Omit<DialogPrimitive.Description.Props, "className"> & { className?: string }) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm leading-5 text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogProps,
};
