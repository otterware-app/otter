import { useRef, useState } from "react";
import { readableError } from "./add-mailbox";
import { useAgentProviders } from "./agent-providers";
import { regenerateTitle, renameChat, type Conversation } from "./chat-store";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./menu";
import { toast } from "./toast";
import { cn } from "./ui";

/** A chat's title in a header: double-click to rename, right-click to rename or regenerate it. */
export function ChatTitle({ chat, className }: { chat: Conversation; className?: string }) {
  const providers = useAgentProviders().data?.providers ?? [];
  const titles = Boolean(providers.find((p) => p.kind === chat.provider)?.titles);
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
        <ContextMenuTrigger asChild>
          <span
            onDoubleClick={(e) => {
              e.preventDefault();
              setRenaming(true);
            }}
            className={cn(
              "no-drag min-w-0 cursor-default truncate",
              regenerating && "opacity-55",
              className,
            )}
          >
            {chat.title}
          </span>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => setRenaming(true)}>Rename</ContextMenuItem>
          {titles && chat.sessionId ? (
            <ContextMenuItem
              disabled={regenerating}
              onSelect={() => {
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
