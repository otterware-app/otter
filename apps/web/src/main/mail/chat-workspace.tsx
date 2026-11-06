import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileIcon,
  FilePenLineIcon,
  GlobeIcon,
  MailIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { chatTabId, type ChatTabRef } from "@otter-mail/contracts/chats";

import { BrowserPages } from "../browser/browser-view";
import {
  chatPageId,
  closeChatPage,
  ensureChatPage,
  routeLinks,
  useBrowser,
} from "../browser/store";
import { features } from "../features";
import { useCommandHandlers } from "../keybindings/dispatch";
import { useLatest } from "../use-latest";
import { mailApi, type ChatChange } from "./api";
import { useMailChatContext } from "./chat-context";
import {
  closeChatTab,
  isBlank,
  newChat,
  openChatTab,
  reorderChatTabs,
  showChatTab,
  chatsState,
  useChats,
  watchChat,
  type ChatTab,
} from "./chat-store";
import { formatAgo } from "./chat-history";
import { ChatView } from "./chat-view";
import { FilePreview } from "./attachment-preview";
import { MessageReader } from "./message-reader";
import { PanelTab } from "./panel-tab";
import { mostRecentTab } from "./panel-tabs";
import { AgentAvatar, openClawAgentId, useChatProvider } from "./agent-providers";
import { usePanelTabDrag } from "./use-panel-tab-drag";
import { HintTooltip, cn } from "./ui";

export type ChatPanelControl = { toggle: () => void; newPage: () => void };

const TAB_ICONS = { thread: MailIcon, draft: FilePenLineIcon, page: GlobeIcon, file: FileIcon };

function useTabMessage(ref: ChatTabRef | undefined) {
  const mail = ref?.kind === "thread" || ref?.kind === "draft" ? ref : null;
  return useQuery({
    queryKey: ["chat-tab-message", mail ? chatTabId(mail) : null],
    enabled: mail !== null,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      if (!mail) return null;
      if (mail.kind === "draft") {
        const version = await mailApi.getDraftVersion(mail.accountId, mail.id);
        if (!version.messageId) throw new Error("This draft was sent or deleted.");
        await mailApi.loadDraftVersion(mail.accountId, mail.id, version.messageId);
        return version.messageId;
      }
      const messages = await mailApi.getThread(mail.accountId, mail.id);
      const last = messages.at(-1);
      if (!last) throw new Error("This conversation is no longer available.");
      return last.id;
    },
  });
}

