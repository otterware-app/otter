import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CodeXmlIcon,
  CommandIcon,
  FilePenLineIcon,
  FileTextIcon,
  GlobeIcon,
  Minimize2Icon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";
import { ChatMarkdown } from "./chat-markdown";
import { cn } from "@otter/ui/lib/utils";
import type { ChatTurnItem } from "@otter/contracts/chats";
import type { ToolStep } from "@otter/client/agents/api";
import {
  blocksOf,
  compactionLabel,
  jsonTokens,
  prettyJson,
  stepExpandable,
  stepGroupTitle,
  stepIcon,
  stepPending,
  type StepIcon,
  type StepItem,
} from "@otter/client/agents/work-log";

const STEP_ICONS: Record<StepIcon, typeof WrenchIcon> = {
  terminal: TerminalIcon,
  "file-text": FileTextIcon,
  "file-pen-line": FilePenLineIcon,
  search: SearchIcon,
  globe: GlobeIcon,
  wrench: WrenchIcon,
  command: CommandIcon,
};

/* oxlint-disable react/no-array-index-key -- Transcript blocks append and update in place; position preserves streaming row state. */
export function WorkLog({
  items,
  live = false,
  stepping = false,
  onOpenFile,
  loadImage,
}: {
  items: ChatTurnItem[];
  /** The turn is still going: a step without a result is running (else it never reported one). */
  live?: boolean;
  /**
   * The last step is still what the run is doing: it stays lit until the next thing happens, as
   * T3 Code keeps its latest tool.
   */
  stepping?: boolean;
  onOpenFile?: (href: string) => void;
  loadImage?: (href: string) => Promise<string>;
}) {
  const blocks = blocksOf(items);
  return (
    <div className="flex flex-col py-1">
      {blocks.map((block, i) => {
        const lit = stepping && i === blocks.length - 1;
        return block.kind === "text" ? (
          <div key={i} data-cite-source className="min-w-0 px-1 py-2">
            <ChatMarkdown text={block.text} onOpenFile={onOpenFile} loadImage={loadImage} />
          </div>
        ) : block.kind === "group" ? (
          <StepGroup key={i} source={block.source} items={block.items} live={live} lit={lit} />
        ) : block.item.step.compaction ? (
          <CompactionRow key={i} output={block.item.output} live={live} />
        ) : (
          <StepRow key={i} item={block.item} live={live} lit={lit} />
        );
      })}
    </div>
  );
}
/* oxlint-enable react/no-array-index-key */

export function CompactionRow({ output, live }: { output?: string; live: boolean }) {
  const running = live && output === undefined;
  const label = compactionLabel(output, live);
  return (
    <div
      role="separator"
      aria-label={label}
      className={cn(
        "flex items-center gap-3 px-1 py-2 text-xs",
        output ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <span className="h-px flex-1 bg-border" />
      <span className={cn("flex items-center gap-1.5", running && "text-shimmer")}>
        <Minimize2Icon className="size-3 shrink-0" aria-hidden />
        {label}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function RowHead({
  icon: Icon,
  title,
  open,
  expandable,
  pending,
  onToggle,
}: {
  icon: typeof WrenchIcon;
  title: string;
  open: boolean;
  expandable: boolean;
  pending?: boolean;
  onToggle: () => void;
}) {
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      disabled={!expandable}
      aria-expanded={expandable ? open : undefined}
      onClick={onToggle}
      className={cn(
        "group/step flex min-w-0 max-w-full select-none items-center gap-1.5 self-start rounded-md px-0.5 py-0.5 text-left",
        expandable
          ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring/70"
          : "cursor-default",
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center text-icon-muted">
        <Icon className="block size-4 shrink-0 stroke-2" aria-hidden />
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-sm leading-relaxed text-secondary-label",
          expandable && "group-hover/step:text-foreground",
          open && "text-foreground",
          pending && "text-shimmer",
        )}
      >
        {title}
      </span>
      {expandable ? (
        <Chevron
          className={cn(
            "size-3.5 shrink-0 text-icon-muted",
            !open && "opacity-0 group-hover/step:opacity-70",
          )}
          aria-hidden
        />
      ) : null}
    </button>
  );
}

/* oxlint-disable react/no-array-index-key -- Transcript blocks append and update in place; position preserves streaming row state. */
function StepGroup({
  source,
  items,
  live,
  lit,
}: {
  source: string;
  items: StepItem[];
  live: boolean;
  lit: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex flex-col">
      <RowHead
        icon={CommandIcon}
        title={stepGroupTitle(source)}
        open={open}
        expandable
        pending={lit || items.some((i) => stepPending(i, live))}
        onToggle={() => setOpen((o) => !o)}
      />

      {open
        ? items.map((item, i) => <StepRow key={i} item={item} live={live} lit={false} />)
        : null}
    </div>
  );
}
/* oxlint-enable react/no-array-index-key */

function StepRow({ item, live, lit }: { item: StepItem; live: boolean; lit: boolean }) {
  const [open, setOpen] = useState(false);
  const expandable = stepExpandable(item);
  return (
    <div className="flex flex-col">
      <RowHead
        icon={STEP_ICONS[stepIcon(item.step)]}
        title={item.step.title}
        open={open}
        expandable={expandable}
        pending={lit || stepPending(item, live)}
        onToggle={() => setOpen((o) => !o)}
      />
      {open ? <StepResult step={item.step} output={item.output} live={live} /> : null}
    </div>
  );
}

function highlightJson(json: string): ReactNode[] {
  let at = 0;
  return jsonTokens(json).map((token) => {
    const key = at;
    at += token.text.length;
    return token.kind === "plain" ? (
      token.text
    ) : (
      <span key={key} className={token.kind === "string" ? "text-success" : "text-info"}>
        {token.text}
      </span>
    );
  });
}

function StepResult({ step, output, live }: { step: ToolStep; output?: string; live: boolean }) {
  const json = prettyJson(output);
  const detail = prettyJson(step.detail) ?? step.detail;
  return (
    <div className="mb-2 ms-7 mt-1 flex min-w-0 flex-col overflow-hidden rounded-2xl bg-code">
      <div className="flex items-center gap-2 px-4 pb-1 pt-3 text-xs text-foreground">
        <CodeXmlIcon className="size-3.5" aria-hidden />
        <span>{json ? "json" : "text"}</span>
      </div>
      {detail && detail !== output ? (
        <pre className="mx-4 mt-1 max-h-24 select-text overflow-auto whitespace-pre-wrap break-all border-b border-border/40 pb-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {detail}
        </pre>
      ) : null}
      {output ? (
        <FadingPre>{json ? highlightJson(json) : output}</FadingPre>
      ) : output === undefined && live ? (
        <p className="px-4 pb-3 pt-1 text-xs text-muted-foreground">Running…</p>
      ) : null}
    </div>
  );
}

function FadingPre({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [more, setMore] = useState(false);
  const measure = () => {
    const el = ref.current;
    if (el) setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  };
  useLayoutEffect(measure, [children]);
  return (
    <pre
      ref={ref}
      onScroll={measure}
      className={cn(
        "max-h-72 select-text overflow-auto whitespace-pre-wrap break-words px-4 pb-4 pt-2 font-mono text-xs leading-relaxed text-foreground",
        more && "[mask-image:linear-gradient(to_bottom,black_calc(100%-3rem),transparent)]",
      )}
    >
      {children}
    </pre>
  );
}
