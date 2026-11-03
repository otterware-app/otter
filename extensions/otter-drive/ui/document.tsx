/**
 * A document, open in Drive: its title (rename in place), when and by whom,
 * its versions, and what it is, as Otter Drive shows it: Markdown, text,
 * tables and workbooks drawn here; videos, images, pages, sites, PDFs and the
 * rest from Drive's content host.
 */

import {
  Btn,
  HintTooltip,
  IconBtn,
  Input,
  Markdown,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
  openLink,
  toast,
  type WorkspaceMainProps,
} from "@otter-mail/web/extension-kit";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ExternalLinkIcon,
  LinkIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { driveApi, type DriveArtifact, type DrivePreview } from "./api";
import { errorText } from "./hooks";
import { parseDelimited } from "./table";

const URL_FRESH = 4 * 60_000;

/**
 * A document's preview. Text and tables are kept. Drive's URL for the rest is good for five
 * minutes, enough to open it: reused within four, else fetched again on opening.
 */
export const previewQuery = (id: string, folderId: string | undefined, version: number | null) =>
  ({
    queryKey: ["otter-drive", "preview", id, version],
    queryFn: () => driveApi.preview(id, folderId, version ?? undefined),
    retry: false,
    staleTime: (query: { state: { data?: DrivePreview } }) =>
      query.state.data && "url" in query.state.data ? URL_FRESH : Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }) as const;

/** The document as a list in the cache has it. */
function listed(qc: QueryClient, id: string): DriveArtifact | undefined {
  for (const [, list] of qc.getQueriesData<DriveArtifact[]>({
    queryKey: ["otter-drive", "artifacts"],
  })) {
    const found = list?.find((a) => a.id === id);
    if (found) return found;
  }
  return undefined;
}

export function when(iso: string): string {
  const days = (Date.now() - Date.parse(iso)) / 86_400_000;
  if (days < 1 / 24) return "Just now";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (days < 1) return rtf.format(-Math.round(days * 24), "hour");
  if (days < 7) return rtf.format(-Math.round(days), "day");
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: days > 300 ? "numeric" : undefined,
  });
}

export function TitleBar({
  leading,
  trailing,
  children,
}: {
  leading: ReactNode;
  trailing: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 px-4">
      {leading}
      {children}
      {trailing}
    </div>
  );
}

export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{detail}</p>
      {action}
    </div>
  );
}

