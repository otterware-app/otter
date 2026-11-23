import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { readableError } from "../mail/add-mailbox";
import { useAgentProviders } from "./agent-providers";
import { regenerateTitle, renameChat, type Conversation } from "./chat-store";
import { toast } from "@otter/ui/components/toast";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@otter/ui/components/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";
import { cn } from "@otter/ui/lib/utils";

/** A chat's title in a header: double-click to rename, right-click to rename or regenerate it.
 *  With a `menu`, a click opens it instead, and double-click doesn't rename. */
export function ChatTitle({
  chat,
  className,
  menu,
}: {
  chat: Conversation;
  className?: string;
  menu?: ReactNode;
}) {
  const providers = useAgentProviders().data?.providers ?? [];
  const titles = Boolean(providers.find((p) => p.id === chat.provider)?.titles);
  const [renaming, setRenaming] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  if (renaming)
    return (
      <span className={cn("no-drag flex min-w-0 flex-1", className)}>
        <TitleInput
          title={chat.title}
          onDone={(title) => {
            setRenaming(false);
            if (title === null) return;
            if (!title.trim()) toast.warning("A chat's title can't be empty");
            else void renameChat(chat.id, title, titles);
          }}
        />
      </span>
    );
  return (
    <span className="flex min-w-0 flex-1">
      <ContextMenu>
        {menu ? (
          <DropdownMenu>
            <ContextMenuTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <TitleMenuButton className={cn(regenerating && "opacity-55", className)} />
                  }
                />
              }
            >
              {chat.title}
            </ContextMenuTrigger>
            <DropdownMenuContent>{menu}</DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <ContextMenuTrigger
            render={
              <span
                onDoubleClick={(e) => {
                  e.preventDefault();
                  setRenaming(true);
                }}
              />
            }
            className={cn(
              "no-drag min-w-0 cursor-default truncate",
              regenerating && "opacity-55",
              className,
            )}
          >
            {chat.title}
          </ContextMenuTrigger>
        )}
        <ContextMenuContent>
          <ContextMenuItem onClick={() => setRenaming(true)}>Rename</ContextMenuItem>
          {titles && chat.sessionId ? (
            <ContextMenuItem
              disabled={regenerating}
              onClick={() => {
                setRegenerating(true);
                void regenerateTitle(chat.id)
                  .catch((err: unknown) =>
                    toast.error("Couldn't regenerate the title", {
                      description: readableError(err),
                    }),
                  )
                  .finally(() => setRegenerating(false));
              }}
            >
              {regenerating ? "Regenerating…" : "Regenerate title"}
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    </span>
  );
}

/** A header's title that opens a menu. */
export function TitleMenuButton({ className, children, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "no-drag -mx-1.5 flex h-7 min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-focus-ring data-popup-open:bg-foreground/[0.06]",
        className,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** Mounted only while renaming; Enter and Escape unmount it, and that blur mustn't save again. */
export function TitleInput({
  title,
  onDone,
}: {
  title: string;
  onDone: (title: string | null) => void;
}) {
  const [value, setValue] = useState(title);
  const done = useRef(false);
  const finish = (title: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(title);
  };
  return (
    <input
      autoFocus
      value={value}
      dir="auto"
      aria-label="Chat title"
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          finish(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(value)}
      className="-my-px min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm text-card-foreground outline-none focus:border-foreground"
    />
  );
}
