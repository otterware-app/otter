import type { ReactNode } from "react";
import { CheckIcon } from "lucide-react";
import { meetingProvider } from "@otter/contracts";
import type { NoteTarget } from "@otter/contracts/margin-notes";
import type { TodoistTask } from "@otter/contracts/todoist";
import { Button } from "@otter/ui/components/button";
import { MarginPage, MarginRow, SectionHead } from "@otter/ui/components/margin";
import { cn } from "@otter/ui/lib/utils";
import { AgentNotes } from "../agent/agent-notes";
import { useMarginNotes } from "../agent/margin-notes";
import { openLink } from "../browser/store";
import type { CalEvent } from "../calendar/api";
import { MINUTE, startOfDay, timeLabel } from "../calendar/dates";
import { MEETING_NAMES } from "../calendar/meeting";
import { useNow } from "../calendar/time-grid";
import { decodeEntities } from "../mail/text";
import type { MailAccount, MessageSummary } from "../mail/types";
import { useOtterAccount } from "../otter-account";
import { useTodayEvents, useTodayMail, useTodayTasks } from "./desk-data";

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const counted = (n: number, one: string, many: string) =>
  `${WORDS[n] ?? n} ${n === 1 ? one : many}`;

const threadTarget = (m: MessageSummary): NoteTarget => ({
  kind: "thread",
  accountId: m.accountId ?? "",
  threadId: m.threadId,
});
const eventTarget = (e: CalEvent): NoteTarget => ({
  kind: "event",
  calendarId: e.calendarId,
  eventId: e.id,
});
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function greeting(now: Date): string {
  const hour = now.getHours();
  return hour < 5 || hour >= 18 ? "Good evening" : hour < 12 ? "Good morning" : "Good afternoon";
}

function untilLabel(event: CalEvent, now: number): string {
  if (event.startMs <= now) return "Now";
  const minutes = Math.ceil((event.startMs - now) / MINUTE);
  return minutes < 60 ? `In ${minutes} min` : `At ${timeLabel(new Date(event.startMs))}`;
}

function people(event: CalEvent): string | null {
  const others = event.attendees.filter((a) => a.email !== event.organizer);
  if (others.length === 0) return null;
  const names = others.slice(0, 2).map((a) => (a.name ?? a.email).split(/[\s@]/)[0]);
  return others.length > 2 ? `${names.join(", ")} +${others.length - 2}` : names.join(", ");
}

function meta(...parts: (string | null | undefined | false)[]) {
  return parts.filter(Boolean).join(" · ");
}

/** Today on one page, by time: what needs you, the meetings, and what the agents settled (Margin). */
export function DeskView({
  accounts,
  titleLeading,
  titleTrailing,
  onOpenMessage,
  onOpenEvent,
}: {
  accounts: MailAccount[];
  titleLeading?: ReactNode;
  titleTrailing?: ReactNode;
  onOpenMessage: (message: MessageSummary) => void;
  onOpenEvent: (event: CalEvent) => void;
}) {
  const now = useNow();
  const today = startOfDay(now).getTime();
  const mail = useTodayMail(accounts, today);
  const events = useTodayEvents(accounts, today);
  const todoist = useTodayTasks();
  const user = useOtterAccount()?.user;
  const name = user?.name?.split(" ")[0];

  const nowMs = now.getTime();
  const ahead = events.filter((e) => e.endMs > nowMs);
  const [next, ...later] = ahead;
  const day: NoteTarget = { kind: "day", date: dayKey(now) };
  const done = useMarginNotes([day, ...mail.map(threadTarget), ...events.map(eventTarget)]).filter(
    (n) => n.kind === "done",
  );

  const needs = mail.length + todoist.tasks.length;
  const settled = done.length > 0 ? `Your agents settled ${done.length}.` : null;
  const meetings = ahead.length > 0 ? `${counted(ahead.length, "meeting", "meetings")}.` : null;
  const empty = needs === 0 && ahead.length === 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        data-toolbar=""
        className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 px-4"
      >
        {titleLeading}
        <span className="flex-1" />
        {titleTrailing}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MarginPage className="flex flex-col gap-10 pt-6 pb-24">
          <MarginRow margin={<AgentNotes target={day} />}>
            <div className="flex flex-col gap-3">
              <span className="font-mono text-2xs tracking-widest text-placeholder uppercase">
                {now.toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </span>
              <h1 className="font-reading text-3xl leading-tight text-foreground">
                {greeting(now)}
                {name ? `, ${name}` : ""}.
              </h1>
              <p className="font-reading text-xl leading-snug text-muted-foreground">
                {empty ? (
                  "Nothing needs you today."
                ) : (
                  <>
                    {needs > 0 ? (
                      <span className="text-question-foreground">
                        {counted(needs, "thing needs", "things need")} you.{" "}
                      </span>
                    ) : null}
                    {[meetings, settled].filter(Boolean).join(" ")}
                  </>
                )}
              </p>
            </div>
          </MarginRow>

          {next ? (
            <section className="flex flex-col gap-4">
              <MarginRow>
                <SectionHead label={next.startMs <= nowMs ? "Now" : "Next"} />
              </MarginRow>
              <EventRow event={next} now={nowMs} lead onOpen={() => onOpenEvent(next)} />
            </section>
          ) : null}

          {needs > 0 ? (
            <section className="flex flex-col gap-6">
              <MarginRow>
                <SectionHead label="Needs you" count={needs} attention />
              </MarginRow>
              {mail.map((m) => (
                <MailRow
                  key={`${m.accountId}/${m.threadId}`}
                  message={m}
                  onOpen={() => onOpenMessage(m)}
                />
              ))}
              {todoist.tasks.map((t) => (
                <TaskRow key={t.id} task={t} today={dayKey(now)} onOpen={todoist.open} />
              ))}
            </section>
          ) : null}

          {later.length > 0 ? (
            <section className="flex flex-col gap-6">
              <MarginRow>
                <SectionHead label="Later" count={later.length} />
              </MarginRow>
              {later.map((e) => (
                <EventRow
                  key={`${e.calendarId}/${e.id}`}
                  event={e}
                  now={nowMs}
                  onOpen={() => onOpenEvent(e)}
                />
              ))}
            </section>
          ) : null}

          {settled ? (
            <MarginRow>
              <p className="flex items-center gap-2.5 border-t border-border pt-4 font-reading text-md text-placeholder">
                <CheckIcon className="size-4 shrink-0" />
                {done.length} settled by your agents today.
              </p>
            </MarginRow>
          ) : null}
        </MarginPage>
      </div>
    </div>
  );
}

