import { useCallback, useEffect, useState, type RefObject } from "react";
import { MessageScroller } from "@shadcn/react/message-scroller";
import { ArrowDownIcon, MailIcon } from "lucide-react";
import { ScrollArea } from "~/components/ui/scroll-area";
import { buttonClass, cn } from "../mail/ui";
import { mailApi, type AgentId, type AgentSettingsPatch, type ChatChange } from "../mail/api";
import {
  AgentFace,
  isProviderUsable,
  providerSummary,
  useChatProvider,
  useSetProvidersState,
} from "./agent-providers";
import type { MailChatContext } from "./chat-context";
import { CiteSelectionButton, useCitations } from "./chat-cite";
import { AttachmentPreview, attachmentPreview, type PreviewFile } from "../mail/attachment-preview";
import { DropOverlay, useChatAttachments, useFileDrop } from "./chat-attachments";
import {
  cancelQueuedEdit,
  editQueued,
  forkChat,
  isCompacting,
  isElsewhere,
  loadChat,
  removeQueued,
  steerQueued,
  useChats,
  type QueuedMessage,
} from "./chat-store";
import { QueuedMessages } from "./chat-queue";
import { ChatTranscript } from "./chat-transcript";
import { ChatComposer } from "./chat-composer";
import { AgentIcon } from "./agent-icon";
import { useOtterAccount } from "../otter-account";
import { toast } from "../mail/toast";

const NO_QUEUE: QueuedMessage[] = [];

function kindList(kinds: { name: string }[]): string {
  const names = kinds.map((k) => k.name);
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`
    : (names[0] ?? "an agent");
}

function useChatImageLoader(provider?: AgentId, sessionId?: string | null) {
  return useCallback(
    async (href: string) => {
      if (!provider) throw new Error("Open the image from its chat.");
      const file = await mailApi.agentReadFile(provider, sessionId ?? "", href);
      const preview = attachmentPreview(file.name, file.mimeType);
      if (preview?.kind !== "image") throw new Error("This file isn't an image.");
      return `data:${preview.mimeType};base64,${file.data}`;
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
  const queue = useChats((s) =>
    s.queue.some((m) => m.convoId === chatId) ? s.queue : NO_QUEUE,
  ).filter((m) => m.convoId === chatId);
  const editingQueued = useChats((s) =>
    s.editingQueued?.convoId === chatId ? s.editingQueued.id : null,
  );
  // A message joins the run unless the run waits on an approval.
  const canSendQueued = useChats((s) => {
    const run = s.runs[chatId];
    return (
      Boolean(run) &&
      !s.approvals.some((a) => a.requestId === run.requestId) &&
      !isCompacting(s.conversations.find((c) => c.id === chatId)?.turns ?? [])
    );
  });
  const hydrating = useChats((s) => s.hydrating === chatId);
  const turns = convo?.turns ?? [];
  const chat = useChatProvider(convo);
  const otter = useOtterAccount();
  const setProvidersState = useSetProvidersState();
  const updateSettings = (patch: AgentSettingsPatch) => {
    console.log("[AgentChat:updateSettings]", patch);
    mailApi.updateAgentSettings(patch).then(setProvidersState, () => {});
  };

  const files = useChatAttachments();
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
    void mailApi
      .agentReadFile(convo.provider, convo.sessionId ?? "", href)
      .then((file) => {
        if (!attachmentPreview(file.name, file.mimeType))
          throw new Error("This file type can't be previewed.");
        setPreviewFile({ ...file, load: async () => file.data });
      })
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
  const composer = elsewhere ? (
    <p className="shrink-0 px-6 pb-4 pt-2 text-center text-[13px] text-muted-foreground">
      This chat ran in {chat.name} on {elsewhere.name}. Continue it there.
    </p>
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
              <span className="text-sm font-medium text-foreground">
                {chat.name}: {setupSummary.headline}
              </span>
              {setupSummary.detail ? (
                <span className="text-sm text-muted-foreground">{setupSummary.detail}</span>
              ) : null}
            </>
          ) : signedOut ? (
            <>
              <AgentIcon className="mb-1 size-6 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                Sign in to chat with your agents
              </span>
              <span className="max-w-80 text-sm text-pretty text-muted-foreground">
                Your agents and chats are in your Otter account, the same on every device.
              </span>
            </>
          ) : (
            <>
              <AgentIcon className="mb-1 size-6 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Add an agent to chat with</span>
              <span className="max-w-80 text-sm text-pretty text-muted-foreground">
                Connect {kindList(chat.state?.kinds ?? [])} in Settings → Agents. Add as many as you
                work with.
              </span>
            </>
          )}
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void mailApi.openSettings(
                  signedOut && !chat.provider
                    ? { pane: "otter" }
                    : { pane: "agents", item: chat.provider?.id },
                )
              }
              className={buttonClass("outline", "sm")}
            >
              {chat.provider ? "Open Settings" : signedOut ? "Sign in" : "Add agent"}
            </button>
            {fallback ? (
              <button
                type="button"
                onClick={() => updateSettings({ selected: fallback.id })}
                className={buttonClass("ghost", "sm")}
              >
                Use {fallback.name}
              </button>
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
                    className="surface-glass absolute bottom-3 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border/40 text-muted-foreground shadow-sm hover:text-foreground"
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
