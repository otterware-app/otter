import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Dialog } from "~/components/ui/dialog";
import {
  AlignLeftIcon,
  ArrowRightIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  MapPinIcon,
  RepeatIcon,
  Trash2Icon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { meetingProvider, type MeetingService } from "@otter-mail/contracts";
import { getAccountDisplayName } from "../mail/account-style";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../mail/menu";
import { HintTooltip, IconBtn, cn } from "../mail/ui";
import {
  calendarKey,
  eventTimes,
  hasGuests,
  type CalEvent,
  type EventInput,
  type Repeat,
  type RsvpResponse,
  type useCalendarActions,
} from "./api";
import { useCalendar, type DraftEvent } from "./calendar-store";
import type { ListedCalendar } from "./calendar-view";
import { DAY, HOUR, dayKey, durationLabel, startOfDay, timeLabel } from "./dates";
import { AddMeetingRow, MeetingRow } from "./meeting";
import { useCalendarPreferences } from "./preferences";
import { eventKey } from "./time-grid";

const WIDTH = 304;
const GAP = 8;

type Actions = ReturnType<typeof useCalendarActions>;

/** Where the card goes: beside its event (right, else left), within the calendar. */
function usePlacement(
  containerRef: RefObject<HTMLElement | null>,
  anchorKey: string,
  panelRef: RefObject<HTMLElement | null>,
) {
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const box = container.getBoundingClientRect();
      const anchor = container
        .querySelector(`[data-event-key="${CSS.escape(anchorKey)}"]`)
        ?.getBoundingClientRect();
      const height = panelRef.current?.offsetHeight ?? 420;
      if (!anchor) {
        setPlace({ left: box.width - WIDTH - 16, top: 16 });
        return;
      }
      const right = anchor.right - box.left + GAP;
      const left =
        right + WIDTH <= box.width - 8 ? right : Math.max(8, anchor.left - box.left - GAP - WIDTH);
      const top = Math.min(
        Math.max(8, anchor.top - box.top - 40),
        Math.max(8, box.height - height - 8),
      );
      setPlace({ left, top });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (panelRef.current) observer.observe(panelRef.current);
    container.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", measure, true);
    };
  }, [containerRef, anchorKey, panelRef]);
  return place;
}

