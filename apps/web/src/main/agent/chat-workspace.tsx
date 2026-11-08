import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { PlusIcon, TriangleAlertIcon } from "lucide-react";
import { chatTabId, type ChatTabRef } from "@otter/contracts/chats";

import { PageSlot } from "../browser/page-host";
import {
  chatPageId,
  closeChatPage,
  ensureChatPage,
  hostOf,
  routeLinks,
  useBrowser,
} from "../browser/store";
import { features } from "../features";
import { matchesCommand, useCommandHandlers } from "../keybindings/dispatch";
import { useLatest } from "../use-latest";
import { mailApi, type ChatChange } from "../mail/api";
import { useMailChatContext } from "./chat-context";
import {
  closeChatTab,
  isBlank,
  isOpenTab,
  newChat,
  openChatTab,
  reorderChatTabs,
  showChatTab,
  useChats,
  watchChat,
  type ChatTab,
} from "./chat-store";
import { AgentBrowser, AgentBrowserTabIcon } from "./agent-browser";
import {
  ChatContextButton,
  ChatDetailsDock,
  TAB_ICONS,
  readDetailsDocked,
  saveDetailsDocked,
} from "./chat-context-panel";
import { ChatFind } from "./chat-find";
import { ChatTitle } from "./chat-title";
import { ChatView } from "./chat-view";
import { DitherBackdrop } from "../mail/dither-backdrop";
import { FilePreview } from "../mail/attachment-preview";
import { MessageReader } from "../mail/message-reader";
import { PanelTab } from "../mail/panel-tab";
import { mostRecentTab } from "../mail/panel-tabs";
import { AgentAvatar, openClawAgentId, useChatProvider } from "./agent-providers";
import { usePanelTabDrag } from "../mail/use-panel-tab-drag";
import { HintTooltip, cn } from "../mail/ui";
import { usePanelAnimationSettings, usePanelPresence } from "../panel-animations";

export type ChatPanelControl = { toggle: () => void; newPage: () => void };

/** Wide enough for the details to sit beside the chat's messages (max-w-3xl, centred) without covering them. */
const DOCK_WIDTH = 768 + 2 * (320 + 24);

function useWideEnough(ref: RefObject<HTMLElement | null>, min: number): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= min));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, min]);
  return wide;
}

