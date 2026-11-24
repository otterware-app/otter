import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarClockIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleMinusIcon,
  EllipsisIcon,
  ListFilterIcon,
  LockIcon,
  MessageSquareIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RotateCwIcon,
  Trash2Icon,
} from "lucide-react";
import type { AgentScheduledTasks, ScheduledTask, TaskRun } from "@otter/contracts/scheduled";
import { Dialog } from "@otter/ui/components/dialog";
import { Field } from "@otter/ui/components/field";
import { Input } from "@otter/ui/components/input";
import { Spinner } from "@otter/ui/components/spinner";
import { Textarea } from "@otter/ui/components/textarea";
import { Switch } from "@otter/ui/components/switch";
import { AgentAvatar } from "./agent-providers";
import { agentContribution } from "../extensions/registry";
import { readableError } from "@otter/client/errors";
import { ChatMarkdown } from "./chat-markdown";
import { useNow } from "@otter/client/agents/chat-shelves";
import { useChats } from "@otter/client/agents/chat-store";
import { EmptyState } from "@otter/ui/components/empty-state";
import { useWidth } from "../use-width";
import { isTypingTarget } from "../mail/keyboard";
import { useLatest } from "@otter/client/use-latest";
import {
  agoText,
  scheduleText,
  type Repeat,
  type WhenForm,
} from "@otter/client/agents/scheduled-text";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@otter/ui/components/select";
import { Button, IconButton } from "@otter/ui/components/button";
import { cn } from "@otter/ui/lib/utils";
import {
  NO_FILTER,
  TASK_STATUSES,
  canCreateTasks,
  deleteTask,
  deliveryText,
  enableTask,
  isFiltering,
  keyOf,
  managedNote,
  matches,
  modelName,
  runDelivery,
  runMeta,
  runTaskNow,
  runStatusLabel,
  runWhen,
  scheduledEmpty,
  taskAgents,
  taskCallout,
  taskEditable,
  taskNext,
  taskProblem,
  taskResults,
  taskSections,
  taskWhen,
  useAgentName,
  useRunTranscript,
  useScheduledTasks,
  useTaskAction,
  useTaskModels,
  useTaskRuns,
  type Destination,
  type TaskFilter,
} from "@otter/client/agents/agent-scheduled";
import {
  MONTH_DAY_OPTIONS,
  REPEATS,
  TIMED,
  UNIT_OPTIONS,
  WEEKDAY_OPTIONS,
  destinationAccount,
  destinationChannel,
  pickDestination,
  resultsDescription,
  resultsOptions,
  targetHint,
  useDeliveryTargets,
  useTaskEditor,
} from "@otter/client/agents/scheduled-editor";
import { useAgentProviders } from "@otter/client/agents/agent-providers";

/** The Agents space's place for every agent's scheduled tasks: /agents/scheduled. */
export const SCHEDULED_TASKS = "scheduled";