export function EventPanel({
  containerRef,
  event,
  draft,
  calendars,
  colorOf,
  actions,
}: {
  containerRef: RefObject<HTMLElement | null>;
  event: CalEvent | null;
  draft: DraftEvent | null;
  calendars: ListedCalendar[];
  colorOf: (key: string) => string;
  actions: Actions;
}) {
  const select = useCalendar((s) => s.select);
  const setDraft = useCalendar((s) => s.setDraft);
  const panelRef = useRef<HTMLDivElement>(null);
  const anchorKey = event ? eventKey(event) : "draft";
  const calendarOf = (ref: { accountId: string; calendarId: string }) =>
    calendars.find((c) => c.key === calendarKey(ref));
  const place = usePlacement(containerRef, anchorKey, panelRef);
  const close = () => select(null);
  // Slides between events once shown; appears where it is.
  const [placed, setPlaced] = useState(false);
  useEffect(() => {
    if (!place || placed) return;
    const frame = requestAnimationFrame(() => setPlaced(true));
    return () => cancelAnimationFrame(frame);
  }, [place, placed]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      select(null);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [select]);

  if (!event && !draft) return null;
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={event ? event.title : "New event"}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        width: WIDTH,
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        visibility: place ? "visible" : "hidden",
      }}
      className={cn(
        "absolute z-40 border border-border/70 [background:linear-gradient(var(--popover),var(--popover)),var(--canvas)] flex max-h-[calc(100%-16px)] flex-col overflow-y-auto rounded-xl text-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)] animate-calendar-fade motion-reduce:animate-none",
        placed && "transition-[left,top] duration-150 ease-out",
      )}
    >
      {event?.teammate ? (
        <TeammateEvent event={event} color={colorOf(calendarKey(event))} onClose={close} />
      ) : event?.readOnly ? (
        <ReadOnlyEvent
          event={event}
          color={colorOf(calendarKey(event))}
          owner={calendarLabel(calendarOf(event)) ?? event.accountId}
          onClose={close}
        />
      ) : event ? (
        <EventDetails
          key={anchorKey}
          event={event}
          color={colorOf(calendarKey(event))}
          calendarName={calendarLabel(calendarOf(event)) ?? event.accountId}
          meetings={calendarOf(event)?.info.meetings ?? null}
          actions={actions}
          onClose={close}
        />
      ) : draft ? (
        <NewEvent
          draft={draft}
          calendars={calendars.filter((c) => c.info.writable)}
          colorOf={colorOf}
          onChange={(next) => setDraft(next)}
          onCreate={async (input) => {
            const made = await actions.create(draft, input, (input.attendees ?? []).length > 0);
            if (made)
              select({ accountId: made.accountId, calendarId: made.calendarId, id: made.id });
            else setDraft(null);
          }}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

function Header({
  title,
  children,
  onClose,
}: {
  title: string;
  children?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 pl-4 pr-2">
      <span className="flex-1 text-[13px] text-muted-foreground">{title}</span>
      {children}
      <IconBtn label="Close" onClick={onClose}>
        <XIcon />
      </IconBtn>
    </div>
  );
}

function Row({
  icon,
  children,
  className,
}: {
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-8 items-start gap-3 px-4 py-1", className)}>
      <span className="flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-[15px]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const Divider = () => <div className="my-1.5 h-px bg-border/60" />;

const FIELD =
  "w-full min-w-0 rounded-md bg-transparent px-1.5 -mx-1.5 py-0.5 text-[13px] text-foreground outline-none placeholder:text-placeholder hover:bg-foreground/[0.04] focus:bg-foreground/[0.06]";

/** A field that saves when it's left (or on Enter), not on every key. */
function CommitInput({
  value,
  placeholder,
  onCommit,
  className,
  multiline = false,
  autoFocus = false,
}: {
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
  className?: string;
  multiline?: boolean;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setText(value);
  }
  const commit = () => {
    if (text.trim() !== value.trim()) onCommit(text.trim());
  };
  const props = {
    value: text,
    placeholder,
    autoFocus,
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: commit,
    className: cn(FIELD, className),
  };
  return multiline ? (
    <textarea
      {...props}
      className={cn(props.className, "max-h-48 resize-none leading-5 [field-sizing:content]")}
    />
  ) : (
    <input
      {...props}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const timeValue = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const withTime = (ms: number, value: string) => {
  const [h, m] = value.split(":").map(Number);
  const d = startOfDay(new Date(ms));
  d.setHours(h, m);
  return d.getTime();
};
const withDate = (ms: number, value: string) => {
  const [y, mo, d] = value.split("-").map(Number);
  const next = new Date(ms);
  next.setFullYear(y, mo - 1, d);
  return next.getTime();
};

/** Every day, Weekly on Monday, Monthly on day 12... from the day it starts. */
function repeatLabel(repeat: Repeat, startMs: number): string {
  const d = new Date(startMs);
  switch (repeat) {
    case "daily":
      return "Every day";
    case "weekdays":
      return "Every weekday";
    case "weekly":
      return `Weekly on ${d.toLocaleDateString(undefined, { weekday: "long" })}`;
    case "monthly":
      return `Monthly on day ${d.getDate()}`;
    case "yearly":
      return `Yearly on ${d.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`;
  }
}

const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** A time or a day in words; the native picker opens from it. */
function Pick({
  type,
  value,
  label,
  text,
  onPick,
}: {
  type: "time" | "date";
  value: string;
  label: string;
  text: string;
  onPick: (value: string) => void;
}) {
  return (
    <label className="relative -mx-1.5 inline-flex h-7 cursor-pointer items-center whitespace-nowrap rounded-md px-1.5 text-[13px] tabular-nums text-foreground hover:bg-foreground/[0.05]">
      {text}
      <input
        type={type}
        aria-label={label}
        className="absolute inset-0 cursor-pointer opacity-0 [color-scheme:light] dark:[color-scheme:dark]"
        value={value}
        onClick={(e) => e.currentTarget.showPicker?.()}
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value);
        }}
      />
    </label>
  );
}

/**
 * Notion Calendar's time block: start → end with how long, each over its
 * day, and All-day under them. Every part edits in place.
 */
function TimeRows({
  startMs,
  endMs,
  allDay,
  onChange,
  repeat,
  onRepeat,
}: {
  startMs: number;
  endMs: number;
  allDay: boolean;
  onChange: (startMs: number, endMs: number, allDay: boolean) => void;
  /** New events: how it repeats (Notion Calendar's Repeat). */
  repeat?: Repeat | null;
  onRepeat?: (repeat: Repeat | null) => void;
}) {
  const length = endMs - startMs;
  // All-day events end the day after their last.
  const lastDay = allDay ? endMs - DAY : endMs;
  const toggleAllDay = () => {
    if (allDay) {
      const start = startOfDay(new Date(startMs)).getTime() + 9 * HOUR;
      onChange(start, start + HOUR, false);
    } else {
      const start = startOfDay(new Date(startMs)).getTime();
      onChange(start, startOfDay(new Date(endMs - 1)).getTime() + DAY, true);
    }
  };
  return (
    <Row icon={<ClockIcon />} className="py-1.5">
      <div className="grid grid-cols-[auto_auto_auto_1fr] items-center gap-x-2.5">
        {allDay ? null : (
          <>
            <Pick
              type="time"
              label="Starts"
              value={timeValue(startMs)}
              text={timeLabel(new Date(startMs))}
              onPick={(v) => {
                const start = withTime(startMs, v);
                onChange(start, start + length, false);
              }}
            />
            <ArrowRightIcon className="size-3.5 text-muted-foreground" />
            <Pick
              type="time"
              label="Ends"
              value={timeValue(endMs)}
              text={timeLabel(new Date(endMs))}
              onPick={(v) => {
                let end = withTime(endMs, v);
                if (end <= startMs) end += DAY;
                onChange(startMs, end, false);
              }}
            />
            <span className="truncate text-[13px] text-muted-foreground">
              {durationLabel(length)}
            </span>
          </>
        )}
        <Pick
          type="date"
          label="Starts on"
          value={dayKey(new Date(startMs))}
          text={dayLabel(startMs)}
          onPick={(v) => {
            const start = withDate(startMs, v);
            onChange(start, start + length, allDay);
          }}
        />
        {allDay ? <ArrowRightIcon className="size-3.5 text-muted-foreground" /> : <span />}
        <Pick
          type="date"
          label="Ends on"
          value={dayKey(new Date(lastDay))}
          text={dayLabel(lastDay)}
          onPick={(v) => {
            const end = withDate(lastDay, v) + (allDay ? DAY : 0);
            if (end > startMs) onChange(startMs, end, allDay);
          }}
        />
        <span />
      </div>
      <div className="mt-0.5 flex items-center gap-3">
        <button
          type="button"
          aria-pressed={allDay}
          onClick={toggleAllDay}
          className={cn(
            "-mx-1.5 h-7 cursor-pointer rounded-md px-1.5 text-[13px] outline-none transition-colors hover:bg-foreground/[0.05]",
            allDay ? "text-foreground" : "text-muted-foreground",
          )}
        >
          All-day
        </button>
        {onRepeat ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[13px] outline-none transition-colors hover:bg-foreground/[0.05]",
                  repeat ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <RepeatIcon className="size-3.5 shrink-0" />
                <span className="truncate">{repeat ? repeatLabel(repeat, startMs) : "Repeat"}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {([null, "daily", "weekdays", "weekly", "monthly", "yearly"] as const).map(
                (option) => (
                  <DropdownMenuItem
                    key={option ?? "none"}
                    icon={option === (repeat ?? null) ? <CheckIcon /> : <span className="size-4" />}
                    onSelect={() => onRepeat(option)}
                  >
                    {option ? repeatLabel(option, startMs) : "Does not repeat"}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </Row>
  );
}

function initials(name: string) {
  return (name.match(/\b\p{L}/gu) ?? [name[0] ?? "?"]).slice(0, 2).join("").toUpperCase();
}

const RESPONSE_DOT: Record<string, string> = {
  accepted: "bg-success",
  declined: "bg-destructive",
  tentative: "bg-warning",
  needsAction: "bg-muted-foreground/40",
};

function People({ event }: { event: CalEvent }) {
  if (event.attendees.length === 0) return null;
  const yes = event.attendees.filter((a) => a.response === "accepted").length;
  const me = event.accountId.toLowerCase();
  return (
    <>
      <Divider />
      <Row icon={<UsersIcon />}>
        <div className="flex h-6 items-baseline gap-2 text-[13px]">
          <span>
            {event.attendees.length} {event.attendees.length === 1 ? "guest" : "guests"}
          </span>
          <span className="text-xs text-muted-foreground">{yes} yes</span>
        </div>
      </Row>
      <div className="flex flex-col pb-1">
        {event.attendees.map((a) => {
          const name = a.name || a.email;
          const isMe = a.email.toLowerCase() === me;
          return (
            <div key={a.email} className="flex h-8 items-center gap-3 px-4" title={a.email}>
              <span className="relative flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] text-[9px] font-medium text-muted-foreground">
                {initials(name)}
                <span
                  aria-label={a.response}
                  className={cn(
                    "absolute -bottom-px -right-px size-2 rounded-full ring-2 ring-popover",
                    RESPONSE_DOT[a.response],
                  )}
                />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {isMe ? `${name} (you)` : name}
              </span>
              {event.organizer?.toLowerCase() === a.email.toLowerCase() ? (
                <span className="shrink-0 text-xs text-muted-foreground">Organizer</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Rsvp({
  value,
  onChange,
}: {
  value: RsvpResponse | "needsAction";
  onChange: (r: RsvpResponse) => void;
}) {
  const options: [RsvpResponse, string][] = [
    ["accepted", "Yes"],
    ["declined", "No"],
    ["tentative", "Maybe"],
  ];
  return (
    <div className="mx-4 mb-2 mt-1 flex rounded-lg bg-foreground/[0.05] p-0.5">
      {options.map(([response, label]) => (
        <button
          key={response}
          type="button"
          onClick={() => onChange(response)}
          className={cn(
            "h-7 flex-1 cursor-pointer rounded-md text-[13px] outline-none transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-focus-ring",
            value === response
              ? "bg-canvas font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/12%)] dark:bg-foreground/[0.12]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** A description as text: Google's may be HTML (an invitation's paragraphs, breaks, entities). */
function plainText(description: string): string {
  if (!/<[a-z][^>]*>/i.test(description)) return description;
  const lines = description.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|li|h\d)>/gi, "$&\n");
  // Parsed, never shown as HTML: nothing in it runs.
  const text = new DOMParser().parseFromString(lines, "text/html").body.textContent ?? "";
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** A calendar's name as shown: the mailbox's for its primary calendar. */
function calendarLabel(calendar: ListedCalendar | undefined): string | undefined {
  if (!calendar) return undefined;
  return calendar.info.primary ? getAccountDisplayName(calendar.account) : calendar.info.name;
}

/** A teammate's busy time: what it is, when, and whose. */
function TeammateEvent({
  event,
  color,
  onClose,
}: {
  event: CalEvent;
  color: string;
  onClose: () => void;
}) {
  const name = useCalendar((s) => s.team.find((t) => t.email === event.teammate)?.name);
  return (
    <ReadOnlyEvent
      event={event}
      color={color}
      owner={name ?? event.teammate ?? ""}
      note="Busy"
      onClose={onClose}
    />
  );
}

/** An event only to look at (a followed calendar's, a teammate's): what, when, where, whose. */
function ReadOnlyEvent({
  event,
  color,
  owner,
  note,
  onClose,
}: {
  event: CalEvent;
  color: string;
  owner: string;
  note?: string;
  onClose: () => void;
}) {
  const lastDay = event.allDay ? event.endMs - DAY : event.endMs - 1;
  const sameDay =
    startOfDay(new Date(event.startMs)).getTime() === startOfDay(new Date(lastDay)).getTime();
  return (
    <>
      <Header title="Event" onClose={onClose} />
      <div className="px-4 pb-2 text-[15px] font-medium">{event.title}</div>
      <Divider />
      <Row icon={<ClockIcon />} className="py-1.5">
        {event.allDay ? null : (
          <div className="flex h-7 items-center gap-2.5 text-[13px] tabular-nums">
            <span>{timeLabel(new Date(event.startMs))}</span>
            <ArrowRightIcon className="size-3.5 text-muted-foreground" />
            <span>{timeLabel(new Date(event.endMs))}</span>
            <span className="text-muted-foreground">
              {durationLabel(event.endMs - event.startMs)}
            </span>
          </div>
        )}
        <div className="flex h-7 items-center gap-2.5 text-[13px]">
          <span>{dayLabel(event.startMs)}</span>
          {sameDay ? null : (
            <>
              <ArrowRightIcon className="size-3.5 text-muted-foreground" />
              <span>{dayLabel(lastDay)}</span>
            </>
          )}
          {event.allDay ? <span className="text-muted-foreground">All day</span> : null}
        </div>
      </Row>
      {event.meetingLink ? <MeetingRow link={event.meetingLink} /> : null}
      {event.location ? (
        <Row icon={<MapPinIcon />}>
          <span className="flex min-h-6 items-center text-[13px]">{event.location}</span>
        </Row>
      ) : null}
      {event.description ? (
        <Row icon={<AlignLeftIcon />}>
          <p className="whitespace-pre-wrap py-0.5 text-[13px] leading-5 text-foreground">
            {plainText(event.description)}
          </p>
        </Row>
      ) : null}
      <Divider />
      <Row
        icon={<span className="size-3 rounded-[3px]" style={{ background: color }} />}
        className="mb-2"
      >
        <span className="flex h-6 items-center truncate text-[13px]">
          {owner}
          {note ? <span className="ml-3 text-muted-foreground">{note}</span> : null}
        </span>
      </Row>
    </>
  );
}

/** Answering a repeating invitation: this event or all of them, and a note for the organizer. */
function SeriesResponseDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (allEvents: boolean, comment: string) => void;
}) {
  const [allEvents, setAllEvents] = useState(false);
  const [note, setNote] = useState("");
  // Each opening starts afresh.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setAllEvents(false);
      setNote("");
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="small"
      title="Save response status for repeat event"
      confirmLabel="Save response"
      onConfirm={() => onSave(allEvents, note.trim())}
    >
      <div className="flex flex-col gap-1" role="radiogroup">
        {[
          [false, "This event"],
          [true, "All events"],
        ].map(([value, label]) => (
          <label
            key={String(value)}
            className="flex h-8 cursor-pointer items-center gap-3 text-[13px]"
          >
            <input
              type="radio"
              name="series-response"
              checked={allEvents === value}
              onChange={() => setAllEvents(value as boolean)}
              className="size-4 accent-primary"
            />
            {label}
          </label>
        ))}
      </div>
      <input
        value={note}
        placeholder="Leave a note (optional)"
        aria-label="Note for the organizer"
        onChange={(e) => setNote(e.target.value)}
        className="h-9 w-full rounded-lg border border-border/70 bg-transparent px-3 text-[13px] outline-none placeholder:text-placeholder focus-visible:border-focus-ring/60"
      />
    </Dialog>
  );
}

function EventDetails({
  event,
  color,
  calendarName,
  meetings,
  actions,
  onClose,
}: {
  event: CalEvent;
  color: string;
  calendarName: string;
  /** The online meeting its calendar can add. */
  meetings: MeetingService | null;
  actions: Actions;
  onClose: () => void;
}) {
  const notify = hasGuests(event);
  const mine = !event.organizer || event.organizer.toLowerCase() === event.accountId.toLowerCase();
  const update = (patch: EventInput) => actions.update(event, patch, notify);
  // A repeating invitation: this occurrence or all of them (Notion Calendar's question).
  const [asking, setAsking] = useState<RsvpResponse | null>(null);
  return (
    <>
      <SeriesResponseDialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        onSave={(allEvents, comment) => {
          if (asking) actions.respond(event, asking, { allEvents, comment });
        }}
      />
      <Header title={event.recurring ? "Event · repeats" : "Event"} onClose={onClose}>
        {event.htmlLink ? (
          <HintTooltip label="Open in your calendar">
            <IconBtn
              label="Open in your calendar"
              onClick={() => window.open(event.htmlLink!, "_blank")}
            >
              <ExternalLinkIcon />
            </IconBtn>
          </HintTooltip>
        ) : null}
        <HintTooltip label="Delete event">
          <IconBtn
            label="Delete event"
            onClick={() => {
              actions.remove(event, notify && mine);
              onClose();
            }}
          >
            <Trash2Icon />
          </IconBtn>
        </HintTooltip>
      </Header>
      <div className="px-4 pb-2">
        <CommitInput
          value={event.title}
          placeholder="Title"
          onCommit={(title) => update({ title: title || "(no title)" })}
          className="text-[15px] font-medium"
        />
      </div>
      <Divider />
      <TimeRows
        startMs={event.startMs}
        endMs={event.endMs}
        allDay={event.allDay}
        onChange={(start, end, allDay) => update({ ...eventTimes(start, end, allDay), allDay })}
      />
      {event.recurring ? (
        <Row icon={<RepeatIcon />}>
          <span className="flex h-6 items-center text-[13px] text-muted-foreground">
            Repeats · changes apply to this one
          </span>
        </Row>
      ) : null}
      {event.meetingLink ? (
        <MeetingRow
          link={event.meetingLink}
          // Google lets its Meet come off; Outlook keeps a Teams meeting once it's made.
          onRemove={
            mine && meetings === "googleMeet" && meetingProvider(event.meetingLink) === "googleMeet"
              ? () => update({ videoCall: false })
              : undefined
          }
        />
      ) : mine && meetings ? (
        <AddMeetingRow
          service={meetings}
          added={false}
          onChange={() => update({ videoCall: true })}
        />
      ) : null}
      <Row icon={<MapPinIcon />}>
        <CommitInput
          value={event.location ?? ""}
          placeholder="Location"
          onCommit={(location) => update({ location })}
        />
      </Row>
      <People event={event} />
      {event.response && !mine ? (
        <Rsvp
          value={event.response}
          onChange={(r) => (event.recurring ? setAsking(r) : actions.respond(event, r))}
        />
      ) : null}
      <Divider />
      <Row icon={<AlignLeftIcon />}>
        <CommitInput
          value={plainText(event.description ?? "")}
          placeholder="Description"
          multiline
          onCommit={(description) => update({ description })}
        />
      </Row>
      <Divider />
      <Row
        icon={<span className="size-3 rounded-[3px]" style={{ background: color }} />}
        className="mb-2"
      >
        <span className="flex h-6 items-center truncate text-[13px]">{calendarName}</span>
      </Row>
    </>
  );
}

function NewEvent({
  draft,
  calendars,
  colorOf,
  onChange,
  onCreate,
  onClose,
}: {
  draft: DraftEvent;
  /** The calendars it can go on. */
  calendars: ListedCalendar[];
  colorOf: (key: string) => string;
  onChange: (draft: DraftEvent) => void;
  onCreate: (input: EventInput) => Promise<void>;
  onClose: () => void;
}) {
  const title = draft.title ?? "";
  const titleRef = useRef<HTMLInputElement>(null);
  // After the click that drew it has settled, so the click doesn't take focus back.
  useEffect(() => {
    const frame = requestAnimationFrame(() => titleRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const [location, setLocation] = useState("");
  const [guests, setGuests] = useState("");
  const [saving, setSaving] = useState(false);
  const target = calendars.find((c) => c.key === calendarKey(draft));
  // On by default for the mailboxes set so in Settings, until turned off here.
  const { meetingsByDefault } = useCalendarPreferences();
  const [meetingChoice, setMeetingChoice] = useState<boolean | null>(null);
  const meetings = target?.info.meetings ?? null;
  const meeting =
    meetings !== null && (meetingChoice ?? meetingsByDefault.includes(draft.accountId));
  const create = async () => {
    if (saving) return;
    setSaving(true);
    const attendees = guests
      .split(/[\s,;]+/)
      .map((g) => g.trim())
      .filter((g) => g.includes("@"));
    await onCreate({
      title: title.trim() || "(no title)",
      ...eventTimes(draft.startMs, draft.endMs, draft.allDay),
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(attendees.length ? { attendees } : {}),
      ...(draft.repeat ? { repeat: draft.repeat } : {}),
      ...(meeting ? { videoCall: true } : {}),
    });
  };
  const enter = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void create();
    }
  };
  return (
    <>
      <Header title="New event" onClose={onClose} />
      <div className="px-4 pb-2">
        <input
          ref={titleRef}
          value={title}
          placeholder="Event title"
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          onKeyDown={enter}
          className="h-9 w-full rounded-lg bg-foreground/[0.05] px-3 text-[14px] font-medium text-foreground outline-none placeholder:font-normal placeholder:text-placeholder focus:bg-foreground/[0.07]"
        />
      </div>
      <Divider />
      <TimeRows
        startMs={draft.startMs}
        endMs={draft.endMs}
        allDay={draft.allDay}
        onChange={(startMs, endMs, allDay) => onChange({ ...draft, startMs, endMs, allDay })}
        repeat={draft.repeat ?? null}
        onRepeat={(repeat) => onChange({ ...draft, repeat: repeat ?? undefined })}
      />
      {meetings ? (
        <AddMeetingRow service={meetings} added={meeting} onChange={setMeetingChoice} />
      ) : null}
      <Row icon={<MapPinIcon />}>
        <input
          value={location}
          placeholder="Location"
          onChange={(e) => setLocation(e.target.value)}
          onKeyDown={enter}
          className={FIELD}
        />
      </Row>
      <Row icon={<UsersIcon />}>
        <input
          value={guests}
          placeholder="Participants"
          onChange={(e) => setGuests(e.target.value)}
          onKeyDown={enter}
          className={FIELD}
        />
      </Row>
      <Divider />
      <Row icon={<CalendarIcon />}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="-mx-1.5 flex h-6 max-w-full cursor-pointer items-center gap-2 rounded-md px-1.5 text-[13px] outline-none hover:bg-foreground/[0.04]"
            >
              <span
                className="size-3 shrink-0 rounded-[3px]"
                style={{ background: colorOf(calendarKey(draft)) }}
              />
              <span className="truncate">{calendarLabel(target) ?? draft.accountId}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {/* By mailbox, as in the sidebar. */}
            {[...new Set(calendars.map((c) => c.account.id))].map((accountId) => {
              const group = calendars.filter((c) => c.account.id === accountId);
              return (
                <div key={accountId}>
                  <DropdownMenuLabel>{getAccountDisplayName(group[0]!.account)}</DropdownMenuLabel>
                  {group.map((c) => (
                    <DropdownMenuItem
                      key={c.key}
                      icon={
                        <span
                          className="size-3 rounded-[3px]"
                          style={{ background: colorOf(c.key) }}
                        />
                      }
                      onSelect={() =>
                        onChange({ ...draft, accountId: c.account.id, calendarId: c.info.id })
                      }
                    >
                      {c.info.primary ? getAccountDisplayName(c.account) : c.info.name}
                    </DropdownMenuItem>
                  ))}
                </div>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </Row>
      <div className="flex justify-end gap-2 px-4 pb-3 pt-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void create()}
          className="h-7 cursor-pointer rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          Create event
        </button>
      </div>
    </>
  );
}