/** The agent's browser, live: a tab of this device's, not one the chat keeps. */
const LIVE_TAB = "agent-browser";

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
  onOpenTask,
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
  onOpenTask: (key: string) => void;
}) {
  const convo = useChats((s) => s.conversations.find((c) => c.id === chatId));
  const activeTab = useChats((s) => s.activeTabs[chatId]);
  const { selectedKind } = useChatProvider(undefined);
  const tabs = (convo?.tabs ?? []).filter(
    (t) => isOpenTab(t) && (features.browser || t.ref.kind !== "page"),
  );
  const chatAgent = useChatProvider(convo);
  const [browserSteps, browserDone] = useChats(
    useShallow((s) => {
      let steps = 0;
      let done = 0;
      for (const turn of s.conversations.find((c) => c.id === chatId)?.turns ?? [])
        for (const item of turn.items ?? [])
          if (item.kind === "step" && item.step.title === "Browser") {
            steps++;
            if (item.output !== undefined) done++;
          }
      return [steps, done];
    }),
  );
  const run = useChats((s) => s.runs[chatId]?.requestId);
  const [liveClosed, setLiveClosed] = useState<string | null>(null);
  const [livePage, setLivePage] = useState<string | undefined>();
  const liveSession =
    chatAgent.provider?.liveBrowser && convo?.sessionId && browserSteps > 0 && liveClosed !== chatId
      ? convo.sessionId
      : null;
  const liveShown = liveSession !== null && (activeTab === LIVE_TAB || tabs.length === 0);
  const agentName =
    chatAgent.provider?.models.find((m) => m.slug === openClawAgentId(liveSession))?.name ??
    chatAgent.name;
  const shown = liveShown ? undefined : (tabs.find((t) => t.id === activeTab) ?? tabs.at(-1));
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
    const { activeId, conversations } = useChats.getState();
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
    routeLinks((url, shareRequest) => {
      const ref = { kind: "page" as const, url };
      openChatTab(chatId, ref, url);
      if (shareRequest) ensureChatPage(chatId, chatTabId(ref), url, url, shareRequest);
    });
    return () => routeLinks(null);
  }, [chatId]);
  const close = (tab: ChatTab) => {
    if (tab.ref.kind === "page") closeChatPage(chatId, tab.id);
    closeChatTab(chatId, tab.id);
  };
  useEffect(() => {
    closeTabRef.current = () => {
      if (liveShown) {
        setLiveClosed(chatId);
        return true;
      }
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
  const columnRef = useRef<HTMLDivElement>(null);
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
      if (!(event.target instanceof Element)) return false;
      if (
        !workspaceRef.current?.contains(event.target) &&
        !event.target.closest("[data-browser-page]")
      )
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
  const panelOpen = (tabs.length > 0 || liveSession !== null) && !panelHidden;
  const { active: animated, durationMs } = usePanelAnimationSettings(`chat:${chatId}`);
  const panelPresent = usePanelPresence(panelOpen, animated, durationMs);
  // The chat and its panel trade the room: one's grow rises as the other's falls, so they always fill it.
  const sliding =
    animated &&
    "transition-[flex-grow,min-width] [transition-duration:var(--panel-animation-duration)] ease-out";
  // The agent starts browsing in a turn you're watching: show it, once a turn.
  const seenSteps = useRef({ chatId, browserSteps, shownFor: "" });
  useEffect(() => {
    const seen = seenSteps.current;
    seenSteps.current = { ...seen, chatId, browserSteps };
    if (seen.chatId !== chatId || browserSteps <= seen.browserSteps) return;
    if (!run || seen.shownFor === run) return;
    seenSteps.current.shownFor = run;
    setLiveClosed(null);
    showChatTab(chatId, LIVE_TAB);
    setPanelHidden(false);
  }, [chatId, browserSteps, run]);
  const newPage = () => {
    if (!features.browser) return;
    openChatTab(chatId, { kind: "page", url: "" }, "New tab", {
      id: `page:new:${crypto.randomUUID()}`,
    });
    setPanelHidden(false);
  };
  useEffect(() => {
    panelRef.current = {
      toggle: () =>
        tabs.length === 0 && !liveSession ? newPage() : setPanelHidden((hidden) => !hidden),
      newPage,
    };
    return () => {
      panelRef.current = null;
    };
  });
  const onPanelOpenRef = useLatest(onPanelOpen);
  useEffect(() => onPanelOpenRef.current(panelOpen), [panelOpen, onPanelOpenRef]);

  const allPages = useBrowser((s) => s.tabs);
  // A tab sent from the browser panel is that tab itself while it's open, else a page of the chat's.
  const pageIdOf = (tab: ChatTab) => {
    const linked = tab.ref.kind === "page" ? tab.ref.tab : undefined;
    return linked && allPages.some((t) => t.id === linked && !t.chatId)
      ? linked
      : chatPageId(chatId, tab.id);
  };
  const pages = tabs.filter((t) => t.ref.kind === "page");
  useEffect(() => {
    for (const tab of pages)
      if (tab.ref.kind === "page" && pageIdOf(tab) === chatPageId(chatId, tab.id))
        ensureChatPage(chatId, tab.id, tab.ref.url, tab.title);
  });

  const blank = !convo || isBlank(convo);
  // Kept after the first send, so the backdrop can fade out under the chat.
  const [backdropShown, setBackdropShown] = useState(blank);
  const [backdropChat, setBackdropChat] = useState(chatId);
  if (backdropChat !== chatId) {
    setBackdropChat(chatId);
    setBackdropShown(blank);
  } else if (blank && !backdropShown) setBackdropShown(true);
  const openDetail = (tab: ChatTab) => {
    if (tab.ref.kind === "page" && !features.browser) {
      window.open(tab.ref.url, "_blank", "noopener");
      return;
    }
    openChatTab(chatId, tab.ref, tab.title, { id: tab.id });
    setPanelHidden(false);
  };
  const roomy = useWideEnough(columnRef, DOCK_WIDTH);
  const [detailsShown, setDetailsShown] = useState(readDetailsDocked);
  const docked = roomy && !blank;
  const transcriptRef = useRef<HTMLElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [find, setFind] = useState<number | null>(null);
  // ⌘F in the chat finds in it; elsewhere it's the app's search.
  const findInChat = (event: KeyboardEvent<HTMLDivElement>) => {
    if (blank || !matchesCommand(event.nativeEvent, "search.focus")) return;
    event.preventDefault();
    transcriptRef.current = columnRef.current?.querySelector<HTMLElement>('[role="log"]') ?? null;
    setFind((key) => (key ?? 0) + 1);
  };
  const chat = (
    <ChatView
      chatId={chatId}
      context={context}
      centered={blank}
      inputRef={inputRef}
      onOpenChange={openChange}
      onOpenFile={(href) => open({ kind: "file", href }, href.split(/[\\/]/).pop() || href)}
      onShowChat={onSelectChat}
    />
  );

  return (
    <div ref={workspaceRef} className="relative flex min-h-0 min-w-0 flex-1" data-tour="workspace">
      <div
        ref={columnRef}
        tabIndex={-1}
        onKeyDown={findInChat}
        style={panelPresent ? { flexBasis: width } : undefined}
        className={cn(
          "relative flex min-h-0 flex-col outline-none",
          panelPresent
            ? cn("shrink", sliding, panelOpen ? "min-w-[300px] grow-0" : "min-w-0 grow")
            : "min-w-0 flex-1",
          blank &&
            "[--chat-composer-blur:var(--glass-blur)] [--chat-composer-surface:color-mix(in_srgb,var(--canvas)_62%,transparent)]",
        )}
      >
        {backdropShown ? (
          <DitherBackdrop
            key={chatId}
            className={cn(
              "transition-opacity duration-700 ease-out",
              blank ? "opacity-100" : "opacity-0",
            )}
            onTransitionEnd={() => {
              if (!blank) setBackdropShown(false);
            }}
          />
        ) : null}
        {chat}
        {/* data-toolbar: the window's own drag strip steps back, so it can't swallow the tabs' clicks.
            A new chat has no title of its own: its bar floats over the backdrop. After the
            transcript in the page (first on screen): Electron's drag regions go in page order,
            and the transcript's, scrolled up under the bar, would otherwise cut it out. */}
        <div
          ref={barRef}
          data-toolbar=""
          className={cn(
            "drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 px-4",
            blank ? "absolute inset-x-0 top-0 z-10" : "relative order-first",
          )}
        >
          {titleLeading}
          {blank ? (
            <span className="flex-1" />
          ) : (
            <>
              <AgentAvatar kind={convo.provider} agent={openClawAgentId(convo.sessionId)} />
              <ChatTitle chat={convo} className="text-sm font-medium text-foreground" />
              <span className="flex-1" />
              <ChatContextButton
                convo={convo}
                onOpenTask={onOpenTask}
                onOpen={openDetail}
                docked={docked}
                anchor={barRef}
                shown={detailsShown}
                onToggle={() => {
                  saveDetailsDocked(!detailsShown);
                  setDetailsShown(!detailsShown);
                }}
              />
            </>
          )}
          {panelOpen ? null : titleTrailing}
        </div>
        {find !== null || (docked && detailsShown && convo) ? (
          <div className="pointer-events-none absolute top-[calc(var(--workspace-topbar-height)+0.75rem)] right-3 bottom-4 z-20 flex w-80 flex-col gap-2 *:pointer-events-auto">
            {find !== null ? (
              <ChatFind
                transcript={transcriptRef}
                focusKey={find}
                onClose={() => {
                  setFind(null);
                  columnRef.current?.focus();
                }}
              />
            ) : null}
            {docked && detailsShown && convo ? (
              <ChatDetailsDock convo={convo} onOpen={openDetail} onOpenTask={onOpenTask} />
            ) : null}
          </div>
        ) : null}
      </div>
      {panelPresent ? (
        <>
          <div className={cn("relative z-20 w-0 shrink-0", !panelOpen && "hidden")} aria-hidden>
            <div
              onPointerDown={start}
              className="no-drag group absolute inset-y-0 -left-[3px] flex w-1.5 cursor-col-resize justify-center"
            >
              <div className="w-px bg-border/70 group-hover:bg-input" />
            </div>
          </div>
          <div
            className={cn(
              "flex min-h-0 basis-0 flex-col overflow-hidden",
              sliding,
              panelOpen
                ? cn("min-w-[360px] grow", animated && "starting:min-w-0 starting:grow-0")
                : "pointer-events-none min-w-0 grow-0",
            )}
          >
            <div className="relative flex min-h-0 flex-1 flex-col">
              {liveShown && convo ? (
                <AgentBrowser
                  key={liveSession}
                  provider={convo.provider}
                  sessionId={liveSession}
                  agentName={agentName}
                  activity={browserSteps + browserDone}
                  onPage={setLivePage}
                />
              ) : null}
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
              {features.browser && shown?.ref.kind === "page" ? (
                <PageSlot key={shown.id} tabId={pageIdOf(shown)} />
              ) : null}
            </div>
            {/* After the tab's page, as the chat's bar is: so it scrolls under the bar without cutting it out. */}
            <div className="drag-region order-first flex h-(--workspace-topbar-height) shrink-0 items-center gap-1 px-3">
              <div
                role="tablist"
                ref={stripRef}
                aria-label="What this chat opened"
                className="no-drag scroll-fade-x relative flex min-w-0 shrink items-center gap-1 overflow-x-auto [scrollbar-width:none]"
                {...handlers}
              >
                {liveSession ? (
                  <PanelTab
                    id={LIVE_TAB}
                    title={livePage ? hostOf(livePage) : "Browser"}
                    tooltip={`${agentName}'s browser, on the OpenClaw gateway${livePage ? `\n${livePage}` : ""}`}
                    selected={liveShown}
                    onSelect={() => showChatTab(chatId, LIVE_TAB)}
                    onClose={() => setLiveClosed(chatId)}
                    icon={<AgentBrowserTabIcon page={livePage} />}
                  />
                ) : null}
                {tabs.map((tab) => {
                  const Icon = TAB_ICONS[tab.ref.kind];
                  const page =
                    tab.ref.kind === "page"
                      ? allPages.find((t) => t.id === pageIdOf(tab))
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
