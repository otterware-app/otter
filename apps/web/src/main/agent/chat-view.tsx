import { useCallback, useEffect, useState, type RefObject } from "react";
import { MessageScroller } from "@shadcn/react/message-scroller";
import { ArrowDownIcon, MailIcon } from "lucide-react";
import { ScrollArea } from "@otter/ui/components/scroll-area";
import { AgentFace, providerSummary } from "./agent-providers";
import { callTurns } from "@otter/client/agents/transcript";
import type { MailChatContext } from "@otter/client/agents/chat-context";
import { CiteSelectionButton, useCitations } from "./chat-cite";
import { AttachmentPreview, type PreviewFile } from "../mail/attachment-preview";
import { readChatFile, readChatImage } from "@otter/client/agents/chat-files";
import { canSteer, runAsking } from "@otter/client/agents/composer";
import { DropOverlay, useComposerAttachments, useFileDrop } from "./chat-attachments";
import {
  canReconnect,
  cancelQueuedEdit,
  editQueued,
  forkChat,
  isElsewhere,
  loadChat,
  reconnectChat,
  reconnectTargets,
  removeQueued,
  steerQueued,
  useChats,
  type Conversation,
  type QueuedMessage,
} from "@otter/client/agents/chat-store";
import { QueuedMessages } from "./chat-queue";
import { agentNameOf, waitingLabel } from "@otter/client/agents/chat-list";
import { ChatTranscript } from "./chat-transcript";
import { ChatComposer } from "./chat-composer";
import { AgentIcon } from "./agent-icon";
import { useOtterAccount } from "@otter/client/otter-account";
import { toast } from "@otter/ui/components/toast";
import { Button } from "@otter/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";
import { cn } from "@otter/ui/lib/utils";
import {
  type AgentId,
  type AgentSettingsPatch,
  type ChatChange,
  agentApi,
} from "@otter/client/agents/api";
import {
  canRunChat,
  isProviderUsable,
  kindList,
  openClawAgentId,
  useChatProvider,
  useSetProvidersState,
  type ChatProvider,
} from "@otter/client/agents/agent-providers";
import { appApi } from "../app-api";

const NO_QUEUE: QueuedMessage[] = [];

function useChatImageLoader(provider?: AgentId, sessionId?: string | null) {
  return useCallback(
    async (href: string) => {
      if (!provider) throw new Error("Open the image from its chat.");
      return readChatImage(provider, sessionId ?? null, href);
    },
    [provider, sessionId],
  );
}

