import { Markdown, cn } from "@otter/web/extension-kit";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PlusIcon } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { DrivePreview } from "./api";
import { parseDelimited } from "./table";

export type Edit = { text: string } | { sheets: { name: string; rows: string[][] }[] };

export function editable(preview: DrivePreview | undefined): Edit | null {
  if (!preview || "url" in preview || preview.truncated) return null;
  if (preview.kind === "workbook")
    return { sheets: preview.sheets.map((s) => ({ name: s.name, rows: s.rows })) };
  if (preview.kind === "table")
    return {
      // Every row: an edit is saved over the whole file.
      sheets: [
        {
          name: "Sheet1",
          rows: parseDelimited(preview.text, preview.delimiter ?? ",", Number.POSITIVE_INFINITY),
        },
      ],
    };
  return { text: preview.text };
}

export function Editor({
  initial,
  markdown,
  disabled,
  onChange,
}: {
  initial: Edit;
  markdown: boolean;
  disabled: boolean;
  onChange: (edit: Edit) => void;
}) {
  return "text" in initial ? (
    <TextEditor
      initial={initial.text}
      markdown={markdown}
      disabled={disabled}
      onChange={onChange}
    />
  ) : (
    <SheetEditor initial={initial.sheets} disabled={disabled} onChange={onChange} />
  );
}

function TextEditor({
  initial,
  markdown,
  disabled,
  onChange,
}: {
  initial: string;
  markdown: boolean;
  disabled: boolean;
  onChange: (edit: Edit) => void;
}) {
  const [text, setText] = useState(initial);
  const area = (
    <textarea
      autoFocus
      value={text}
      disabled={disabled}
      spellCheck={markdown}
      aria-label="Document text"
      onChange={(e) => {
        setText(e.target.value);
        onChange({ text: e.target.value });
      }}
      className="min-h-0 flex-1 resize-none bg-transparent px-6 py-5 font-mono text-[13px] leading-relaxed text-foreground outline-none"
    />
  );
  if (!markdown)
    return (
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        {area}
      </div>
    );
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex min-h-0 flex-col border-r border-border">{area}</div>
      <div className="min-h-0 overflow-auto px-8 py-6">
        <Markdown text={text} />
      </div>
    </div>
  );
}

const ROW = 32;
const MIN_COLUMNS = 6;

function columnName(i: number): string {
  let name = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function SheetEditor({
  initial,
  disabled,
  onChange,
}: {
  initial: { name: string; rows: string[][] }[];
  disabled: boolean;
  onChange: (edit: Edit) => void;
}) {
  const [sheets, setSheets] = useState(initial);
  const [open, setOpen] = useState(0);
  const sheet = sheets[open] ?? sheets[0]!;
  const rows = sheet.rows;
  const width = useMemo(
    () =>
      Math.max(
        MIN_COLUMNS,
        rows.reduce((most, r) => Math.max(most, r.length), 0),
      ),
    [rows],
  );
  const update = (next: string[][]) => {
    const all = sheets.map((s, i) => (i === open ? { ...s, rows: next } : s));
    setSheets(all);
    onChange({ sheets: all });
  };
  const setCell = (r: number, c: number, value: string) => {
    const next = rows.slice();
    while (next.length <= r) next.push([]);
    const row = next[r]!.slice();
    while (row.length <= c) row.push("");
    row[c] = value;
    next[r] = row;
    update(next);
  };
  const scroller = useRef<HTMLDivElement>(null);
  const count = rows.length + 1;
  // oxlint-disable-next-line react/incompatible-library -- read in render only, as TanStack documents.
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 20,
  });
  const items = virtualizer.getVirtualItems();
  const before = items[0]?.start ?? 0;
  const after = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);
  const down = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const next = r + (e.shiftKey ? -1 : 1);
    if (next < 0) return;
    if (next >= count - 1) update([...rows, []]);
    virtualizer.scrollToIndex(next);
    requestAnimationFrame(() =>
      scroller.current?.querySelector<HTMLInputElement>(`[data-cell="${next}:${c}"]`)?.focus(),
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <table className="w-max min-w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              <th className="w-10 border-b border-border" />
              {Array.from({ length: width }, (_, j) => (
                <th
                  key={j}
                  className="min-w-32 border-b border-l border-border px-2 py-1 text-center text-xs font-normal text-muted-foreground"
                >
                  {columnName(j)}
                </th>
              ))}
              <th className="border-b border-l border-border px-1">
                <button
                  type="button"
                  aria-label="Add a column"
                  disabled={disabled}
                  onClick={() =>
                    update(rows.map((r) => [...r, ...Array(width - r.length).fill(""), ""]))
                  }
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {before > 0 ? <tr aria-hidden style={{ height: before }} /> : null}
            {items.map(({ index: r }) =>
              r === count - 1 ? (
                <tr key="add" style={{ height: ROW }}>
                  <td colSpan={width + 2} className="px-2">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => update([...rows, []])}
                      className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <PlusIcon className="size-3.5" />
                      Add a row
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={r} style={{ height: ROW }} className={cn(r === 0 && "font-medium")}>
                  <td className="px-2 text-right text-xs text-muted-foreground tabular-nums">
                    {r + 1}
                  </td>
                  {Array.from({ length: width }, (_, c) => (
                    <td key={c} className="border-t border-l border-border p-0">
                      <input
                        data-cell={`${r}:${c}`}
                        value={rows[r]?.[c] ?? ""}
                        disabled={disabled}
                        aria-label={`${columnName(c)}${r + 1}`}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        onKeyDown={(e) => down(e, r, c)}
                        className="h-8 w-full min-w-32 bg-transparent px-2 text-foreground outline-none focus:bg-accent/40 focus:ring-2 focus:ring-focus-ring focus:ring-inset"
                      />
                    </td>
                  ))}
                  <td className="border-t border-l border-border" />
                </tr>
              ),
            )}
            {after > 0 ? <tr aria-hidden style={{ height: after }} /> : null}
          </tbody>
        </table>
      </div>
      {sheets.length > 1 ? (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-border px-2 py-1.5">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setOpen(i)}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1 text-xs",
                i === open
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
