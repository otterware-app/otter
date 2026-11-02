import type { ErrorComponentProps } from "@tanstack/react-router";

import { Button } from "./button";

function ErrorBoundaryView({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="drag-region fixed top-0 right-0 left-0 h-(--workspace-topbar-height)" />
      <div className="flex max-w-md flex-col gap-1.5">
        <h1 className="text-2xl leading-[30px] font-normal tracking-[-0.01em] text-foreground">
          Something went wrong
        </h1>
        <p className="text-sm leading-5 break-words text-muted-foreground select-text">{message}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button variant="accent" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}

export { ErrorBoundaryView };
