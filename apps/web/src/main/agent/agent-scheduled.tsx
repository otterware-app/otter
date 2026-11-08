import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClockIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleMinusIcon,
  EllipsisIcon,
  ListFilterIcon,
  LoaderCircleIcon,
  LockIcon,
  MessageSquareIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RotateCwIcon,
  Trash2Icon,
} from "lucide-react";
import type {
  AgentScheduledTasks,
  ResultsTo,
  ScheduledTask,
  TaskDelivery,
  TaskRun,
} from "@otter/contracts/scheduled";
import { Dialog } from "~/components/ui/dialog";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { mailApi, type ProviderSnapshot } from "../mail/api";
import { AgentAvatar, useAgentProviders } from "./agent-providers";
import { readableError } from "../mail/add-mailbox";
import { ChatMarkdown } from "./chat-markdown";
import { useNow } from "./chat-shelves";
import { useChats } from "./chat-store";
import { useLatest } from "../use-latest";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../mail/menu";
import {
  agoText,
  durationText,
  localTimeZone,
  newWhenForm,
  dayTimeText,
  scheduleOfForm,
  scheduleText,
  untilText,
  whenFormOf,
  whenProblem,
  type Repeat,
  type WhenForm,
} from "./scheduled-text";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../mail/select";
import { toast } from "../mail/toast";
import { Btn, IconBtn, cn } from "../mail/ui";

/** The Agents space's place for every agent's scheduled tasks: /agents/scheduled. */
export const SCHEDULED_TASKS = "scheduled";

const TASKS_KEY = ["agent-scheduled"] as const;
const IDLE_REFRESH_MS = 20_000;
const BUSY_REFRESH_MS = 3_000;

/** Every agent's tasks; `live` keeps them current while they're on screen, asking the agents again. */
export function useScheduledTasks(live = false) {
  return useQuery({
    queryKey: TASKS_KEY,
    queryFn: () => mailApi.scheduledTasks(),
    staleTime: live ? 5_000 : 5 * 60_000,
    refetchInterval: (query) =>
      !live
        ? false
        : query.state.data?.some((agent) => agent.tasks.some((t) => t.running))
          ? BUSY_REFRESH_MS
          : IDLE_REFRESH_MS,
  });
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const keyOf = (task: Pick<ScheduledTask, "provider" | "id">) =>
  `${task.provider}:${task.id}`;

function useAgentName() {
  const providers = useAgentProviders().data?.providers ?? [];
  return (provider: string, agent?: string) => {
    const snapshot = providers.find((p) => p.kind === provider);
    const model = agent ? snapshot?.models.find((m) => m.slug === agent) : undefined;
    return model?.name ?? snapshot?.displayName ?? provider;
  };
}

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host : url);

