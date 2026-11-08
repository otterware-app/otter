import { useState, type RefObject } from "react";
import {
  ClockIcon,
  CopyIcon,
  FileIcon,
  FilePenLineIcon,
  GlobeIcon,
  ListTodoIcon,
  MailIcon,
} from "lucide-react";
import type { ChatTab } from "@otter/contracts/chats";
import type { ScheduledTask } from "@otter/contracts/scheduled";

import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { AgentAvatar, openClawAgentId, useChatProvider } from "./agent-providers";
import { keyOf, useScheduledTasks } from "./agent-scheduled";
import { isOpenTab, type Conversation } from "./chat-store";
import { scheduleText, untilText } from "./scheduled-text";
import { toast } from "../mail/toast";
import { HintTooltip, cn } from "../mail/ui";

export const TAB_ICONS = {
  thread: MailIcon,
  draft: FilePenLineIcon,
  page: GlobeIcon,
  file: FileIcon,
};

/** What the agent made: a draft, a file, an event; the rest is what it read. */
export const isOutput = (tab: ChatTab) =>
  tab.made ?? (tab.ref.kind === "draft" || tab.ref.kind === "file");

const SHOWN = 5;

/** Shown docked beside the chat when there's room; the button then hides or shows it. */
const DOCKED_KEY = "otter:chat-details-docked";