export function ScheduledTasksView({
  taskKey,
  onOpenTask,
  titleLeading,
  titleTrailing,
  onSelectChat,
}: {
  /** The task shown (`provider:id`); null for the list. */
  taskKey: string | null;
  onOpenTask: (key: string | null) => void;
  titleLeading?: ReactNode;
  titleTrailing?: ReactNode;
  onSelectChat: (chatId: string) => void;
}) {
  const query = useScheduledTasks(true);
  const agents = query.data ?? [];
  const now = useNow(30_000);
  const [editing, setEditing] = useState<ScheduledTask | "new" | null>(null);
  const agentName = useAgentName();

  const tasks = agents.flatMap((a) => a.tasks);
  const [filter, setFilter] = useState<TaskFilter>(NO_FILTER);
  const shown = tasks.filter((t) => matches(t, filter));
  const agentOf = (task: ScheduledTask) => agents.find((a) => a.provider === task.provider)!;
  const current = taskKey ? (tasks.find((t) => keyOf(t) === taskKey) ?? null) : null;
  const creatable = canCreateTasks(agents);

  const onOpenTaskRef = useLatest(onOpenTask);
  useEffect(() => {
    if (!taskKey) return;
    const back = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      onOpenTaskRef.current(null);
    };
    window.addEventListener("keydown", back);
    return () => window.removeEventListener("keydown", back);
  }, [taskKey, onOpenTaskRef]);

  const { attention, active, paused, ordered } = taskSections(shown);
  const [width, measure] = useWidth(Infinity);
  // The inbox's split: the list beside the task, when there's room for both.
  const split = width >= SPLIT_WIDTH;

  const orderedRef = useLatest(ordered);
  useEffect(() => {
    if (!split) return;
    const move = (e: KeyboardEvent) => {
      if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || e.defaultPrevented) return;
      if (isTypingTarget(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      const list = orderedRef.current;
      if (list.length === 0) return;
      e.preventDefault();
      const at = list.findIndex((t) => keyOf(t) === taskKey);
      const next =
        at < 0
          ? e.key === "ArrowDown"
            ? 0
            : list.length - 1
          : Math.min(list.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
      onOpenTaskRef.current(keyOf(list[next]!));
    };
    window.addEventListener("keydown", move);
    return () => window.removeEventListener("keydown", move);
  }, [split, taskKey, orderedRef, onOpenTaskRef]);

  const row = (task: ScheduledTask) => (
    <TaskRow
      key={keyOf(task)}
      task={task}
      now={now}
      selected={split && keyOf(task) === taskKey}
      onOpen={() => onOpenTask(keyOf(task))}
    />
  );

  const listHeader = (
    <>
      <h1 className="text-sm font-medium text-foreground font-reading">Scheduled tasks</h1>
      {tasks.length > 0 ? (
        <span className="text-sm tabular-nums text-muted-foreground">{tasks.length}</span>
      ) : null}
      <span className="flex-1" />
      {tasks.length > 0 ? (
        <TaskFilterMenu tasks={tasks} value={filter} onChange={setFilter} />
      ) : null}
      {creatable ? (
        <Button size="sm" onClick={() => setEditing("new")}>
          <PlusIcon />
          New task
        </Button>
      ) : null}
    </>
  );

  const empty = scheduledEmpty(query, agents, shown);
  const list = (
    <div className="flex flex-col gap-4 px-2 pt-2 pb-16">
      {agents
        .filter((a) => a.error || a.readOnly)
        .map((a) => (
          <AgentProblem
            key={a.provider}
            name={agentName(a.provider)}
            provider={a.provider}
            message={a.error ?? a.readOnly!}
            onRetry={a.error ? () => void query.refetch() : undefined}
          />
        ))}
      {empty === "loading" ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : empty === "error" ? (
        <AgentProblem
          name="Agents"
          message={readableError(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : empty === "no-agents" ? (
        <Empty
          title="No agent here runs tasks on a schedule"
          body="Connect OpenClaw, Hermes or varys in Settings, and the tasks they run on their own show up here."
        />
      ) : empty === "nothing" ? (
        <Empty
          title="Nothing scheduled yet"
          body="Ask an agent to do something every morning, or make a task here."
          action={
            creatable ? (
              <Button size="sm" onClick={() => setEditing("new")}>
                <PlusIcon />
                New task
              </Button>
            ) : null
          }
        />
      ) : empty === "no-match" ? (
        <Empty
          title="No tasks match"
          body="Nothing scheduled fits this filter."
          action={
            <Button size="sm" onClick={() => setFilter(NO_FILTER)}>
              Show all
            </Button>
          }
        />
      ) : (
        <>
          {attention.length > 0 ? (
            <Section title="Needs attention" count={attention.length}>
              {attention.map(row)}
            </Section>
          ) : null}
          {active.length > 0 ? (
            <Section title="Active" count={active.length}>
              {active.map(row)}
            </Section>
          ) : null}
          {paused.length > 0 ? (
            <Section title="Paused" count={paused.length}>
              {paused.map(row)}
            </Section>
          ) : null}
        </>
      )}
    </div>
  );

  const page = current ? (
    <TaskPage
      key={taskKey}
      task={current}
      agent={agentOf(current)}
      now={now}
      onEdit={() => setEditing(current)}
      onDeleted={() => onOpenTask(null)}
      onSelectChat={onSelectChat}
    />
  ) : query.isLoading ? (
    <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
  ) : (
    <Empty
      title="This task is gone"
      body="It was deleted, or its agent can't be reached right now."
      action={
        <Button size="sm" onClick={() => onOpenTask(null)}>
          All scheduled tasks
        </Button>
      }
    />
  );

  const toolbar = "drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 px-4";
  return (
    <div ref={measure} className="flex min-h-0 min-w-0 flex-1">
      {split ? (
        <>
          <div className="flex w-[23rem] shrink-0 flex-col">
            <div data-toolbar="" className={toolbar}>
              {titleLeading}
              {listHeader}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto border-r border-(--panel-edge)">
              {list}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div data-toolbar="" className={toolbar}>
              <span className="flex-1" />
              {titleTrailing}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {taskKey ? (
                page
              ) : (
                <EmptyState
                  className="h-full"
                  icon={CalendarClockIcon}
                  title="Select a task"
                  description="Its schedule, history and results show here."
                />
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div data-toolbar="" className={toolbar}>
            {titleLeading}
            {taskKey ? (
              <>
                <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => onOpenTask(null)}
                    className="no-drag shrink-0 cursor-pointer rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    Scheduled tasks
                  </button>
                  <span aria-hidden className="text-faint-foreground">
                    /
                  </span>
                  <span aria-current="page" className="truncate font-medium text-foreground">
                    {current?.name}
                  </span>
                </nav>
                <span className="flex-1" />
              </>
            ) : (
              listHeader
            )}
            {titleTrailing}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {taskKey ? page : <div className="mx-auto w-full max-w-3xl">{list}</div>}
          </div>
        </div>
      )}
      {editing ? (
        <TaskEditor
          task={editing === "new" ? null : editing}
          agents={agents}
          onClose={() => setEditing(null)}
          onCreated={onOpenTask}
        />
      ) : null}
    </div>
  );
}

/** The list (23rem) and a task page beside it. */
const SPLIT_WIDTH = 880;

function TaskFilterMenu({
  tasks,
  value,
  onChange,
}: {
  tasks: ScheduledTask[];
  value: TaskFilter;
  onChange: (filter: TaskFilter) => void;
}) {
  const agentName = useAgentName();
  const filtering = isFiltering(value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<IconButton label="Filter tasks" active={filtering} />}>
        <ListFilterIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Agent</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={value.agent === null}
          onCheckedChange={() => onChange({ ...value, agent: null })}
        >
          All agents
        </DropdownMenuCheckboxItem>
        {taskAgents(tasks).map(([key, { task, count }]) => (
          <DropdownMenuCheckboxItem
            key={key}
            checked={value.agent === key}
            onCheckedChange={() => onChange({ ...value, agent: key })}
          >
            <span className="flex min-w-0 items-center gap-2">
              <AgentAvatar id={task.provider} agent={task.agent} className="size-4" />
              <span className="min-w-0 flex-1 truncate">
                {agentName(task.provider, task.agent)}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
            </span>
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Status</DropdownMenuLabel>
        {TASK_STATUSES.map((status) => (
          <DropdownMenuCheckboxItem
            key={status.value}
            checked={value.status === status.value}
            onCheckedChange={() => onChange({ ...value, status: status.value })}
          >
            {status.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <CalendarClockIcon aria-hidden className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}

function AgentProblem({
  name,
  provider,
  message,
  onRetry,
}: {
  name: string;
  provider?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-border/70 bg-surface-raised/50 px-3.5 py-3"
    >
      {provider ? (
        <AgentAvatar id={provider} className="mt-0.5 size-4" />
      ) : (
        <CircleAlertIcon aria-hidden className="mt-0.5 size-4 text-warning-foreground" />
      )}
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-medium text-foreground">{name}</span>{" "}
        <span className="text-muted-foreground">{message}</span>
      </div>
      {onRetry ? (
        <Button size="xs" variant="ghost" onClick={onRetry}>
          <RotateCwIcon />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <h2 className="flex h-8 items-center gap-2 px-3 text-xs font-medium text-muted-foreground">
        <span>{title}</span>
        <span className="font-normal tabular-nums">{count}</span>
      </h2>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

/** A task as the mail list shows a message: who runs it and when it's next, then how it repeats. */
function TaskRow({
  task,
  now,
  selected,
  onOpen,
}: {
  task: ScheduledTask;
  now: number;
  selected: boolean;
  onOpen: () => void;
}) {
  const agentName = useAgentName();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!selected || !ref.current) return;
    ref.current.scrollIntoView({ block: "nearest" });
    // Arrowed to from another row: focus follows, so Enter opens this one.
    if (
      document.activeElement instanceof HTMLElement &&
      "taskRow" in document.activeElement.dataset
    )
      ref.current.focus({ preventScroll: true });
  }, [selected]);
  const next = taskWhen(task, now);
  const problem = taskProblem(task);
  const when =
    next?.kind === "running" ? (
      <span className="flex items-center gap-1.5 text-info-foreground">
        <Spinner aria-hidden className="size-3 text-current" />
        {next.text}
      </span>
    ) : next?.kind === "auto-paused" || next?.kind === "failed" ? (
      <span className="text-warning-foreground">{next.text}</span>
    ) : (
      next?.text
    );
  return (
    <button
      ref={ref}
      type="button"
      data-task-row=""
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring",
        selected ? "bg-sidebar-row-active" : "hover:bg-sidebar-row-hover",
      )}
    >
      <span className="flex min-w-0 items-center gap-2 text-body">
        <AgentAvatar id={task.provider} agent={task.agent} className="size-4 shrink-0" />
        <span
          className={cn(
            "min-w-0 truncate font-medium",
            task.enabled ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {task.name}
        </span>
        {problem ? (
          <CircleAlertIcon
            aria-label={problem}
            className="size-3.5 shrink-0 text-warning-foreground"
          />
        ) : null}
        {task.managedBy ? (
          <LockIcon
            aria-label={managedNote(task.managedBy)}
            className="size-3 shrink-0 text-faint-foreground"
          />
        ) : null}
        <span className="ms-auto shrink-0 ps-2 text-xs tabular-nums text-muted-foreground">
          {when}
        </span>
      </span>
      <span className="truncate ps-6 text-xs text-muted-foreground">
        {scheduleText(task.schedule)} · {agentName(task.provider, task.agent)}
      </span>
    </button>
  );
}

function TaskMenu({ task, onDeleted }: { task: ScheduledTask; onDeleted: () => void }) {
  const action = useTaskAction();
  const [confirming, setConfirming] = useState(false);
  if (task.managedBy) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<IconButton label={`More for ${task.name}`} className="shrink-0" />}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            icon={<Trash2Icon className="size-4" />}
            onClick={() => setConfirming(true)}
          >
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete “${task.name}”?`}
        description="It stops running, and its agent forgets it. What it already sent stays where it went."
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={async () => {
          await action.mutateAsync(deleteTask(task));
          onDeleted();
        }}
      />
    </>
  );
}

/** Text that can run long (an agent's instructions): its first lines, and the rest on request. */
function LongText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [open]);
  return (
    <>
      <span
        ref={ref}
        className={cn(
          "whitespace-pre-wrap [overflow-wrap:anywhere]",
          open ? "block" : "line-clamp-8",
        )}
      >
        {text}
      </span>
      {long || open ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="mt-1 cursor-pointer rounded-sm text-xs font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {open ? "Show less" : "Show all"}
        </button>
      ) : null}
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-border/60 pb-5 last:border-b-0">
      <dt className="text-sm font-medium text-foreground">{label}</dt>
      <dd className="text-sm text-muted-foreground">{children}</dd>
    </div>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <p className="mt-5 flex items-start gap-2 rounded-lg bg-warning/8 px-3 py-2 text-sm text-warning-foreground">
      <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function TaskPage({
  task,
  agent,
  now,
  onEdit,
  onDeleted,
  onSelectChat,
}: {
  task: ScheduledTask;
  agent: AgentScheduledTasks;
  now: number;
  onEdit: () => void;
  onDeleted: () => void;
  onSelectChat: (chatId: string) => void;
}) {
  const agentName = useAgentName();
  const action = useTaskAction();
  const models = useTaskModels(task.provider, task.agent ?? "", Boolean(task.model));
  const conversations = useChats((s) => s.conversations);
  const results = taskResults(conversations, task);
  const editable = taskEditable(task, agent);
  const when = taskNext(task, now);
  const callout = taskCallout(task, now);
  return (
    <div className="@container mx-auto flex w-full max-w-5xl flex-col px-8 pt-6 pb-20">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground font-reading">
            {task.name}
          </h1>
          {when ? (
            <p className="flex items-center gap-1.5 pt-1.5 text-sm text-muted-foreground">
              {task.running ? <Spinner aria-hidden className="size-3.5 text-info" /> : null}
              {when}
            </p>
          ) : null}
          {task.description && task.prompt ? (
            <p className="pt-1 text-sm text-muted-foreground">{task.description}</p>
          ) : null}
          {agent.readOnly ? null : task.managedBy ? (
            <p className="flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
              <LockIcon aria-hidden className="size-3.5 shrink-0" />
              {task.managedBy} keeps this one: run or pause it here, and change it there.
            </p>
          ) : task.schedule.kind === "other" ? (
            <p className="flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
              <LockIcon aria-hidden className="size-3.5 shrink-0" />
              Otter can't change this kind of schedule: change it in {agentName(task.provider)}.
            </p>
          ) : null}
        </div>
        {agent.readOnly ? null : (
          <div className="flex shrink-0 items-center gap-3 pt-1">
            <Button
              size="sm"
              disabled={action.isPending || task.running}
              onClick={() => action.mutate(runTaskNow(task))}
            >
              <PlayIcon />
              Run now
            </Button>
            {editable ? (
              <Button size="sm" onClick={onEdit}>
                <PencilIcon />
                Edit
              </Button>
            ) : null}
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              {task.enabled ? "Active" : "Paused"}
              <Switch
                checked={task.enabled}
                disabled={action.isPending}
                onCheckedChange={(enabled) => action.mutate(enableTask(task, enabled))}
              />
            </label>
            <TaskMenu task={task} onDeleted={onDeleted} />
          </div>
        )}
      </div>
      {callout ? <Callout>{callout}</Callout> : null}
      <div className="mt-6 grid gap-10 border-t border-border/60 pt-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="flex min-w-0 flex-col gap-8">
          {agent.can.history ? (
            <RunHistory task={task} agent={agent} now={now} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {agentName(task.provider)} doesn't keep a history of runs Otter can show.
            </p>
          )}
          {results.length > 0 ? (
            <div className="flex flex-col gap-1">
              <h2 className="pb-1 text-sm font-medium text-foreground">Results in Otter</h2>
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectChat(c.id)}
                  className="-mx-2 flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  <MessageSquareIcon
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {agoText(c.updatedAt, now)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <dl className="flex min-w-0 flex-col gap-5">
          {task.prompt ? (
            <Detail label="Instructions">
              <LongText key={task.prompt} text={task.prompt} />
            </Detail>
          ) : task.runs ? (
            <Detail label="What it runs">
              <span className="block font-mono text-xs break-all">{task.runs}</span>
            </Detail>
          ) : task.description ? (
            <Detail label="What it does">{task.description}</Detail>
          ) : null}
          <Detail label="Repeats">
            {scheduleText(task.schedule)}
            {task.conditional ? (
              <span className="block pt-0.5 text-xs">Only when its own check says so</span>
            ) : null}
          </Detail>
          <Detail label="Agent">
            <span className="flex items-center gap-2">
              <AgentAvatar id={task.provider} agent={task.agent} className="size-4" />
              {agentName(task.provider, task.agent)}
            </span>
          </Detail>
          {task.model ? <Detail label="Model">{modelName(models.data, task.model)}</Detail> : null}
          <Detail label="Results">
            {deliveryText(task.delivery)}
            {task.deliveryProblem ? (
              <span className="flex items-start gap-1.5 pt-1 text-xs text-warning-foreground">
                <CircleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
                {task.deliveryProblem}
              </span>
            ) : null}
          </Detail>
          {task.failureAlerts ? (
            <Detail label="Failures reported to">{task.failureAlerts}</Detail>
          ) : null}
        </dl>
      </div>
    </div>
  );
}

function RunHistory({
  task,
  agent,
  now,
}: {
  task: ScheduledTask;
  agent: AgentScheduledTasks;
  now: number;
}) {
  const runs = useTaskRuns(task);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <h2 className="pb-1 text-sm font-medium text-foreground">History</h2>
      {runs.isLoading ? (
        <p className="py-2 text-sm text-muted-foreground">Loading…</p>
      ) : runs.isError ? (
        <p className="flex items-center gap-2 py-2 text-sm text-destructive-foreground">
          {readableError(runs.error)}
          <Button size="xs" variant="ghost" onClick={() => void runs.refetch()}>
            Retry
          </Button>
        </p>
      ) : !runs.data?.length ? (
        <p className="py-2 text-sm text-muted-foreground">It hasn't run yet.</p>
      ) : (
        runs.data.map((run) => (
          <RunRow
            key={run.id}
            task={task}
            agent={agent}
            run={run}
            now={now}
            open={open === run.id}
            onToggle={() => setOpen(open === run.id ? null : run.id)}
          />
        ))
      )}
    </div>
  );
}

function RunRow({
  task,
  agent,
  run,
  now,
  open,
  onToggle,
}: {
  task: ScheduledTask;
  agent: AgentScheduledTasks;
  run: TaskRun;
  now: number;
  open: boolean;
  onToggle: () => void;
}) {
  const failed = run.status === "error";
  const Icon = failed
    ? CircleAlertIcon
    : run.status === "skipped"
      ? CircleMinusIcon
      : CircleCheckIcon;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="-mx-2 flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <Icon
          aria-label={runStatusLabel(run)}
          className={cn(
            "size-3.5 shrink-0",
            failed ? "text-destructive-foreground" : "text-muted-foreground",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-foreground" title={agoText(run.at, now)}>
          {runWhen(run, now)}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{runMeta(run)}</span>
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open ? <RunTranscript task={task} agent={agent} run={run} /> : null}
    </div>
  );
}

function RunTranscript({
  task,
  agent,
  run,
}: {
  task: ScheduledTask;
  agent: AgentScheduledTasks;
  run: TaskRun;
}) {
  const delivery = runDelivery(run, agent);
  const { transcript, text } = useRunTranscript(task, run);
  return (
    <div className="ms-7 me-2 mb-2 flex flex-col gap-2 border-s border-border/70 ps-3 pt-1 text-sm">
      {run.error ? <p className="text-destructive-foreground">{run.error}</p> : null}
      {delivery ? (
        <p
          className={cn(
            "text-xs",
            delivery.tone === "warning" ? "text-warning-foreground" : "text-muted-foreground",
          )}
        >
          {delivery.text}
        </p>
      ) : null}
      {transcript.isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : transcript.isError ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          Couldn't load what it wrote: {readableError(transcript.error)}
          <Button size="xs" variant="ghost" onClick={() => void transcript.refetch()}>
            Retry
          </Button>
        </p>
      ) : text ? (
        <ChatMarkdown text={text} />
      ) : run.summary ? (
        <ChatMarkdown text={run.summary} />
      ) : run.error ? null : (
        <p className="text-muted-foreground">It had nothing to say.</p>
      )}
    </div>
  );
}

function ResultsField({
  task,
  agent,
  agentId,
  value,
  onChange,
}: {
  task: ScheduledTask | null;
  agent: AgentScheduledTasks;
  agentId: string;
  value: Destination;
  onChange: (dest: Destination) => void;
}) {
  const channel = destinationChannel(agent, value);
  const account = destinationAccount(value, channel);
  const suggestions = useDeliveryTargets(agent, agentId, channel, account);
  const set = (patch: Partial<Destination>) => onChange({ ...value, ...patch });
  const listId = `targets-${agent.provider}-${channel?.id ?? ""}`;
  return (
    <Field label="Send results to" description={resultsDescription(value, channel)}>
      <div className="flex flex-wrap items-center gap-2">
        <SelectField
          label="Send results to"
          value={value.pick}
          onChange={(pick) => onChange(pickDestination(value, pick, task, agent))}
          options={resultsOptions(task, agent)}
        />
        {channel && channel.accounts.length > 1 ? (
          <SelectField
            label="Account"
            value={account ?? ""}
            onChange={(account) => set({ account })}
            options={channel.accounts.map((a) => ({ value: a, label: `as ${a}` }))}
          />
        ) : null}
      </div>
      {channel ? (
        <>
          <Input
            aria-label={`Who on ${channel.label}`}
            value={value.to}
            list={listId}
            placeholder={targetHint(channel.id)}
            onChange={(e) => set({ to: e.target.value })}
            className="font-mono"
          />
          <datalist id={listId}>
            {suggestions.map((t) => (
              <option key={`${t.accountId}|${t.target}`} value={t.target}>
                {t.label}
              </option>
            ))}
          </datalist>
        </>
      ) : null}
      {value.pick === "webhook" ? (
        <Input
          aria-label="Webhook address"
          value={value.url}
          placeholder="https://example.com/hooks/otter"
          onChange={(e) => set({ url: e.target.value })}
          className="font-mono"
        />
      ) : null}
    </Field>
  );
}

function SelectField({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TaskEditor({
  task,
  agents,
  onClose,
  onCreated,
}: {
  task: ScheduledTask | null;
  agents: AgentScheduledTasks[];
  onClose: () => void;
  onCreated: (key: string) => void;
}) {
  const providers = useAgentProviders().data?.providers ?? [];
  const editor = useTaskEditor({
    task,
    agents,
    providers,
    subAgents: (kind) => Boolean(agentContribution(kind)?.subAgents),
    onCreated,
  });
  const { when, setWhen: set } = editor;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="large"
      title={task ? "Edit task" : "New scheduled task"}
      description={
        task ? undefined : "The agent runs it on its own, on time, whether or not Otter is open."
      }
      confirmLabel={editor.busy ? "Saving…" : task ? "Save" : "Schedule"}
      confirmDisabled={editor.busy || !editor.owner}
      onConfirm={editor.save}
    >
      <div className="flex flex-col gap-4">
        {task ? null : (
          <Field label="Agent">
            <SelectField
              label="Agent"
              value={editor.owner}
              onChange={editor.setOwner}
              options={editor.owners}
            />
          </Field>
        )}
        <Field label="Name">
          <Input
            value={editor.name}
            maxLength={200}
            placeholder="Morning brief"
            onChange={(e) => editor.setName(e.target.value)}
          />
        </Field>
        {editor.asksPrompt ? (
          <Field label="What should it do?">
            <Textarea
              value={editor.prompt}
              rows={4}
              maxLength={5000}
              placeholder="Summarise what came in overnight and what's on my calendar today."
              onChange={(e) => editor.setPrompt(e.target.value)}
              className="max-h-64 min-h-24"
            />
          </Field>
        ) : null}
        {editor.picksModel ? (
          <Field label="Model">
            <SelectField
              label="Model"
              value={editor.modelValue}
              onChange={editor.setModel}
              options={editor.modelOptions}
            />
          </Field>
        ) : null}
        <Field label="When">
          <div className="flex flex-wrap items-center gap-2">
            <SelectField
              label="Repeat"
              value={when.repeat}
              onChange={(value) => set({ repeat: value as Repeat })}
              options={REPEATS}
            />
            {when.repeat === "weekly" ? (
              <SelectField
                label="Day"
                value={String(when.weekday)}
                onChange={(value) => set({ weekday: Number(value) })}
                options={WEEKDAY_OPTIONS}
              />
            ) : null}
            {when.repeat === "monthly" ? (
              <SelectField
                label="Day of the month"
                value={String(when.monthDay)}
                onChange={(value) => set({ monthDay: Number(value) })}
                options={MONTH_DAY_OPTIONS}
              />
            ) : null}
            {TIMED.has(when.repeat) ? (
              <Input
                type="time"
                aria-label="Time"
                value={when.time}
                onChange={(e) => set({ time: e.target.value })}
                className="w-32"
              />
            ) : null}
            {when.repeat === "interval" ? (
              <>
                <Input
                  type="number"
                  aria-label="How often"
                  min={1}
                  value={when.every}
                  onChange={(e) => set({ every: Math.round(Number(e.target.value)) })}
                  className="w-20"
                />
                <SelectField
                  label="Unit"
                  value={when.unit}
                  onChange={(value) => set({ unit: value as WhenForm["unit"] })}
                  options={UNIT_OPTIONS}
                />
              </>
            ) : null}
            {when.repeat === "once" ? (
              <Input
                type="datetime-local"
                aria-label="Date and time"
                value={when.once}
                onChange={(e) => set({ once: e.target.value })}
                className="w-56"
              />
            ) : null}
            {when.repeat === "cron" ? (
              <Input
                font="mono"
                aria-label="Cron expression"
                value={when.cron}
                placeholder="0 9 * * 1-5"
                onChange={(e) => set({ cron: e.target.value })}
                className="w-44"
              />
            ) : null}
            {editor.zoned ? (
              <SelectField
                label="Time zone"
                value={editor.zoneValue}
                onChange={editor.setZone}
                className="max-w-52 min-w-0"
                options={editor.zoneOptions}
              />
            ) : null}
          </div>
          {editor.summary ? (
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {editor.summary}
            </p>
          ) : null}
        </Field>
        {editor.agentTasks && editor.routes ? (
          <ResultsField
            task={task}
            agent={editor.agentTasks}
            agentId={editor.agentId}
            value={editor.destination}
            onChange={editor.setDestination}
          />
        ) : null}
        {editor.needsDeliveries ? (
          <p className="text-xs text-muted-foreground">
            To get results in Otter, set up Messages from your agents in {editor.ownerName}'s
            settings.
          </p>
        ) : null}
        {editor.error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {editor.error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