function deliveryText(delivery: TaskDelivery): string {
  if (delivery.kind === "otter")
    return delivery.chat === "new" ? "A new chat in Otter each time" : "Its chat in Otter";
  if (delivery.kind === "none") return "Kept on the agent: not sent anywhere";
  if (delivery.kind === "webhook") return `Posted to a webhook (${hostOf(delivery.url)})`;
  if (delivery.kind === "elsewhere") return `Sent to ${delivery.label}`;
  return [
    delivery.label,
    delivery.to,
    delivery.threadId ? `topic ${delivery.threadId}` : null,
    delivery.accountId && delivery.accountId !== "default" ? `as ${delivery.accountId}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function useTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ run }: TaskAction) => run(),
    onMutate: async ({ shows }) => {
      if (!shows) return undefined;
      await qc.cancelQueries({ queryKey: TASKS_KEY });
      const before = qc.getQueryData<AgentScheduledTasks[]>(TASKS_KEY);
      qc.setQueryData<AgentScheduledTasks[]>(TASKS_KEY, (agents) =>
        agents?.map((a) => ({
          ...a,
          tasks: a.tasks.map((t) => (keyOf(t) === shows.key ? { ...t, ...shows.patch } : t)),
        })),
      );
      return { before };
    },
    onError: (error, { failed }, context) => {
      if (context?.before) qc.setQueryData(TASKS_KEY, context.before);
      toast.error(failed, { description: readableError(error) });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

/** What to do, what to say if it fails, and how the task looks meanwhile. */
type TaskAction = {
  run: () => Promise<unknown>;
  failed: string;
  shows?: { key: string; patch: Partial<ScheduledTask> };
};

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
  const [showManaged, setShowManaged] = useState(false);
  const agentName = useAgentName();

  const tasks = agents.flatMap((a) => a.tasks);
  const [filter, setFilter] = useState<TaskFilter>(NO_FILTER);
  const shown = tasks.filter((t) => matches(t, filter));
  const agentOf = (task: ScheduledTask) => agents.find((a) => a.provider === task.provider)!;
  const current = taskKey ? (tasks.find((t) => keyOf(t) === taskKey) ?? null) : null;
  const creatable = agents.some((a) => a.can.create && !a.readOnly);

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

  const byNext = (a: ScheduledTask, b: ScheduledTask) =>
    (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name);
  const own = shown.filter((t) => !t.managedBy);
  const active = own.filter((t) => t.enabled).sort(byNext);
  const paused = own.filter((t) => !t.enabled).sort((a, b) => a.name.localeCompare(b.name));
  const managed = shown.filter((t) => t.managedBy).sort(byNext);
  const card = (task: ScheduledTask) => (
    <TaskCard key={keyOf(task)} task={task} now={now} onOpen={() => onOpenTask(keyOf(task))} />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        data-toolbar=""
        className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 px-4"
      >
        {titleLeading}
        {taskKey ? (
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => onOpenTask(null)}
              className="no-drag shrink-0 cursor-pointer rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Scheduled tasks
            </button>
            <span aria-hidden className="text-muted-foreground/60">
              /
            </span>
            <span aria-current="page" className="truncate font-medium text-foreground">
              {current?.name}
            </span>
          </nav>
        ) : null}
        <span className="flex-1" />
        {titleTrailing}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {taskKey ? (
          current ? (
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
                <Btn size="sm" onClick={() => onOpenTask(null)}>
                  All scheduled tasks
                </Btn>
              }
            />
          )
        ) : (
          <div className="mx-auto flex w-full max-w-[47rem] flex-col gap-8 px-6 pt-14 pb-20">
            <div className="flex items-center gap-3">
              <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight text-foreground">
                Scheduled tasks
              </h1>
              {tasks.length > 0 ? (
                <TaskFilterMenu tasks={tasks} value={filter} onChange={setFilter} />
              ) : null}
              {creatable ? (
                <Btn size="sm" onClick={() => setEditing("new")}>
                  <PlusIcon />
                  New task
                </Btn>
              ) : null}
            </div>
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
            {query.isLoading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : query.isError ? (
              <AgentProblem
                name="Agents"
                message={readableError(query.error)}
                onRetry={() => void query.refetch()}
              />
            ) : agents.length === 0 ? (
              <Empty
                title="No agent here runs tasks on a schedule"
                body="Connect OpenClaw or Hermes in Settings, and the tasks they run on their own show up here."
              />
            ) : tasks.length === 0 && agents.every((a) => !a.error) ? (
              <Empty
                title="Nothing scheduled yet"
                body="Ask an agent to do something every morning, or make a task here."
                action={
                  creatable ? (
                    <Btn size="sm" onClick={() => setEditing("new")}>
                      <PlusIcon />
                      New task
                    </Btn>
                  ) : null
                }
              />
            ) : shown.length === 0 ? (
              <Empty
                title="No tasks match"
                body="Nothing scheduled fits this filter."
                action={
                  <Btn size="sm" onClick={() => setFilter(NO_FILTER)}>
                    Show all
                  </Btn>
                }
              />
            ) : (
              <>
                {active.length > 0 ? (
                  <Section title="Active" count={active.length}>
                    {active.map(card)}
                  </Section>
                ) : null}
                {paused.length > 0 ? (
                  <Section title="Paused" count={paused.length}>
                    {paused.map(card)}
                  </Section>
                ) : null}
                {managed.length > 0 ? (
                  <Section
                    title="Kept by OpenClaw"
                    count={managed.length}
                    open={showManaged}
                    onToggle={() => setShowManaged((o) => !o)}
                  >
                    {managed.map(card)}
                  </Section>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
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

type TaskFilter = { agent: string | null; status: "all" | "active" | "paused" | "attention" };
const NO_FILTER: TaskFilter = { agent: null, status: "all" };
const agentKey = (task: ScheduledTask) => `${task.provider}|${task.agent ?? ""}`;
const needsAttention = (task: ScheduledTask) =>
  task.lastRun?.status === "error" || Boolean(task.autoPaused || task.deliveryProblem);

function matches(task: ScheduledTask, filter: TaskFilter): boolean {
  if (filter.agent && agentKey(task) !== filter.agent) return false;
  if (filter.status === "active") return task.enabled;
  if (filter.status === "paused") return !task.enabled;
  if (filter.status === "attention") return needsAttention(task);
  return true;
}

const STATUSES: { value: TaskFilter["status"]; label: string }[] = [
  { value: "all", label: "Any status" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "attention", label: "Needs attention" },
];

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
  const agents = new Map<string, { task: ScheduledTask; count: number }>();
  for (const task of tasks) {
    const seen = agents.get(agentKey(task));
    agents.set(agentKey(task), { task: seen?.task ?? task, count: (seen?.count ?? 0) + 1 });
  }
  const filtering = value.agent !== null || value.status !== "all";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconBtn label="Filter tasks" active={filtering}>
          <ListFilterIcon />
        </IconBtn>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Agent</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={value.agent === null}
          onCheckedChange={() => onChange({ ...value, agent: null })}
        >
          All agents
        </DropdownMenuCheckboxItem>
        {[...agents]
          .sort((a, b) => b[1].count - a[1].count)
          .map(([key, { task, count }]) => (
            <DropdownMenuCheckboxItem
              key={key}
              checked={value.agent === key}
              onCheckedChange={() => onChange({ ...value, agent: key })}
            >
              <span className="flex min-w-0 items-center gap-2">
                <AgentAvatar kind={task.provider} agent={task.agent} className="size-4" />
                <span className="min-w-0 flex-1 truncate">
                  {agentName(task.provider, task.agent)}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Status</DropdownMenuLabel>
        {STATUSES.map((status) => (
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
        <AgentAvatar kind={provider} className="mt-0.5 size-4" />
      ) : (
        <CircleAlertIcon aria-hidden className="mt-0.5 size-4 text-warning-foreground" />
      )}
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-medium text-foreground">{name}</span>{" "}
        <span className="text-muted-foreground">{message}</span>
      </div>
      {onRetry ? (
        <Btn size="xs" variant="ghost" onClick={onRetry}>
          <RotateCwIcon />
          Retry
        </Btn>
      ) : null}
    </div>
  );
}

function Section({
  title,
  count,
  open = true,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const heading = (
    <>
      <span>{title}</span>
      <span className="font-normal tabular-nums">{count}</span>
      {onToggle ? (
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
      ) : null}
    </>
  );
  return (
    <section className="flex flex-col gap-2">
      {onToggle ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex h-7 cursor-pointer items-center gap-2 self-start rounded-md text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {heading}
        </button>
      ) : (
        <h2 className="flex h-7 items-center gap-2 text-xs font-medium text-muted-foreground">
          {heading}
        </h2>
      )}
      {open ? <div className="flex flex-col gap-2">{children}</div> : null}
    </section>
  );
}

function statusText(task: ScheduledTask): string {
  if (task.running) return "Running";
  return task.enabled ? "Active" : "Paused";
}

function TaskCard({ task, now, onOpen }: { task: ScheduledTask; now: number; onOpen: () => void }) {
  const agentName = useAgentName();
  const failed = task.lastRun?.status === "error";
  const preview = task.prompt ?? task.description;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-xl border border-border/60 bg-surface-raised/40 px-4 py-3.5 text-left outline-none hover:border-border hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      <span className="flex min-w-0 items-center gap-2">
        <AgentAvatar kind={task.provider} agent={task.agent} className="size-4" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm font-medium",
            task.enabled ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {task.name}
        </span>
        {failed || task.autoPaused ? (
          <CircleAlertIcon
            aria-label={task.autoPaused ?? "The last run failed"}
            className="size-3.5 shrink-0 text-warning-foreground"
          />
        ) : null}
      </span>
      {preview ? (
        <span className="line-clamp-2 text-sm text-muted-foreground">{preview}</span>
      ) : null}
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {task.running ? (
          <LoaderCircleIcon aria-hidden className="size-3 shrink-0 animate-spin text-info" />
        ) : null}
        <span className="truncate">
          {[
            agentName(task.provider, task.agent),
            statusText(task),
            scheduleText(task.schedule),
            task.enabled && task.nextRunAt && !task.running ? untilText(task.nextRunAt, now) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
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
        <DropdownMenuTrigger asChild>
          <IconBtn label={`More for ${task.name}`} className="shrink-0">
            <EllipsisIcon />
          </IconBtn>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            color="red"
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
          await action.mutateAsync({
            run: () => mailApi.deleteScheduledTask(task.provider, task.id),
            failed: "Couldn't delete it",
          });
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
  const conversations = useChats((s) => s.conversations);
  const results = conversations
    .filter(
      (c) =>
        c.provider === task.provider &&
        c.turns.some(
          (t) =>
            t.delivered?.kind === "automation" &&
            (t.delivered.jobId ? t.delivered.jobId === task.id : t.delivered.name === task.name),
        ),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);
  const editable = !agent.readOnly && !task.managedBy && task.schedule.kind !== "other";
  const when = task.running
    ? "Running now"
    : task.enabled && task.nextRunAt
      ? `Next run: ${dayTimeText(task.nextRunAt, now)}`
      : null;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col px-6 pt-14 pb-20">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{task.name}</h1>
          {when ? (
            <p className="flex items-center gap-1.5 pt-1.5 text-sm text-muted-foreground">
              {task.running ? (
                <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin text-info" />
              ) : null}
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
            <Btn
              size="sm"
              disabled={action.isPending || task.running}
              onClick={() =>
                action.mutate(
                  {
                    run: () => mailApi.runScheduledTask(task.provider, task.id),
                    failed: "Couldn't start it",
                  },
                  { onSuccess: () => toast.success(`${task.name} is running`) },
                )
              }
            >
              <PlayIcon />
              Run now
            </Btn>
            {editable ? (
              <Btn size="sm" onClick={onEdit}>
                <PencilIcon />
                Edit
              </Btn>
            ) : null}
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              {task.enabled ? "Active" : "Paused"}
              <Switch
                checked={task.enabled}
                disabled={action.isPending}
                onCheckedChange={(enabled) =>
                  action.mutate({
                    run: () => mailApi.setScheduledTaskEnabled(task.provider, task.id, enabled),
                    failed: enabled ? "Couldn't resume it" : "Couldn't pause it",
                    shows: { key: keyOf(task), patch: { enabled } },
                  })
                }
              />
            </label>
            <TaskMenu task={task} onDeleted={onDeleted} />
          </div>
        )}
      </div>
      {task.autoPaused ? (
        <Callout>{task.autoPaused}. Resume it once what failed is fixed.</Callout>
      ) : task.lastRun?.status === "error" && !task.running ? (
        <Callout>
          The last run failed {agoText(task.lastRun.at, now)}
          {task.lastRun.error ? `: ${task.lastRun.error}` : "."}
        </Callout>
      ) : null}
      <div className="mt-6 grid gap-10 border-t border-border/60 pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
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
              <AgentAvatar kind={task.provider} agent={task.agent} className="size-4" />
              {agentName(task.provider, task.agent)}
            </span>
          </Detail>
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
  const runs = useQuery({
    queryKey: ["agent-scheduled-runs", task.provider, task.id, task.lastRun?.at ?? 0],
    queryFn: () => mailApi.scheduledTaskRuns(task.provider, task.id, 20),
    refetchInterval: task.running ? BUSY_REFRESH_MS : false,
  });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <h2 className="pb-1 text-sm font-medium text-foreground">History</h2>
      {runs.isLoading ? (
        <p className="py-2 text-sm text-muted-foreground">Loading…</p>
      ) : runs.isError ? (
        <p className="flex items-center gap-2 py-2 text-sm text-destructive-foreground">
          {readableError(runs.error)}
          <Btn size="xs" variant="ghost" onClick={() => void runs.refetch()}>
            Retry
          </Btn>
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
          aria-label={failed ? "Failed" : run.status === "skipped" ? "Skipped" : "Done"}
          className={cn(
            "size-3.5 shrink-0",
            failed ? "text-destructive-foreground" : "text-muted-foreground",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-foreground" title={agoText(run.at, now)}>
          {capitalized(dayTimeText(run.at, now))}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {[run.durationMs !== undefined ? durationText(run.durationMs) : null, run.model]
            .filter(Boolean)
            .join(" · ")}
        </span>
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
  const sentTo = run.sentTo
    ? [
        run.sentTo.channel === "otter"
          ? "Otter"
          : (agent.channels.find((c) => c.id === run.sentTo!.channel)?.label ?? run.sentTo.channel),
        run.sentTo.channel === "otter"
          ? null
          : run.sentTo.to && /^https?:\/\//i.test(run.sentTo.to)
            ? hostOf(run.sentTo.to)
            : run.sentTo.to,
      ]
        .filter(Boolean)
        .join(" ")
    : null;
  const transcript = useQuery({
    queryKey: ["agent-scheduled-run", task.provider, task.id, run.id],
    queryFn: () => mailApi.scheduledRunTranscript(task.provider, task.id, run.id),
    staleTime: Infinity,
  });
  const replies = (transcript.data ?? []).filter((m) => m.role === "assistant" && m.text.trim());
  return (
    <div className="ms-7 me-2 mb-2 flex flex-col gap-2 border-s border-border/70 ps-3 pt-1 text-sm">
      {run.error ? <p className="text-destructive-foreground">{run.error}</p> : null}
      {run.silent ? (
        <p className="text-xs text-muted-foreground">It chose to send nothing this time.</p>
      ) : run.deliveryError ? (
        <p className="text-xs text-warning-foreground">
          Couldn't send it{sentTo ? ` to ${sentTo}` : ""}: {run.deliveryError}
        </p>
      ) : run.delivered === false ? (
        <p className="text-xs text-muted-foreground">Its result wasn't delivered.</p>
      ) : sentTo && run.delivered ? (
        <p className="text-xs text-muted-foreground">Sent to {sentTo}.</p>
      ) : null}
      {transcript.isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : transcript.isError ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          Couldn't load what it wrote: {readableError(transcript.error)}
          <Btn size="xs" variant="ghost" onClick={() => void transcript.refetch()}>
            Retry
          </Btn>
        </p>
      ) : replies.length > 0 ? (
        <ChatMarkdown text={replies.map((m) => m.text).join("\n\n")} />
      ) : run.summary ? (
        <ChatMarkdown text={run.summary} />
      ) : run.error ? null : (
        <p className="text-muted-foreground">It had nothing to say.</p>
      )}
    </div>
  );
}

const REPEATS: { value: Repeat; label: string }[] = [
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "interval", label: "Every few minutes or hours" },
  { value: "once", label: "Once" },
  { value: "cron", label: "Custom (cron)" },
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/**
 * Where results go, as the editor holds it: `pick` is "keep" (as they go now: this chat, the last
 * conversation), "new-chat", "off", "webhook", or "channel:<id>".
 */
type Destination = { pick: string; to: string; account: string; url: string };

/** How a channel names who gets a message, as a hint for the recipient field. */
const TARGET_HINTS: Record<string, string> = {
  slack: "channel:C0123ABC or user:U0123ABC",
  discord: "channel:<id> or user:<id>",
  telegram: "@username or chat id",
  whatsapp: "+15551234567",
  signal: "+15551234567 or group:<id>",
  imessage: "chat_id:123 or +15551234567",
  matrix: "room:!id:server or user:@you:server",
  msteams: "user:<id> or conversation:<id>",
};

function destinationOf(task: ScheduledTask | null, agent?: AgentScheduledTasks): Destination {
  const none = { to: "", account: "", url: "" };
  if (!task) return { ...none, pick: agent?.can.deliverToOtter ? "new-chat" : "off" };
  const d = task.delivery;
  // A chat it can't post to (or Otter's, gone from the gateway) stays as it is: "keep".
  const chats = !task.undeliverable;
  if (d.kind === "none") return { ...none, pick: "off" };
  if (d.kind === "otter" && d.chat === "new" && chats && agent?.can.deliverToOtter)
    return { ...none, pick: "new-chat" };
  if (d.kind === "webhook" && agent?.can.webhooks) return { ...none, pick: "webhook", url: d.url };
  // A channel left to resolve its own recipient keeps going there until you name one.
  if (d.kind === "channel" && d.to && chats && agent?.channels.some((c) => c.id === d.channel))
    return { ...none, pick: `channel:${d.channel}`, to: d.to, account: d.accountId ?? "" };
  return { ...none, pick: "keep" };
}

/** What to save for where results go; a problem to show instead when it isn't complete. */
function resultsToOf(dest: Destination): ResultsTo | undefined | { problem: string } {
  if (dest.pick === "keep") return undefined;
  if (dest.pick === "new-chat" || dest.pick === "off") return { kind: dest.pick };
  if (dest.pick === "webhook")
    return /^https?:\/\/\S+$/i.test(dest.url.trim())
      ? { kind: "webhook", url: dest.url.trim() }
      : { problem: "A webhook needs an http(s) address." };
  const channel = dest.pick.slice("channel:".length);
  if (!dest.to.trim()) return { problem: "Say who on it gets the results." };
  return {
    kind: "channel",
    channel,
    to: dest.to.trim(),
    ...(dest.account ? { accountId: dest.account } : {}),
  };
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
  const chats = !task?.undeliverable;
  const channel = value.pick.startsWith("channel:")
    ? agent.channels.find((c) => `channel:${c.id}` === value.pick)
    : undefined;
  const targets = useQuery({
    queryKey: ["agent-scheduled-targets", agent.provider, agentId, channel?.id],
    queryFn: () => mailApi.scheduledTargets(agent.provider, agentId, channel!.id),
    enabled: Boolean(channel),
    staleTime: 60_000,
  });
  const d = task?.delivery;
  const keep = !d ? null : d.kind === "otter" && d.chat === "one" ? "This chat" : deliveryText(d);
  const options = [
    ...(keep && destinationOf(task, agent).pick === "keep" ? [{ value: "keep", label: keep }] : []),
    ...(chats && agent.can.deliverToOtter
      ? [{ value: "new-chat", label: "A new chat in Otter each time" }]
      : []),
    ...(chats ? agent.channels.map((c) => ({ value: `channel:${c.id}`, label: c.label })) : []),
    ...(agent.can.webhooks ? [{ value: "webhook", label: "A webhook" }] : []),
    { value: "off", label: "Off" },
  ];
  const set = (patch: Partial<Destination>) => onChange({ ...value, ...patch });
  const account = value.account || channel?.defaultAccount || channel?.accounts[0];
  const suggestions = (targets.data ?? []).filter(
    (t) => !account || !t.accountId || t.accountId === account,
  );
  const listId = `targets-${agent.provider}-${channel?.id ?? ""}`;
  return (
    <Field
      label="Send results to"
      description={
        value.pick === "off"
          ? "Results stay on the agent."
          : value.pick === "webhook"
            ? "Each finished run is posted there."
            : value.pick === "new-chat"
              ? "Each run's result arrives as a new chat in Otter, and notifies you."
              : channel
                ? `The agent posts each result on ${channel.label}.`
                : "Results keep going where they go now."
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <SelectField
          label="Send results to"
          value={value.pick}
          onChange={(pick) => {
            const next = agent.channels.find((c) => `channel:${c.id}` === pick);
            const same = d?.kind === "channel" && `channel:${d.channel}` === pick;
            onChange({
              ...value,
              pick,
              to: same ? (d.to ?? "") : "",
              account:
                same && d.accountId
                  ? d.accountId
                  : next && next.accounts.length > 1
                    ? (next.defaultAccount ?? next.accounts[0])
                    : "",
            });
          }}
          options={options}
        />
        {channel && channel.accounts.length > 1 ? (
          <SelectField
            label="Account"
            value={value.account || channel.defaultAccount || channel.accounts[0]}
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
            placeholder={TARGET_HINTS[channel.id] ?? "A chat, user or phone number"}
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

/** The select's value for a schedule with no zone of its own: the agent's. */
const AGENT_ZONE = "agent";
const TIMED = new Set<Repeat>(["daily", "weekdays", "weekly", "monthly"]);

type Owner = { provider: string; agent?: string; label: string };

function owners(agents: AgentScheduledTasks[], providers: ProviderSnapshot[]): Owner[] {
  return agents
    .filter((a) => a.can.create && !a.readOnly)
    .flatMap((a) => {
      const snapshot = providers.find((p) => p.kind === a.provider);
      const name = snapshot?.displayName ?? a.provider;
      if (a.provider !== "openclaw" || !snapshot?.models.length)
        return [{ provider: a.provider, label: name }];
      return snapshot.models.map((m) => ({
        provider: a.provider,
        agent: m.slug,
        label: snapshot.models.length > 1 ? `${m.name} · ${name}` : m.name,
      }));
    });
}

const ownerKey = (o: { provider: string; agent?: string }) => `${o.provider}|${o.agent ?? ""}`;

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
    <Select value={value} onValueChange={onChange}>
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
  const qc = useQueryClient();
  const providers = useAgentProviders().data?.providers ?? [];
  const choices = owners(agents, providers);
  const [owner, setOwner] = useState(() =>
    task ? ownerKey(task) : choices[0] ? ownerKey(choices[0]) : "",
  );
  const provider = task?.provider ?? owner.split("|")[0];
  const agentTasks = agents.find((a) => a.provider === provider);
  const can = agentTasks?.can;
  const [name, setName] = useState(task?.name ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [when, setWhen] = useState<WhenForm>(
    () => (task && whenFormOf(task.schedule)) || newWhenForm(),
  );
  const [destination, setDestination] = useState(() => destinationOf(task, agentTasks));
  const routes = Boolean(can?.deliverToOtter || can?.webhooks || agentTasks?.channels.length);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const zones = Intl.supportedValuesOf?.("timeZone") ?? [localTimeZone()];
  const [whenChanged, setWhenChanged] = useState(false);
  const set = (patch: Partial<WhenForm>) => {
    setError(null);
    setWhenChanged(true);
    setWhen((w) => ({ ...w, ...patch }));
  };
  const asksPrompt = !task || task.prompt !== undefined;
  const zoned = Boolean(can?.timeZones) && (TIMED.has(when.repeat) || when.repeat === "cron");
  // An untouched "when" goes back exactly as it was, whatever the fields can't show.
  const kept = task && !whenChanged && task.schedule.kind !== "other" ? task.schedule : null;
  const schedule = () => kept ?? scheduleOfForm(zoned ? when : { ...when, tz: "" });
  const summary = kept ? scheduleText(kept) : whenProblem(when) ? null : scheduleText(schedule());

  const save = async () => {
    const results = routes ? resultsToOf(destination) : undefined;
    const problem =
      (!name.trim() && "Give it a name.") ||
      (asksPrompt && !prompt.trim() && "Say what the agent should do.") ||
      (kept ? null : whenProblem(when)) ||
      (results && "problem" in results ? results.problem : null);
    if (problem) {
      setError(problem);
      throw new Error(problem);
    }
    setBusy(true);
    setError(null);
    try {
      const agent = owner.split("|")[1] || undefined;
      const saved = await mailApi.saveScheduledTask(provider, task?.id ?? null, {
        name: name.trim(),
        ...(asksPrompt ? { prompt: prompt.trim() } : {}),
        schedule: schedule(),
        ...(!task && agent ? { agent } : {}),
        ...(results && !("problem" in results) ? { resultsTo: results } : {}),
        ...(task?.revision ? { revision: task.revision } : {}),
      });
      await qc.invalidateQueries({ queryKey: TASKS_KEY });
      toast.success(task ? "Saved" : `${name.trim()} is scheduled`);
      if (!task && saved.id) onCreated(keyOf({ provider, id: saved.id }));
    } catch (err) {
      setError(readableError(err));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="large"
      title={task ? "Edit task" : "New scheduled task"}
      description={
        task ? undefined : "The agent runs it on its own, on time, whether or not Otter is open."
      }
      confirmLabel={busy ? "Saving…" : task ? "Save" : "Schedule"}
      confirmDisabled={busy || !owner}
      onConfirm={save}
    >
      <div className="flex flex-col gap-4">
        {task ? null : (
          <Field label="Agent">
            <SelectField
              label="Agent"
              value={owner}
              onChange={(value) => {
                setOwner(value);
                setDestination(
                  destinationOf(
                    null,
                    agents.find((a) => a.provider === value.split("|")[0]),
                  ),
                );
              }}
              options={choices.map((o) => ({ value: ownerKey(o), label: o.label }))}
            />
          </Field>
        )}
        <Field label="Name">
          <Input
            value={name}
            maxLength={200}
            placeholder="Morning brief"
            onChange={(e) => {
              setError(null);
              setName(e.target.value);
            }}
          />
        </Field>
        {asksPrompt ? (
          <Field label="What should it do?">
            <textarea
              value={prompt}
              rows={4}
              maxLength={5000}
              placeholder="Summarise what came in overnight and what's on my calendar today."
              onChange={(e) => {
                setError(null);
                setPrompt(e.target.value);
              }}
              className="min-h-24 w-full resize-y rounded-lg border border-border/70 bg-surface-raised/60 px-2.5 py-2 text-sm text-foreground outline-none placeholder:text-placeholder focus-visible:border-focus-ring/60 focus-visible:bg-canvas focus-visible:ring-[3px] focus-visible:ring-focus-ring/16"
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
                options={WEEKDAYS.map((d, i) => ({ value: String(i), label: `on ${d}` }))}
              />
            ) : null}
            {when.repeat === "monthly" ? (
              <SelectField
                label="Day of the month"
                value={String(when.monthDay)}
                onChange={(value) => set({ monthDay: Number(value) })}
                options={Array.from({ length: 31 }, (_, i) => ({
                  value: String(i + 1),
                  label: i < 28 ? `on day ${i + 1}` : `on day ${i + 1} (skips shorter months)`,
                }))}
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
                  options={[
                    { value: "minutes", label: "minutes" },
                    { value: "hours", label: "hours" },
                  ]}
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
            {zoned ? (
              <SelectField
                label="Time zone"
                value={when.tz || AGENT_ZONE}
                onChange={(tz) => set({ tz: tz === AGENT_ZONE ? "" : tz })}
                className="max-w-52 min-w-0"
                options={[
                  { value: AGENT_ZONE, label: "The agent's time zone" },
                  ...(zones.includes(when.tz) || !when.tz ? zones : [when.tz, ...zones]).map(
                    (z) => ({ value: z, label: z.replaceAll("_", " ") }),
                  ),
                ]}
              />
            ) : null}
          </div>
          {summary ? (
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {summary}
            </p>
          ) : null}
        </Field>
        {agentTasks && routes ? (
          <ResultsField
            task={task}
            agent={agentTasks}
            agentId={task?.agent ?? owner.split("|")[1] ?? ""}
            value={destination}
            onChange={(next) => {
              setError(null);
              setDestination(next);
            }}
          />
        ) : null}
        {provider === "openclaw" && !can?.deliverToOtter && !task?.undeliverable ? (
          <p className="text-xs text-muted-foreground">
            To get results in Otter, set up Messages from your agents in Settings → OpenClaw.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