export function readDetailsDocked(): boolean {
  try {
    return localStorage.getItem(DOCKED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveDetailsDocked(shown: boolean): void {
  try {
    localStorage.setItem(DOCKED_KEY, String(shown));
  } catch {
    // Without storage it shows each time.
  }
}

type DetailsProps = {
  convo: Conversation;
  onOpen: (tab: ChatTab) => void;
  /** Opens one of the agent's scheduled tasks in Scheduled. */
  onOpenTask: (key: string) => void;
};

const detailsButton =
  "no-drag flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring";

/**
 * The chat's details: a popover, or with `docked`, a button that shows or hides them beside the
 * chat (`ChatDetailsDock`).
 */
export function ChatContextButton({
  docked,
  shown,
  onToggle,
  anchor,
  ...props
}: DetailsProps & {
  docked?: boolean;
  shown?: boolean;
  onToggle?: () => void;
  /** The bar the popover hangs from, in its corner where the docked details sit. */
  anchor?: RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);
  if (docked)
    return (
      <HintTooltip label={shown ? "Hide chat details" : "Chat details"} side="bottom">
        <button
          type="button"
          aria-label="Chat details"
          aria-pressed={shown}
          onClick={onToggle}
          className={cn(detailsButton, shown && "bg-foreground/[0.06] text-foreground")}
        >
          <ListTodoIcon className="size-4" />
        </button>
      </HintTooltip>
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <HintTooltip label="Chat details" side="bottom">
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Chat details"
              className={cn(detailsButton, open && "bg-foreground/[0.06] text-foreground")}
            >
              <ListTodoIcon className="size-4" />
            </button>
          }
        />
      </HintTooltip>
      <PopoverPopup
        align="end"
        width="md"
        anchor={anchor}
        sideOffset={anchor ? 12 : undefined}
        alignOffset={anchor ? 12 : undefined}
      >
        <ChatDetails
          {...props}
          onOpen={(tab) => {
            setOpen(false);
            props.onOpen(tab);
          }}
          onOpenTask={(key) => {
            setOpen(false);
            props.onOpenTask(key);
          }}
        />
      </PopoverPopup>
    </Popover>
  );
}

/** The details kept open beside the chat, where they leave its messages clear. */
export function ChatDetailsDock(props: DetailsProps) {
  return (
    <aside
      aria-label="Chat details"
      className="dropdown-glass min-h-0 overflow-y-auto rounded-lg p-4 text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]"
    >
      <ChatDetails {...props} />
    </aside>
  );
}

/** The chat's context: the agent and session it runs in, and what it made and used, closed tabs included. */
function ChatDetails({ convo, onOpen, onOpenTask }: DetailsProps) {
  const chatAgent = useChatProvider(convo);
  const agent = openClawAgentId(convo.sessionId);
  const agentName =
    (agent ? (chatAgent.provider?.models.find((m) => m.slug === agent)?.name ?? agent) : null) ??
    chatAgent.name;
  const about = [agent ? chatAgent.name : null, convo.device?.name].filter(Boolean).join(" · ");
  const outputs = convo.tabs.filter(isOutput).toReversed();
  const sources = convo.tabs.filter((t) => !isOutput(t)).toReversed();
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex items-center gap-2">
        <AgentAvatar kind={convo.provider} agent={agent} className="size-5" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-foreground">{agentName}</span>
          {about ? <span className="truncate text-xs text-muted-foreground">{about}</span> : null}
        </div>
        {convo.sessionId ? (
          <HintTooltip label="Copy session ID" side="bottom">
            <button
              type="button"
              aria-label="Copy session ID"
              className="-mr-1.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
              onClick={() =>
                void navigator.clipboard.writeText(convo.sessionId ?? "").then(
                  () => toast.success("Session ID copied"),
                  () => toast.error("Couldn't copy the session ID"),
                )
              }
            >
              <CopyIcon className="size-4" />
            </button>
          </HintTooltip>
        ) : null}
      </div>
      {convo.sessionId ? (
        <ScheduledSection sessionId={convo.sessionId} onOpen={onOpenTask} />
      ) : null}
      <TabSection title="Outputs" empty="Nothing made yet" tabs={outputs} onOpen={onOpen} />
      <TabSection title="Sources" empty="Nothing read yet" tabs={sources} onOpen={onOpen} />
    </div>
  );
}

const sectionClass = "flex flex-col gap-0.5 border-t pt-3";
const headingClass = "pb-1.5 text-sm font-medium text-muted-foreground";
/** Lined up with the headings; the hover reaches out past them. */
const rowClass =
  "-mx-2 flex min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-focus-ring";

/** A page's title, or where it is when it has none of its own: its site and path. */
function tabTitle(tab: ChatTab): string {
  if (tab.ref.kind !== "page" || tab.title !== tab.ref.url || !URL.canParse(tab.ref.url))
    return tab.title;
  const url = new URL(tab.ref.url);
  const path = url.pathname === "/" ? "" : decodeURIComponent(url.pathname).replace(/\/$/, "");
  return url.host.replace(/^www\./, "") + path;
}

function TabSection({
  title,
  empty,
  tabs,
  onOpen,
}: {
  title: string;
  empty: string;
  tabs: ChatTab[];
  onOpen: (tab: ChatTab) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? tabs : tabs.slice(0, SHOWN);
  return (
    <section className={sectionClass}>
      <h3 className={headingClass}>{title}</h3>
      {tabs.length === 0 ? <p className="text-muted-foreground/70">{empty}</p> : null}
      {shown.map((tab) => {
        const Icon = TAB_ICONS[tab.ref.kind];
        const detail = tab.ref.kind === "page" ? tab.ref.url : undefined;
        return (
          <button
            key={tab.id}
            type="button"
            title={detail ? `${tab.title}\n${detail}` : tab.title}
            onClick={() => onOpen(tab)}
            className={cn(rowClass, isOpenTab(tab) ? "text-foreground" : "text-muted-foreground")}
          >
            <Icon className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{tabTitle(tab)}</span>
          </button>
        );
      })}
      {tabs.length > SHOWN ? (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className={cn(rowClass, "text-muted-foreground hover:text-foreground")}
        >
          {all ? "Show fewer" : `View all ${tabs.length}`}
        </button>
      ) : null}
    </section>
  );
}

/** What the agent runs on a schedule for this chat: made in it, or posting to it. */
function ScheduledSection({
  sessionId,
  onOpen,
}: {
  sessionId: string;
  onOpen: (key: string) => void;
}) {
  const { data } = useScheduledTasks(true);
  const tasks = (data ?? []).flatMap((agent) =>
    agent.tasks.filter((task) => task.chats?.includes(sessionId)),
  );
  if (tasks.length === 0) return null;
  const now = Date.now();
  return (
    <section className={sectionClass}>
      <h3 className={headingClass}>Scheduled</h3>
      {tasks.map((task) => (
        <button
          key={keyOf(task)}
          type="button"
          onClick={() => onOpen(keyOf(task))}
          className={cn(rowClass, "items-start")}
        >
          <ClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-foreground">{task.name}</span>
            <span className="truncate text-xs text-muted-foreground">{taskLine(task, now)}</span>
          </span>
        </button>
      ))}
    </section>
  );
}

function taskLine(task: ScheduledTask, now: number): string {
  const when = scheduleText(task.schedule);
  if (!task.enabled) return `${when} · Paused`;
  if (task.running) return `${when} · Running now`;
  return task.nextRunAt ? `${when} · next ${untilText(task.nextRunAt, now)}` : when;
}
