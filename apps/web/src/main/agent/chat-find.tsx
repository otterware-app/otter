import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";

import { matchesStroke, parseStroke } from "../keybindings/keys";
import { IconButton } from "@otter/ui/components/button";

const ALL = "chat-find";
const CURRENT = "chat-find-current";

/**
 * Where `query` occurs in each message under `root`, ignoring case: read as the message's whole
 * text, so a phrase across formatting ("hello **world**") is found too.
 */
export function findRanges(root: Element, query: string): Range[] {
  if (!query) return [];
  // Case folded by the pattern, so the offsets are the text's own ("İstanbul" lowercased is longer).
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const messages = root.querySelectorAll("[data-message-id]");
  const ranges: Range[] = [];
  for (const message of messages.length > 0 ? messages : [root]) {
    const nodes: { node: Text; start: number }[] = [];
    let text = "";
    const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push({ node: node as Text, start: text.length });
      text += node.textContent ?? "";
    }
    const at = (offset: number, end: boolean) => {
      const i = nodes.findLastIndex((n) => (end ? n.start < offset : n.start <= offset));
      return { node: nodes[i].node, offset: offset - nodes[i].start };
    };
    for (const match of text.matchAll(pattern)) {
      const start = at(match.index, false);
      const end = at(match.index + match[0].length, true);
      const range = new Range();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      ranges.push(range);
    }
  }
  return ranges;
}

/** Scrolls the nearest scrolling box so the match sits in its middle. */
function reveal(range: Range) {
  let box = range.startContainer.parentElement;
  while (
    box &&
    !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))
  )
    box = box.parentElement;
  if (!box) return;
  const at = range.getBoundingClientRect();
  const view = box.getBoundingClientRect();
  box.scrollBy({ top: at.top + at.height / 2 - (view.top + view.height / 2) });
}

const MOD_F = parseStroke("mod+f")!;
/** ⌘F / Ctrl+F, also where the app's own binding doesn't apply (a dialog). */
export const isFindKey = (event: KeyboardEvent) => matchesStroke(event, MOD_F);

/** Find in what's under `root` (⌘F / Ctrl+F): every match marked, the current one shown. */
export function DomFind({
  root,
  label,
  focusKey,
  onClose,
}: {
  /** What's searched: a chat's messages, a file's text. */
  root: RefObject<HTMLElement | null>;
  label: string;
  /** Changes each time find is asked for again, to select what's typed. */
  focusKey: number;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  // What was found, for the query it was found for: until a new query's are in, the old ones show.
  const [found, setFound] = useState<{ query: string; ranges: Range[] }>({ query: "", ranges: [] });
  const ranges = found.ranges;
  const [current, setCurrent] = useState(0);

  // Read again as the content changes (a reply streaming in, a PDF's pages laid out).
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const read = () => setFound({ query, ranges: findRanges(el, query.trim()) });
    read();
    // At most every 200 ms, so a reply streaming in keeps its matches current.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      timer ??= setTimeout(() => {
        timer = undefined;
        read();
      }, 200);
    });
    observer.observe(el, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [root, query]);

  const at = ranges.length === 0 ? -1 : Math.min(current, ranges.length - 1);
  // Scrolled to when the match shown changes, not each time the content is read again.
  const revealed = useRef("");
  const marked = useRef<Highlight | null>(null);
  useEffect(() => {
    if (!("highlights" in CSS)) return;
    marked.current = new Highlight(...ranges);
    CSS.highlights.set(ALL, marked.current);
    const shown = ranges[at];
    if (shown) {
      CSS.highlights.set(CURRENT, new Highlight(shown));
      const key = `${found.query}\n${at}`;
      if (found.query === query && revealed.current !== key) {
        reveal(shown);
        revealed.current = key;
      }
    } else CSS.highlights.delete(CURRENT);
  }, [ranges, at, found.query, query]);
  // Another find (the chat's, a file's) may have marked its own since.
  useEffect(
    () => () => {
      if (!("highlights" in CSS) || CSS.highlights.get(ALL) !== marked.current) return;
      CSS.highlights.delete(ALL);
      CSS.highlights.delete(CURRENT);
    },
    [],
  );

  return (
    <FindBar
      label={label}
      focusKey={focusKey}
      query={query}
      onQuery={(value) => {
        setQuery(value);
        setCurrent(0);
      }}
      at={at}
      total={ranges.length}
      onStep={(by) => {
        if (ranges.length > 0) setCurrent((at + by + ranges.length) % ranges.length);
      }}
      onClose={onClose}
    />
  );
}

export function FindBar({
  label,
  focusKey,
  query,
  onQuery,
  at,
  total,
  onStep,
  onClose,
}: {
  label: string;
  focusKey: number;
  query: string;
  onQuery: (query: string) => void;
  /** The match shown, from 0; -1 for none. */
  at: number;
  total: number;
  onStep: (by: 1 | -1) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusKey]);

  return (
    <div
      data-own-escape=""
      className="dropdown-glass flex items-center gap-1 rounded-lg py-1 pr-1 pl-3 shadow-overlay"
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onStep(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else if (isFindKey(e.nativeEvent)) {
            e.preventDefault();
            e.stopPropagation();
            inputRef.current?.select();
          }
        }}
        placeholder={label}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-placeholder"
      />
      {query.trim() ? (
        <span className="shrink-0 px-1 text-xs text-muted-foreground tabular-nums">
          {total === 0 ? "No results" : `${at + 1}/${total}`}
        </span>
      ) : null}
      <IconButton label="Previous match" onClick={() => onStep(-1)}>
        <ChevronUpIcon className="size-4" />
      </IconButton>
      <IconButton label="Next match" onClick={() => onStep(1)}>
        <ChevronDownIcon className="size-4" />
      </IconButton>
      <IconButton label="Close find" onClick={onClose}>
        <XIcon className="size-4" />
      </IconButton>
    </div>
  );
}