function useChatWidth() {
  const key = "gmail:pane:workspace-chat";
  const [width, setWidth] = useState(() => Number(localStorage.getItem(key)) || 460);
  const start = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    // Pages and message frames must not swallow the release.
    const cover = document.createElement("div");
    cover.className = "no-drag fixed inset-0 z-[200] cursor-col-resize";
    document.body.append(cover);
    let latest = startWidth;
    const move = (ev: PointerEvent) => {
      latest = Math.min(900, Math.max(340, startWidth + ev.clientX - startX));
      setWidth(latest);
    };
    const up = () => {
      cover.remove();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      localStorage.setItem(key, String(latest));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return { width, start };
}

export function ChatWorkspace({
  chatId,
  titleLeading,
  titleTrailing,
  inputRef,
  closeTabRef,
  panelRef,
  onPanelOpen,
  onNavigate,
  onSelectChat,
}: {
  closeTabRef: MutableRefObject<(() => boolean) | null>;
  panelRef: MutableRefObject<ChatPanelControl | null>;
  onPanelOpen: (open: boolean) => void;
  chatId: string;
  titleLeading?: ReactNode;
  titleTrailing?: ReactNode;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onNavigate: (change: ChatChange) => Promise<void>;
  onSelectChat: (chatId: string) => void;
}) {
  const convo = useChats((s) => s.conversations.find((c) => c.id === chatId));
  const activeTab = useChats((s) => s.activeTabs[chatId]);
  const { selectedKind } = useChatProvider(undefined);
  const tabs = (convo?.tabs ?? []).filter((t) => features.browser || t.ref.kind !== "page");
  const shown = tabs.find((t) => t.id === activeTab) ?? tabs.at(-1);
  const message = useTabMessage(shown?.ref);
  const mail = shown?.ref.kind === "thread" || shown?.ref.kind === "draft" ? shown.ref : null;
  const context = useMailChatContext({
    accountId: mail && message.data ? mail.accountId : null,
    messageId: mail ? (message.data ?? null) : null,
  });
  const { width, start } = useChatWidth();

  useEffect(() => {
    watchChat(chatId);
    return () => watchChat(null);
  }, [chatId]);

  // A chat this device doesn't have (deleted, or a new one's address after a restart): the
  // chat showing instead, or a new one.
  const ready = useChats((s) => s.ready);
  const missing = ready && !convo;
  const onSelectChatRef = useLatest(onSelectChat);
  useEffect(() => {
    if (!missing) return;
    const { activeId, conversations } = chatsState();
    const there = activeId !== chatId && conversations.some((c) => c.id === activeId);
    onSelectChatRef.current(there ? activeId : newChat(selectedKind));
  }, [missing, chatId, selectedKind, onSelectChatRef]);

  const open = (ref: ChatTabRef, title: string) => openChatTab(chatId, ref, title);
  const openChange = async (change: ChatChange) => {
    const { target } = change;
    if (target.kind === "thread" || target.kind === "draft")
      open({ kind: target.kind, accountId: target.accountId, id: target.id }, change.title);
    else if (target.kind === "event" && target.url && features.browser)
      open({ kind: "page", url: target.url }, change.title);
    else await onNavigate(change);
  };
  useEffect(() => {
    routeLinks((url) => openChatTab(chatId, { kind: "page", url }, url));
    return () => routeLinks(null);
  }, [chatId]);
  const close = (tab: ChatTab) => {
    if (tab.ref.kind === "page") closeChatPage(chatId, tab.id);
    closeChatTab(chatId, tab.id);
  };
  useEffect(() => {
    closeTabRef.current = () => {
      if (!shown) return false;
      close(shown);
      return true;
    };
    return () => {
      closeTabRef.current = null;
    };
  });

  const recentRef = useRef<string[]>([]);
  const shownId = shown?.id;
  useEffect(() => {
    if (!shownId) return;
    recentRef.current = [shownId, ...recentRef.current.filter((id) => id !== shownId)];
  }, [shownId, recentRef]);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const previousTab = () => {
    const id = mostRecentTab(
      tabs.map((t) => t.id),
      shown?.id ?? "",
      recentRef.current,
    );
    if (!id) return false;
    showChatTab(chatId, id);
    return true;
  };
  useCommandHandlers({
    "tab.previous": (event) => {
      if (!(event.target instanceof Node) || !workspaceRef.current?.contains(event.target))
        return false;
      return previousTab();
    },
  });
  // Control + Tab in one of the chat's pages (their keys never reach the window's dispatcher).
  useEffect(() => window.desktopBridge.on("browser:previousTab", previousTab));
  const {
    ref: stripRef,
    draggingId,
    handlers,
  } = usePanelTabDrag((order) => reorderChatTabs(chatId, order));

  const [panelHidden, setPanelHidden] = useState(false);
  const panelOpen = tabs.length > 0 && !panelHidden;
  const newPage = () => {
    if (!features.browser) return;
    openChatTab(chatId, { kind: "page", url: "" }, "New tab");
    setPanelHidden(false);
  };
  useEffect(() => {
    panelRef.current = {
      toggle: () => (tabs.length === 0 ? newPage() : setPanelHidden((hidden) => !hidden)),
      newPage,
    };
    return () => {
      panelRef.current = null;
    };
  });
  const onPanelOpenRef = useLatest(onPanelOpen);
  useEffect(() => onPanelOpenRef.current(panelOpen), [panelOpen, onPanelOpenRef]);

  const pages = tabs.filter((t) => t.ref.kind === "page");
  useEffect(() => {
    for (const tab of pages)
      if (tab.ref.kind === "page") ensureChatPage(chatId, tab.id, tab.ref.url, tab.title);
  });
  const allPages = useBrowser((s) => s.tabs);
  const pageTabs = allPages.filter((t) => t.chatId === chatId);

  const blank = !convo || isBlank(convo);
  const chat = (
    <ChatView
      chatId={chatId}
      context={context}
      home={blank ? <RecentChats onSelect={onSelectChat} /> : undefined}
      inputRef={inputRef}
      onOpenChange={openChange}
      onOpenFile={(href) => open({ kind: "file", href }, href.split(/[\\/]/).pop() || href)}
    />
  );

  return (
    <div ref={workspaceRef} className="relative flex min-h-0 min-w-0 flex-1" data-tour="workspace">
      <div
        style={panelOpen ? { flexBasis: width } : undefined}
        className={cn(
          "flex min-h-0 flex-col",
          panelOpen ? "min-w-[300px] shrink" : "min-w-0 flex-1",
        )}
      >
        {/* data-toolbar: the window's own drag strip steps back, so it can't swallow the tabs' clicks. */}
        <div
          data-toolbar=""
          className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 px-4"
        >
          {titleLeading}
          {blank ? (
            <AgentAvatar />
          ) : (
            <AgentAvatar kind={convo.provider} agent={openClawAgentId(convo.sessionId)} />
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {blank ? "New chat" : convo.title}
          </span>
          {panelOpen ? null : titleTrailing}
        </div>
        {chat}
      </div>
      {panelOpen ? (
        <>
          <div className="relative z-20 w-0 shrink-0" aria-hidden>
            <div
              onPointerDown={start}
              className="no-drag group absolute inset-y-0 -left-[3px] flex w-1.5 cursor-col-resize justify-center"
            >
              <div className="w-px bg-border/70 group-hover:bg-input" />
            </div>
          </div>
          <div className="flex min-h-0 min-w-[360px] flex-[1_1_0] flex-col">
            <div className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-1 px-3">
              <div
                role="tablist"
                ref={stripRef}
                aria-label="What this chat opened"
                className="no-drag scroll-fade-x relative flex min-w-0 shrink items-center gap-1 overflow-x-auto [scrollbar-width:none]"
                {...handlers}
              >
                {tabs.map((tab) => {
                  const Icon = TAB_ICONS[tab.ref.kind];
                  const page =
                    tab.ref.kind === "page"
                      ? pageTabs.find((t) => t.id === chatPageId(chatId, tab.id))
                      : undefined;
                  const title = page?.title || tab.title;
                  return (
                    <PanelTab
                      key={tab.id}
                      id={tab.id}
                      title={title}
                      tooltip={tab.ref.kind === "page" ? `${title}\n${tab.ref.url}` : title}
                      selected={tab.id === shown?.id}
                      dragging={draggingId === tab.id}
                      onSelect={() => showChatTab(chatId, tab.id)}
                      onClose={() => close(tab)}
                      icon={<Icon className="size-3.5" />}
                    />
                  );
                })}
              </div>
              {features.browser ? (
                <HintTooltip label="New tab" shortcut="browser.newTab" side="bottom">
                  <button
                    type="button"
                    aria-label="New tab"
                    onClick={newPage}
                    className="no-drag flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <PlusIcon className="size-3.5" />
                  </button>
                </HintTooltip>
              ) : null}
              <span className="min-w-0 flex-1" />
              {titleTrailing}
            </div>
            <div className="relative flex min-h-0 flex-1 flex-col">
              {shown && (shown.ref.kind === "thread" || shown.ref.kind === "draft") ? (
                message.error ? (
                  <TabProblem message={message.error.message} />
                ) : message.data ? (
                  <MessageReader
                    key={shown.id}
                    accountId={shown.ref.accountId}
                    messageId={message.data}
                    autoFocusDraft={false}
                    onDeselect={() => close(shown)}
                    onAdvance={() => close(shown)}
                  />
                ) : null
              ) : shown?.ref.kind === "file" ? (
                <FileTab key={shown.id} chatId={chatId} href={shown.ref.href} />
              ) : null}
              {features.browser && pageTabs.length > 0 ? (
                <BrowserPages
                  tabs={pageTabs}
                  activeId={shown?.ref.kind === "page" ? chatPageId(chatId, shown.id) : null}
                  className={shown?.ref.kind === "page" ? undefined : "absolute! inset-0"}
                />
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function TabProblem({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <TriangleAlertIcon className="size-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function FileTab({ chatId, href }: { chatId: string; href: string }) {
  const convo = useChats((s) => s.conversations.find((c) => c.id === chatId));
  const file = useQuery({
    queryKey: ["chat-file", convo?.provider, convo?.sessionId, href],
    enabled: Boolean(convo),
    retry: false,
    queryFn: () => mailApi.agentReadFile(convo!.provider, convo!.sessionId ?? "", href),
  });
  if (file.error)
    return (
      <TabProblem
        message={
          convo?.device && convo.device.name
            ? `This file is on ${convo.device.name}, where the chat ran.`
            : file.error.message
        }
      />
    );
  if (!file.data) return null;
  const data = file.data;
  return <FilePreview file={{ ...data, load: async () => data.data }} />;
}

function RecentChats({ onSelect }: { onSelect: (chatId: string) => void }) {
  const conversations = useChats((s) => s.conversations);
  const unseen = useChats((s) => s.unseen);
  const recent = conversations
    .filter((c) => !isBlank(c))
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);
  if (recent.length === 0) return null;
  return (
    <ul aria-label="Recent chats" className="flex flex-col">
      {recent.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onSelect(c.id)}
            className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-left text-sm text-muted-foreground outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <AgentAvatar
              kind={c.provider}
              agent={openClawAgentId(c.sessionId)}
              className="size-3.5"
            />
            <span className={cn("min-w-0 flex-1 truncate", unseen.has(c.id) && "text-foreground")}>
              {c.title}
            </span>
            {unseen.has(c.id) ? (
              <span aria-label="New" className="size-1.5 shrink-0 rounded-full bg-primary" />
            ) : null}
            <span className="shrink-0 text-xs">{formatAgo(c.updatedAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