export function ChatView({
  chatId,
  context,
  onClearQuote,
  inputRef,
  onOpenChange,
  onOpenFile,
  onShowChat,
  compact = false,
  centered = false,
}: {
  chatId: string;
  context: MailChatContext;
  onClearQuote?: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onOpenChange: (change: ChatChange) => Promise<void>;
  onOpenFile?: (href: string) => void;
  /** Shows another chat (a fork) where the shown one is the route's. */
  onShowChat?: (chatId: string) => void;
  compact?: boolean;
  /** A new chat over the backdrop: the composer waits mid-column, and glides down on send. */
  centered?: boolean;
}) {
  const convo = useChats((s) => s.conversations.find((c) => c.id === chatId));
  const device = useChats((s) => s.device);
  const unloaded = convo !== undefined && !convo.loaded;
  useEffect(() => {
    if (unloaded) void loadChat(chatId);
  }, [unloaded, chatId]);
  const streaming = useChats((s) => Boolean(s.runs[chatId]));
  const waitingOn = useChats((s) => s.runs[chatId]?.waiting);
  const queue = useChats((s) =>
    s.queue.some((m) => m.convoId === chatId) ? s.queue : NO_QUEUE,
  ).filter((m) => m.convoId === chatId);
  const editingQueued = useChats((s) =>
    s.editingQueued?.convoId === chatId ? s.editingQueued.id : null,
  );
  const canSendQueued = useChats((s) => canSteer(s, chatId));
  const asking = useChats((s) => runAsking(s, chatId));
  const hydrating = useChats((s) => s.hydrating === chatId);
  const turns = callTurns(convo?.turns ?? []);
  const chat = useChatProvider(convo);
  const otter = useOtterAccount();
  const setProvidersState = useSetProvidersState();
  const updateSettings = (patch: AgentSettingsPatch) => {
    console.log("[AgentChat:updateSettings]", patch);
    agentApi.updateSettings(patch).then(setProvidersState, () => {});
  };

  const files = useComposerAttachments();
  const drop = useFileDrop((dropped) => {
    void files.add(dropped);
    inputRef.current?.focus();
  });

  const [transcript, setTranscript] = useState<HTMLDivElement | null>(null);
  const citing = useCitations(chatId, () => inputRef.current?.focus());

  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const loadChatImage = useChatImageLoader(convo?.provider, convo?.sessionId);
  const previewChatFile = (href: string) => {
    if (!convo) return;
    void readChatFile(convo.provider, convo.sessionId, href)
      .then((file) => setPreviewFile({ ...file, load: async () => file.data }))
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "Couldn't open the file."),
      );
  };
  const openContextItem = (item: { title: string; target: ChatChange["target"] }) => {
    onOpenChange({ title: item.title, action: "updated", target: item.target }).catch(
      (error: unknown) =>
        toast.error("Couldn't open this item", {
          description: error instanceof Error ? error.message : String(error),
        }),
    );
  };

  const openChatFile = onOpenFile ?? previewChatFile;
  const needsSetup = Boolean(chat.state) && !chat.usable && turns.length === 0;
  const signedOut = otter !== null && !otter.user;
  const elsewhere = convo && isElsewhere(convo, device) ? convo.device : null;
  const setupSummary = providerSummary(chat.provider);
  const fallback = chat.state?.providers.find(
    (p) => p.id !== chat.id && isProviderUsable(p) && p.checkedAt !== null,
  );
  const hero = turns.length === 0 && !hydrating && !unloaded;
  const started = convo && turns.length > 0 ? convo : null;
  const removed =
    started && chat.state && !chat.provider && !chat.state.others.some((o) => o.id === chat.id);
  const agentOff =
    started && isProviderUsable(chat.provider) && !canRunChat(chat.provider, started.sessionId);
  const composer = elsewhere ? (
    <p className="shrink-0 px-6 pb-4 pt-2 text-center text-body text-muted-foreground">
      This chat ran in {chat.name} on {elsewhere.name}. Continue it there.
    </p>
  ) : removed ? (
    <RemovedAgent convo={started} chat={chat} />
  ) : agentOff ? (
    <div className="flex shrink-0 flex-col items-center gap-2 px-6 pb-4 pt-2 text-center text-body text-muted-foreground">
      {agentNameOf(chat.state, started.provider, openClawAgentId(started.sessionId))} is turned off.
      <Button
        size="sm"
        onClick={() => void appApi.openSettings({ pane: "agents", item: started.provider })}
      >
        Open Settings
      </Button>
    </div>
  ) : (
    <ChatComposer
      chatId={chatId}
      convo={convo}
      chat={chat}
      context={context}
      onClearQuote={onClearQuote}
      files={files}
      inputRef={inputRef}
      onEditCitation={citing.edit}
      onSent={citing.close}
      updateSettings={updateSettings}
      compact={compact}
    />
  );

  return (
    <div
      className={cn("relative flex min-h-0 flex-1 flex-col", compact && "[--text-sm:0.8125rem]")}
      {...(needsSetup ? {} : drop.handlers)}
    >
      {drop.active ? <DropOverlay /> : null}
      {needsSetup ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          {chat.provider ? (
            <>
              <AgentFace provider={chat.provider} className="mb-1 size-6" />
              <span className="text-sm font-medium text-foreground font-reading">
                {chat.name}: {setupSummary.headline}
              </span>
              {setupSummary.detail ? (
                <span className="text-sm text-muted-foreground">{setupSummary.detail}</span>
              ) : null}
            </>
          ) : signedOut ? (
            <>
              <AgentIcon className="mb-1 size-6 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground font-reading">
                Sign in to chat with your agents
              </span>
              <span className="max-w-80 text-sm text-pretty text-muted-foreground">
                Your agents and chats are in your Otter account, the same on every device.
              </span>
            </>
          ) : (
            <>
              <AgentIcon className="mb-1 size-6 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground font-reading">
                Add an agent to chat with
              </span>
              <span className="max-w-80 text-sm text-pretty text-muted-foreground">
                Connect {kindList(chat.state?.kinds ?? [])} in Settings → Agents. Add as many as you
                work with.
              </span>
            </>
          )}
          <div className="mt-1 flex items-center gap-2">
            <Button
              size="sm"
              onClick={() =>
                void appApi.openSettings(
                  signedOut && !chat.provider
                    ? { pane: "otter" }
                    : { pane: "agents", item: chat.provider?.id },
                )
              }
            >
              {chat.provider ? "Open Settings" : signedOut ? "Sign in" : "Add agent"}
            </Button>
            {fallback ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateSettings({ selected: fallback.id })}
              >
                Use {fallback.name}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <MessageScroller.Provider autoScroll defaultScrollPosition="end">
          <MessageScroller.Root className="relative min-h-0 flex-1">
            <ScrollArea
              className="h-full"
              viewportClassName={
                compact
                  ? "px-1 pb-2 pt-2"
                  : "topbar-scroll-fade px-3 pb-3 pt-(--workspace-titlebar-scroll-fade-height)"
              }
              render={<MessageScroller.Viewport />}
            >
              <MessageScroller.Content
                ref={setTranscript}
                className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-2"
              >
                {turns.length === 0 && hydrating ? (
                  <div className="px-2 pt-6 text-center text-sm text-placeholder">
                    Loading this session from {chat.name}…
                  </div>
                ) : null}
                <ChatTranscript
                  turns={turns}
                  streaming={streaming}
                  waiting={waitingOn && waitingLabel(waitingOn)}
                  asking={asking}
                  detached={Boolean(convo?.openRequest)}
                  providerName={chat.name}
                  onOpenFile={openChatFile}
                  loadImage={loadChatImage}
                  onOpenContext={openContextItem}
                  onOpenChange={onOpenChange}
                  onFork={
                    chat.provider?.forks && convo?.sessionId
                      ? (turnId) =>
                          forkChat(chatId, turnId).then(
                            (forked) => forked && onShowChat?.(forked),
                            (error: unknown) =>
                              toast.error("Couldn't fork this chat", {
                                description: error instanceof Error ? error.message : String(error),
                              }),
                          )
                      : undefined
                  }
                />
                <QueuedMessages
                  items={queue}
                  editingId={editingQueued}
                  canSend={canSendQueued}
                  onSend={steerQueued}
                  onEdit={(id) => {
                    editQueued(id);
                    inputRef.current?.focus();
                  }}
                  onCancelEdit={() => cancelQueuedEdit(chatId)}
                  onRemove={removeQueued}
                />
              </MessageScroller.Content>
            </ScrollArea>
            <MessageScroller.Button
              direction="end"
              render={(props, state) =>
                state.active ? (
                  <button
                    {...props}
                    type="button"
                    aria-label="Jump to latest"
                    className="surface-glass absolute bottom-3 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border/40 text-muted-foreground shadow-sm hover:text-foreground margin:shadow-none"
                  >
                    <ArrowDownIcon className="size-3.5" />
                  </button>
                ) : null
              }
            />
            <CiteSelectionButton
              root={transcript}
              onCite={(text, range) => citing.cite(text, range)}
            />
            {citing.editor}
            {/* An empty chat shows its headline in the middle of the column. */}
            {hero && !centered ? (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 px-6">
                {compact ? null : (
                  <MailIcon
                    aria-hidden
                    strokeWidth={1.25}
                    className="size-10 text-muted-foreground"
                  />
                )}
                <h1
                  className={cn(
                    "w-full max-w-3xl text-balance text-center font-normal tracking-tight text-foreground",
                    compact ? "text-lg" : "text-2xl",
                  )}
                >
                  {context.headline}
                </h1>
              </div>
            ) : null}
          </MessageScroller.Root>
          {composer}
          {compact ? null : (
            <div
              key={chatId}
              aria-hidden
              className={cn(
                "shrink-0 transition-[height] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
                centered && hero ? "h-[42%]" : "h-0",
              )}
            />
          )}
        </MessageScroller.Provider>
      )}
      <AttachmentPreview file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}

