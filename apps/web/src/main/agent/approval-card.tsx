import { EllipsisIcon, FileIcon, HandIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { ApprovalDecision, ApprovalRequest } from "../mail/api";
import { COMPOSER_SURFACE } from "../mail/composer-kit";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";
import { Button, IconButton } from "@otter/ui/components/button";
import { cn } from "@otter/ui/lib/utils";
import { Kbd } from "@otter/ui/components/kbd";

const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

function Files({ paths }: { paths: string[] }) {
  const shown = paths.slice(0, 3);
  return (
    <>
      {shown.map((path, i) => (
        <span key={path}>
          {i > 0 ? (i === shown.length - 1 && paths.length <= 3 ? " and " : ", ") : null}
          <span title={path} className="whitespace-nowrap text-info-foreground">
            <FileIcon className="mr-1 inline size-3.5 -translate-y-px" aria-hidden />
            {basename(path)}
          </span>
        </span>
      ))}
      {paths.length > 3 ? ` and ${paths.length - 3} more` : null}
    </>
  );
}

function question(agent: string, approval: ApprovalRequest): ReactNode {
  switch (approval.kind) {
    case "command":
      return `Allow ${agent} to run this command?`;
    case "fileChange": {
      const paths = (approval.detail ?? "").split("\n").filter(Boolean);
      return paths.length > 0 ? (
        <>
          Allow {agent} to edit <Files paths={paths} />?
        </>
      ) : (
        `Allow ${agent} to edit files?`
      );
    }
    case "permission":
      return `Allow ${agent} to change its permissions?`;
    case "tool":
      return approval.title === "Tool approval"
        ? `Allow ${agent} to use a tool?`
        : `Allow ${agent} to ${approval.title[0]!.toLowerCase()}${approval.title.slice(1)}?`;
  }
}

export function ApprovalCard({
  agent,
  approval,
  pendingCount,
  responding,
  onRespond,
  onCancel,
}: {
  agent: string;
  approval: ApprovalRequest;
  pendingCount: number;
  responding: boolean;
  onRespond: (decision: ApprovalDecision) => void;
  onCancel: () => void;
}) {
  const allow = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) allow.current?.focus();
  }, []);

  const more = [
    ...(approval.choices.includes("session")
      ? [{ label: "Allow for this chat", run: () => onRespond("session") }]
      : []),
    ...(approval.choices.includes("always")
      ? [{ label: "Always allow", run: () => onRespond("always") }]
      : []),
    { label: "Stop the agent", run: onCancel },
  ];
  const code = approval.kind === "command" || approval.kind === "permission";
  const note = [approval.reason, approval.kind === "tool" ? approval.detail : undefined]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      role="group"
      aria-label={approval.title}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || responding) return;
        event.preventDefault();
        onRespond("deny");
      }}
      className={cn("flex flex-col gap-3 px-4 pt-3.5 pb-3", COMPOSER_SURFACE)}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <HandIcon className="size-3.5" aria-hidden />
        <span>Permissions</span>
        {pendingCount > 1 ? (
          <span className="ml-auto tabular-nums">1 of {pendingCount}</span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-md leading-snug text-foreground">{question(agent, approval)}</p>
        {note ? (
          <p className="max-h-24 overflow-auto whitespace-pre-line text-body text-muted-foreground [scrollbar-width:thin]">
            {note}
          </p>
        ) : null}
        {code && approval.detail ? (
          <code className="block max-h-24 overflow-auto rounded-lg bg-muted/60 px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap text-foreground [overflow-wrap:anywhere] [scrollbar-width:thin]">
            {approval.detail}
          </code>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={responding}
            render={<IconButton label="More options" className="rounded-pill" />}
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end">
            {more.map((item) => (
              <DropdownMenuItem key={item.label} onClick={item.run}>
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          disabled={responding}
          onClick={() => onRespond("deny")}
          className="rounded-pill pr-1.5"
        >
          Deny
          <Kbd>Esc</Kbd>
        </Button>
        <Button
          ref={allow}
          size="sm"
          disabled={responding}
          onClick={() => onRespond("once")}
          className="rounded-pill pr-1.5 focus:ring-2 focus:ring-focus-ring focus:ring-offset-1 focus:ring-offset-(--chat-composer-surface)"
        >
          Allow once
          <Kbd>↩</Kbd>
        </Button>
      </div>
    </div>
  );
}
