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
import type { ToolStep } from "../mail/api";
import { ChatMarkdown } from "./chat-markdown";
import { cn } from "../mail/ui";

export type TurnItem =
  | { kind: "text"; id?: string; text: string }
  | { kind: "step"; id?: string; step: ToolStep; output?: string };

const STEP_ICONS: Record<ToolStep["kind"], typeof WrenchIcon> = {
  command: TerminalIcon,
  read: FileTextIcon,
  edit: FilePenLineIcon,
  search: SearchIcon,
  web: GlobeIcon,
  skill: WrenchIcon,
  tool: WrenchIcon,
};

const stepIcon = (step: ToolStep) => (step.source ? CommandIcon : STEP_ICONS[step.kind]);

type Step = Extract<TurnItem, { kind: "step" }>;

type Block =
  | { kind: "text"; text: string }
  | { kind: "step"; item: Step }
  | { kind: "group"; source: string; items: Step[] };

function blocksOf(items: TurnItem[]): Block[] {
  const blocks: Block[] = [];
  for (const item of items) {
    if (item.kind === "text") {
      blocks.push({ kind: "text", text: item.text });
      continue;
    }
    const last = blocks[blocks.length - 1];
    const source = item.step.source;
    // Back-to-back compactions (OpenClaw's transcript, then Codex's thread) are one to the reader.
    if (item.step.compaction && last?.kind === "step" && last.item.step.compaction)
      blocks[blocks.length - 1] = { kind: "step", item };
    else if (source && last?.kind === "group" && last.source === source) last.items.push(item);
    else if (source && last?.kind === "step" && last.item.step.source === source)
      blocks[blocks.length - 1] = { kind: "group", source, items: [last.item, item] };
    else blocks.push({ kind: "step", item });
  }
  return blocks;
}

/* oxlint-disable react/no-array-index-key -- Transcript blocks append and update in place; position preserves streaming row state. */
export function WorkLog({
  items,
  live = false,
  onOpenFile,
  loadImage,
}: {
  items: TurnItem[];
  /** The turn is still going: a step without a result is running (else it never reported one). */
  live?: boolean;
  onOpenFile?: (href: string) => void;
  loadImage?: (href: string) => Promise<string>;
}) {
  return (
    <div className="flex flex-col py-1">
      {blocksOf(items).map((block, i) =>
        block.kind === "text" ? (
          <div key={i} data-cite-source className="min-w-0 px-1 py-2">
            <ChatMarkdown text={block.text} onOpenFile={onOpenFile} loadImage={loadImage} />
          </div>
        ) : block.kind === "group" ? (
          <StepGroup key={i} source={block.source} items={block.items} live={live} />
        ) : block.item.step.compaction ? (
          <CompactionRow key={i} output={block.item.output} live={live} />
        ) : (
          <StepRow key={i} item={block.item} live={live} />
        ),
      )}
    </div>
  );
}
/* oxlint-enable react/no-array-index-key */

export const isCompaction = (item: TurnItem | undefined) =>
  item?.kind === "step" && Boolean(item.step.compaction);

export function CompactionRow({ output, live }: { output?: string; live: boolean }) {
  const running = live && output === undefined;
  const label = running
    ? "Compacting context"
    : output
      ? "Context compaction failed"
      : "Context compacted";
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
function StepGroup({ source, items, live }: { source: string; items: Step[]; live: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex flex-col">
      <RowHead
        icon={CommandIcon}
        title={`Used ${source} integration`}
        open={open}
        expandable
        pending={live && items.some((i) => i.output === undefined)}
        onToggle={() => setOpen((o) => !o)}
      />

      {open ? items.map((item, i) => <StepRow key={i} item={item} live={live} />) : null}
    </div>
  );
}
/* oxlint-enable react/no-array-index-key */

function StepRow({ item, live }: { item: Step; live: boolean }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(item.output || item.step.detail);
  return (
    <div className="flex flex-col">
      <RowHead
        icon={stepIcon(item.step)}
        title={item.step.title}
        open={open}
        expandable={expandable}
        pending={live && item.output === undefined}
        onToggle={() => setOpen((o) => !o)}
      />
      {open ? <StepResult step={item.step} output={item.output} live={live} /> : null}
    </div>
  );
}

/** Indents JSON that doesn't parse (the chat keeps only the start of long outputs). */
function indentJson(text: string): string {
  let out = "";
  let depth = 0;
  let inString = false;
  const newline = () => `\n${"  ".repeat(depth)}`;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "{" || c === "[") {
      depth += 1;
      out += c + newline();
    } else if (c === "}" || c === "]") {
      depth = Math.max(0, depth - 1);
      out += newline() + c;
    } else if (c === ",") out += c + newline();
    else if (c === ":") out += ": ";
    else if (!/\s/.test(c)) out += c;
  }
  return out;
}

function prettyJson(text: string | undefined): string | null {
  if (!text || !/^\s*[[{]/.test(text)) return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return indentJson(text.trim());
  }
}

function highlightJson(json: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of json.matchAll(
    /"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
  )) {
    const index = match.index ?? 0;
    if (index > last) parts.push(json.slice(last, index));
    const token = match[0];
    parts.push(
      <span key={index} className={token.startsWith('"') ? "text-success" : "text-info"}>
        {token}
      </span>,
    );
    last = index + token.length;
  }
  parts.push(json.slice(last));
  return parts;
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