/** A chat whose agent was removed: an OpenClaw one goes on with its gateway added again. */
function RemovedAgent({ convo, chat }: { convo: Conversation; chat: ChatProvider }) {
  const providers = chat.state?.providers ?? [];
  const reconnectable = useChats((s) => canReconnect(s, convo, providers));
  const gateways = reconnectTargets(providers);
  const [connecting, setConnecting] = useState(false);
  const reconnect = (gateway: (typeof gateways)[number]) => {
    setConnecting(true);
    reconnectChat(convo.id, gateway)
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "Couldn't reconnect this chat."),
      )
      .finally(() => setConnecting(false));
  };
  return (
    <div className="flex shrink-0 flex-col items-center gap-2 px-6 pb-4 pt-2 text-center text-body text-muted-foreground">
      This chat&apos;s agent was removed.
      {!reconnectable ? null : gateways.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" disabled={connecting} />}>
            {connecting ? "Reconnecting…" : "Reconnect agent"}
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>The OpenClaw gateway this chat ran on</DropdownMenuLabel>
            {gateways.map((gateway) => (
              <DropdownMenuItem key={gateway.id} onClick={() => reconnect(gateway)}>
                <AgentFace provider={gateway} className="size-4" />
                {gateway.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          <span>Connect the OpenClaw gateway this chat ran on, then come back here.</span>
          <Button size="sm" onClick={() => void appApi.openSettings({ pane: "agents" })}>
            Open Settings
          </Button>
        </>
      )}
    </div>
  );
}
