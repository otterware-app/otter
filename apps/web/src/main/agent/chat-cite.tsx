import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { QuoteIcon } from "lucide-react";
import { useLatest } from "@otter/client/use-latest";
import { useChats } from "@otter/client/agents/chat-store";
import { Button } from "@otter/ui/components/button";
import { Textarea } from "@otter/ui/components/textarea";
import {
  addCitation,
  citationText,
  commentCitation,
  type Citation,
} from "@otter/client/agents/chat-cite";

const HIGHLIGHT = "otter-cite";

function citableRange(root: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const sourceOf = (node: Node) =>
    (node instanceof Element ? node : node.parentElement)?.closest("[data-cite-source]");
  const start = sourceOf(range.startContainer);
  const end = sourceOf(range.endContainer);
  const source = start ?? end;
  if (!source || !root.contains(source)) return null;
  const clipped = range.cloneRange();
  if (start !== source) clipped.setStart(source, 0);
  if (end !== source) clipped.setEnd(source, source.childNodes.length);
  return clipped.toString().trim() ? clipped : null;
}

export function rangeAnchor(range: Range): DOMRect {
  const rects = range.getClientRects();
  return rects[rects.length - 1] ?? range.getBoundingClientRect();
}

export function CiteSelectionButton({
  root,
  onCite,
}: {
  root: HTMLElement | null;
  onCite: (text: string, range: Range) => void;
}) {
  const [range, setRange] = useState<Range | null>(null);
  useEffect(() => {
    if (!root) return;
    const settle = () => requestAnimationFrame(() => setRange(citableRange(root)));
    const change = () => {
      if (!citableRange(root)) setRange(null);
    };
    const hide = () => setRange(null);
    document.addEventListener("mouseup", settle);
    document.addEventListener("keyup", settle);
    document.addEventListener("selectionchange", change);
    root.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mouseup", settle);
      document.removeEventListener("keyup", settle);
      document.removeEventListener("selectionchange", change);
      root.removeEventListener("scroll", hide, true);
    };
  }, [root]);
  if (!range) return null;
  const at = rangeAnchor(range);
  const cite = () => {
    onCite(citationText(range.toString()), range);
    window.getSelection()?.removeAllRanges();
    setRange(null);
  };
  return createPortal(
    <button
      type="button"
      aria-label="Cite selection in composer"
      onMouseDown={(e) => e.preventDefault()}
      onClick={cite}
      className="surface-glass fixed z-50 flex items-center gap-1 rounded-pill border border-border/60 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm hover:bg-accent-surface margin:shadow-none"
      style={{
        left: Math.max(8, Math.min(at.right - 24, window.innerWidth - 80)),
        top: Math.min(at.bottom + 6, window.innerHeight - 36),
      }}
    >
      <QuoteIcon className="size-3.5" />
      Cite
    </button>,
    document.body,
  );
}

export function CitationCommentEditor({
  citation,
  anchor,
  side,
  range,
  onSave,
  onCancel,
}: {
  citation: Citation;
  anchor: DOMRect;
  side: "above" | "below";
  range?: Range;
  onSave: (comment: string) => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState(citation.comment ?? "");
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      const at = range ? rangeAnchor(range) : anchor;
      const below = at.bottom + 8;
      const above = at.top - box.height - 8;
      setPosition({
        left: Math.max(8, Math.min(at.left, window.innerWidth - box.width - 8)),
        top:
          side === "below" && below + box.height <= window.innerHeight - 8
            ? below
            : Math.max(8, above),
      });
    };
    place();
    if (!range) return;
    document.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, range, side]);

  useEffect(() => {
    const highlights = typeof CSS !== "undefined" ? CSS.highlights : undefined;
    if (!range || !highlights) return;
    highlights.set(HIGHLIGHT, new Highlight(range));
    return () => void highlights.delete(HIGHLIGHT);
  }, [range]);

  const cancelRef = useLatest(onCancel);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) cancelRef.current();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [cancelRef]);

  return createPortal(
    <div
      ref={ref}
      className="dropdown-glass fixed z-50 w-80 rounded-xl p-3 shadow-overlay"
      style={position ?? { left: 0, top: 0, visibility: "hidden" }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <Textarea
        autoFocus
        aria-label="Comment on the cited text"
        placeholder="Add an optional comment…"
        rows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSave(comment);
          }
        }}
        className="block max-h-40 min-h-12 border-0 bg-transparent p-1 focus-visible:bg-transparent focus-visible:ring-0"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={() => onSave(comment)}>
          Save
        </Button>
      </div>
    </div>,
    document.body,
  );
}

const NO_CITATIONS: Citation[] = [];

/** Citing a selection, then commenting on it, for one chat: the selection's Cite button and the comment editor. */
export function useCitations(chatId: string, onSaved: () => void) {
  const citations = useChats((s) => s.citations[chatId]) ?? NO_CITATIONS;
  const [commenting, setCommenting] = useState<{
    chatId: string;
    id: string;
    anchor: DOMRect;
    side: "above" | "below";
    range?: Range;
  } | null>(null);
  const shown = commenting?.chatId === chatId ? commenting : null;
  const citation = shown && citations.find((c) => c.id === shown.id);
  const editor: ReactNode =
    shown && citation ? (
      <CitationCommentEditor
        key={shown.id}
        citation={citation}
        anchor={shown.anchor}
        side={shown.side}
        range={shown.range}
        onSave={(comment) => {
          commentCitation(chatId, shown.id, comment);
          setCommenting(null);
          onSaved();
        }}
        onCancel={() => setCommenting(null)}
      />
    ) : null;
  return {
    citations,
    editor,
    cite: (text: string, range: Range, source?: string) => {
      const id = addCitation(chatId, text, source);
      setCommenting({ chatId, id, anchor: rangeAnchor(range), side: "below", range });
    },
    edit: (id: string, anchor: DOMRect) => setCommenting({ chatId, id, anchor, side: "above" }),
    close: () => setCommenting(null),
  };
}