export function DocumentView({
  id,
  folderId,
  location,
  go,
  setTitle,
  titleLeading,
  titleTrailing,
}: WorkspaceMainProps & { id: string; folderId: string | undefined }) {
  const qc = useQueryClient();
  const artifact = useQuery({
    queryKey: ["otter-drive", "artifact", id],
    queryFn: () => driveApi.artifact(id, folderId),
    // The list already has it: its title and actions show at once.
    placeholderData: () => listed(qc, id),
    retry: false,
  });
  const versions = useQuery({
    queryKey: ["otter-drive", "versions", id],
    queryFn: () => driveApi.versions(id, folderId),
    enabled: (artifact.data?.versionCount ?? 0) > 1,
    retry: false,
  });
  const [version, setVersion] = useState<number | null>(null);
  const preview = useQuery(previewQuery(id, folderId, version));
  // An expired URL isn't opened; one already open stays up, though it ages past
  // its freshness (swapping it would reload the video or page, or blank it).
  const fresh = preview.data && "url" in preview.data && preview.isStale ? undefined : preview.data;
  const [open, setOpen] = useState<{ version: number | null; data: DrivePreview } | null>(null);
  const kept = open?.version === version ? open.data : undefined;
  if (fresh && !kept) setOpen({ version, data: fresh });
  const shown = kept ?? fresh;
  const [renaming, setRenaming] = useState<string | null>(null);
  const back = () => go({ location });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (target?.closest("input, textarea, [contenteditable], [role=dialog]")) return;
      back();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  });

  const a = artifact.data;
  // A viewer reads; renaming and archiving are an editor's.
  const canEdit = a !== undefined && a.role !== "viewer";
  // The document names its tab and its place in history.
  const title = a?.title ?? null;
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["otter-drive", "artifact", id] }),
      qc.invalidateQueries({ queryKey: ["otter-drive", "artifacts"] }),
    ]);
  const act = async (action: () => Promise<unknown>, done?: string) => {
    try {
      await action();
      await refresh();
      if (done) toast.success(done);
      return true;
    } catch (error) {
      toast.error(errorText(error));
      return false;
    }
  };
  const rename = (title: string) => {
    setRenaming(null);
    if (a && title.trim() && title.trim() !== a.title)
      void act(() => driveApi.rename(id, folderId, title.trim()));
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TitleBar leading={titleLeading} trailing={titleTrailing}>
        <HintTooltip label="Back to documents" hint="Esc">
          <IconBtn label="Back to documents" className="no-drag" onClick={back}>
            <ArrowLeftIcon />
          </IconBtn>
        </HintTooltip>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          {renaming !== null ? (
            <Input
              autoFocus
              value={renaming}
              maxLength={200}
              aria-label="Title"
              className="no-drag h-7 max-w-md text-sm font-medium"
              onChange={(e) => setRenaming(e.target.value)}
              onBlur={() => rename(renaming)}
              onKeyDown={(e) => {
                if (e.key === "Enter") rename(renaming);
                if (e.key === "Escape") {
                  e.preventDefault();
                  setRenaming(null);
                }
              }}
            />
          ) : (
            <button
              type="button"
              title={canEdit ? "Rename" : undefined}
              disabled={!canEdit}
              onClick={() => a && setRenaming(a.title)}
              className="no-drag min-w-0 truncate rounded px-1 text-left text-sm font-medium text-foreground enabled:hover:bg-accent"
            >
              {a?.title ?? "Loading…"}
            </button>
          )}
          {a?.current ? (
            <span className="shrink-0 truncate text-xs text-muted-foreground">
              {when(a.updatedAt)}
              {a.current.createdBy ? ` · ${a.current.createdBy}` : ""}
            </span>
          ) : null}
        </div>
        {a && a.versionCount > 1 && versions.data ? (
          <Select
            value={String(version ?? a.current?.number ?? "")}
            onValueChange={(v) => setVersion(Number(v) === a.current?.number ? null : Number(v))}
          >
            <SelectTrigger aria-label="Version" className="no-drag h-7 w-auto gap-1 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {versions.data.map((v) => (
                <SelectItem key={v.number} value={String(v.number)}>
                  v{v.number} · {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {a ? (
          <div className="no-drag flex items-center">
            <HintTooltip label="Copy link">
              <IconBtn
                label="Copy link"
                onClick={() =>
                  void navigator.clipboard.writeText(a.url).then(() => toast.success("Link copied"))
                }
              >
                <LinkIcon />
              </IconBtn>
            </HintTooltip>
            <HintTooltip label="Open in Otter Drive">
              <IconBtn label="Open in Otter Drive" onClick={() => openLink(a.url)}>
                <ExternalLinkIcon />
              </IconBtn>
            </HintTooltip>
            {canEdit ? (
              <HintTooltip label={a.archived ? "Restore" : "Archive"}>
                <IconBtn
                  label={a.archived ? "Restore" : "Archive"}
                  onClick={() =>
                    void act(
                      () => driveApi.setArchived(id, folderId, !a.archived),
                      a.archived ? "Restored" : "Archived",
                    ).then((ok) => ok && !a.archived && back())
                  }
                >
                  {a.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                </IconBtn>
              </HintTooltip>
            ) : null}
          </div>
        ) : null}
      </TitleBar>
      <div className="flex min-h-0 flex-1 flex-col px-1 pb-1">
        {artifact.isError || preview.isError ? (
          <Empty
            title="Couldn't open this document"
            detail={errorText(artifact.error ?? preview.error)}
            action={<Btn onClick={back}>Back to documents</Btn>}
          />
        ) : !shown ? (
          <div className="flex-1 animate-pulse rounded-xl bg-muted/50" />
        ) : (
          <Preview preview={shown} />
        )}
      </div>
    </div>
  );
}

function Preview({ preview }: { preview: DrivePreview }) {
  if (preview.kind === "frame")
    return (
      <iframe
        title="Document preview"
        src={preview.url}
        // Otter Drive's own sandbox. Same-origin is Drive's content host, apart from the app.
        // oxlint-disable-next-line react/iframe-missing-sandbox -- its origin isn't the app's.
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads allow-modals"
        referrerPolicy="no-referrer"
        className="min-h-0 flex-1 rounded-xl border border-border bg-white [color-scheme:light]"
      />
    );
  if (preview.kind === "video")
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
        <video
          src={preview.url}
          aria-label="Video"
          controls
          playsInline
          preload="metadata"
          className="size-full object-contain"
        />
      </div>
    );
  if (preview.kind === "image")
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-xl border border-border bg-muted/30 p-6">
        <img
          src={preview.url}
          alt=""
          referrerPolicy="no-referrer"
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  if (preview.kind === "workbook")
    return <Workbook sheets={preview.sheets} truncated={preview.truncated} />;
  if (preview.kind === "table")
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
        <DelimitedTable
          text={preview.text}
          delimiter={preview.delimiter ?? ","}
          footer={preview.truncated ? <Truncated /> : null}
        />
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-card">
      {preview.kind === "markdown" ? (
        <div className="mx-auto max-w-3xl px-8 py-8">
          <Markdown text={preview.text} />
        </div>
      ) : (
        <pre className="px-6 py-5 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-foreground select-text">
          {preview.text}
        </pre>
      )}
      {preview.truncated ? <Truncated /> : null}
    </div>
  );
}

function Truncated() {
  return (
    <p className="px-6 py-4 text-xs text-muted-foreground">
      Only the beginning is shown here. Open it in Otter Drive for the rest.
    </p>
  );
}

/** A workbook's sheets, one at a time, with their tabs below as in a spreadsheet. */
function Workbook({
  sheets,
  truncated,
}: {
  sheets: { name: string; rows: string[][] }[];
  truncated: boolean;
}) {
  const [open, setOpen] = useState(0);
  const sheet = sheets[open] ?? sheets[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <Table key={open} rows={sheet?.rows ?? []} footer={truncated ? <Truncated /> : null} />
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

function DelimitedTable({
  text,
  delimiter,
  footer,
}: {
  text: string;
  delimiter: string;
  footer: ReactNode;
}) {
  const rows = useMemo(() => parseDelimited(text, delimiter), [text, delimiter]);
  return <Table rows={rows} footer={footer} />;
}

/** A row's height: rows are one line, so only the ones in view are drawn. */
const ROW = 32;

function Table({ rows, footer }: { rows: string[][]; footer: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [first, ...body] = rows;
  // oxlint-disable-next-line react/incompatible-library -- read in render only, as TanStack documents.
  const virtualizer = useVirtualizer({
    count: body.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 20,
  });
  // A sheet's rows end at their last cell: the widest sets the columns.
  const width = useMemo(() => rows.reduce((most, r) => Math.max(most, r.length), 0), [rows]);
  if (!first) return <p className="p-6 text-sm text-muted-foreground">This table is empty.</p>;
  const head = Array.from({ length: width }, (_, i) => first[i] ?? "");
  const items = virtualizer.getVirtualItems();
  const before = items[0]?.start ?? 0;
  const after = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);
  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
      <table className="w-max min-w-full border-collapse text-[13px] select-text">
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            <th className="w-10 border-b border-border px-3 py-2" />
            {head.map((h, i) => (
              <th
                // oxlint-disable-next-line react/no-array-index-key -- a table's columns are its positions.
                key={i}
                className="border-b border-l border-border px-3 py-2 text-left font-medium text-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {before > 0 ? <tr aria-hidden style={{ height: before }} /> : null}
          {items.map(({ index: i }) => (
            <tr key={i} style={{ height: ROW }} className={cn(i % 2 === 1 && "bg-muted/30")}>
              <td className="px-3 text-right text-xs text-muted-foreground tabular-nums">
                {i + 1}
              </td>
              {head.map((_, j) => (
                <td
                  // oxlint-disable-next-line react/no-array-index-key -- a table's columns are its positions.
                  key={j}
                  className="max-w-80 truncate border-l border-border px-3 whitespace-nowrap text-foreground"
                >
                  {body[i]![j] ?? ""}
                </td>
              ))}
            </tr>
          ))}
          {after > 0 ? <tr aria-hidden style={{ height: after }} /> : null}
        </tbody>
      </table>
      {footer}
    </div>
  );
}