function ItemButton({
  onOpen,
  className,
  children,
}: {
  onOpen?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={!onOpen}
      onClick={onOpen}
      className={cn(
        "flex w-full min-w-0 cursor-pointer flex-col gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-default",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Kicker({
  who,
  unread,
  children,
}: {
  who: ReactNode;
  unread?: boolean;
  children?: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {unread ? (
        <span
          aria-label="Unread"
          className="size-1.5 shrink-0 rounded-full bg-question-foreground"
        />
      ) : null}
      <span className="truncate text-body text-foreground">{who}</span>
      {children ? (
        <span className="truncate font-mono text-3xs tracking-wider text-placeholder uppercase">
          {children}
        </span>
      ) : null}
    </span>
  );
}

function EventRow({
  event,
  now,
  lead = false,
  onOpen,
}: {
  event: CalEvent;
  now: number;
  /** The one coming up: larger, with Join. */
  lead?: boolean;
  onOpen: () => void;
}) {
  const link = event.meetingLink;
  const minutes = Math.round((event.endMs - event.startMs) / MINUTE);
  return (
    <MarginRow
      gutter={
        <span className={cn(lead && "text-question-foreground")}>
          {timeLabel(new Date(event.startMs))}
        </span>
      }
      margin={<AgentNotes target={eventTarget(event)} />}
    >
      <div className="flex flex-col gap-3">
        <ItemButton onOpen={onOpen}>
          <Kicker who={lead ? untilLabel(event, now) : `${minutes} min`}>
            {meta(
              link && MEETING_NAMES[meetingProvider(link)],
              !link && event.location,
              people(event),
            )}
          </Kicker>
          <span
            className={cn(
              "font-reading leading-snug text-foreground",
              lead ? "text-2xl" : "text-xl",
            )}
          >
            {event.title || "(No title)"}
          </span>
        </ItemButton>
        {lead ? (
          <div className="flex items-center gap-2">
            {link ? (
              <Button size="sm" variant="primary" onClick={() => openLink(link)}>
                Join
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={onOpen}>
              Open
            </Button>
          </div>
        ) : null}
      </div>
    </MarginRow>
  );
}

function MailRow({ message, onOpen }: { message: MessageSummary; onOpen: () => void }) {
  const count = message.threadCount ?? 1;
  return (
    <MarginRow
      gutter={timeLabel(new Date(message.date))}
      margin={<AgentNotes target={threadTarget(message)} />}
    >
      <ItemButton onOpen={onOpen}>
        <Kicker
          who={message.fromName || message.fromEmail}
          unread={message.threadUnread ?? message.unread}
        >
          {meta(count > 1 && `${count} messages`, message.hasAttachments && "Attachment")}
        </Kicker>
        <span className="font-reading text-xl leading-snug text-foreground">
          {message.subject || "(No subject)"}
        </span>
        {message.snippet ? (
          <span className="line-clamp-2 text-sm text-muted-foreground">
            {decodeEntities(message.snippet)}
          </span>
        ) : null}
      </ItemButton>
    </MarginRow>
  );
}

function TaskRow({
  task,
  today,
  onOpen,
}: {
  task: TodoistTask;
  today: string;
  onOpen?: () => void;
}) {
  const overdue = !!task.due && task.due.date.slice(0, 10) < today;
  return (
    <MarginRow gutter={overdue ? "Overdue" : "Today"}>
      <ItemButton onOpen={onOpen}>
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="size-3 shrink-0 rounded-sm border border-placeholder" />
          <span className="text-body text-foreground">Task</span>
          {task.due?.string ? (
            <span className="truncate font-mono text-3xs tracking-wider text-placeholder uppercase">
              {task.due.string}
            </span>
          ) : null}
        </span>
        <span className="font-reading text-xl leading-snug text-foreground">{task.content}</span>
      </ItemButton>
    </MarginRow>
  );
}
