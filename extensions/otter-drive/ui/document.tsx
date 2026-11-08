import {
  Btn,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
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
  toast,
  type WorkspaceMainProps,
} from "@otter/web/extension-kit";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeftIcon,
  DownloadIcon,
  LinkIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PencilIcon,
  UserPlusIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ActionItems, useDocumentActions } from "./actions";
import { driveApi, type DriveArtifact, type DrivePreview } from "./api";
import { Editor, editable, type Edit } from "./editor";
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
    <div
      data-toolbar=""
      className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 px-4"
    >
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
  // Kept for the version shown, and the current one it was (a new version replaces it).
  const current = artifact.data?.current?.number ?? null;
  const [open, setOpen] = useState<{
    version: number | null;
    current: number | null;
    data: DrivePreview;
  } | null>(null);
  if (open && (open.version !== version || open.current !== current)) setOpen(null);
  const kept = open?.version === version && open.current === current ? open.data : undefined;
  if (fresh && !kept) setOpen({ version, current, data: fresh });
  const shown = kept ?? fresh;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    edit: Edit;
    source: { version: number; count: number };
  } | null>(null);
  const [draft, setDraft] = useState<Edit | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const unlessUnsaved = (then: () => void) => (draft ? setLeaving(() => then) : then());
  const back = () => go({ location });
  const discarded = useRef(false);
  const blocker = useBlocker({
    shouldBlockFn: () => draft !== null && !saving,
    enableBeforeUnload: () => draft !== null,
    withResolver: true,
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (target?.closest("input, textarea, [contenteditable], [role=dialog]")) return;
      if (editing) return;
      back();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  });

  const a = artifact.data;
  const canEdit = a !== undefined && a.role !== "viewer";
  const title = a?.title ?? null;
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["otter-drive", "artifact", id] }),
      qc.invalidateQueries({ queryKey: ["otter-drive", "artifacts"] }),
      qc.invalidateQueries({ queryKey: ["otter-drive", "versions", id] }),
    ]);
  const reload = async () => {
    await qc.resetQueries({ queryKey: ["otter-drive", "preview", id] });
    setOpen(null);
    await refresh();
  };
  const startEdit = editable(shown);
  const canStartEdit = canEdit && !a?.archived && version === null && startEdit !== null;
  const save = async () => {
    if (!draft) return setEditing(null);
    setSaving(true);
    try {
      const saved = await driveApi.saveEdit(id, folderId, draft, editing!.source);
      setEditing(null);
      setDraft(null);
      await reload();
      toast.success(`Saved as version ${saved.current?.number ?? ""}`);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  const promote = async (number: number) => {
    try {
      await driveApi.promoteVersion(id, folderId, number);
      setVersion(null);
      await reload();
      toast.success(`Version ${number} is current again`);
    } catch (error) {
      toast.error(errorText(error));
    }
  };
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
        {a && a.versionCount > 1 && versions.data && !editing ? (
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
        {a && version !== null && canEdit && !a.archived && !editing ? (
          <Btn size="sm" className="no-drag" onClick={() => void promote(version)}>
            <HistoryIcon />
            Make current
          </Btn>
        ) : null}
        {editing ? (
          <div className="no-drag flex items-center gap-1.5">
            <Btn size="sm" disabled={saving} onClick={() => unlessUnsaved(() => setEditing(null))}>
              Cancel
            </Btn>
            <Btn
              size="sm"
              variant="primary"
              disabled={saving || !draft}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save"}
            </Btn>
          </div>
        ) : a ? (
          <>
            {canStartEdit ? (
              <Btn
                size="sm"
                className="no-drag"
                onClick={() =>
                  a.current &&
                  setEditing({
                    edit: startEdit!,
                    source: { version: a.current.number, count: a.versionCount },
                  })
                }
              >
                <PencilIcon />
                Edit
              </Btn>
            ) : null}
            <DocumentButtons a={a} folderId={folderId} version={version} onGone={back} />
          </>
        ) : null}
      </TitleBar>
      <div className="flex min-h-0 flex-1 flex-col p-1">
        {artifact.isError || preview.isError ? (
          <Empty
            title="Couldn't open this document"
            detail={errorText(artifact.error ?? preview.error)}
            action={<Btn onClick={back}>Back to documents</Btn>}
          />
        ) : !shown ? (
          <div className="flex-1 animate-pulse rounded-lg bg-muted/50" />
        ) : editing ? (
          <Editor
            initial={editing.edit}
            markdown={shown.kind === "markdown"}
            disabled={saving}
            onChange={setDraft}
          />
        ) : (
          <Preview preview={shown} />
        )}
      </div>
      {leaving || blocker.status === "blocked" ? (
        <Dialog
          open
          title="Discard your changes?"
          description="They haven't been saved as a version."
          onOpenChange={(o) => {
            if (o || discarded.current) return;
            setLeaving(null);
            if (blocker.status === "blocked") blocker.reset();
          }}
          confirmLabel="Discard"
          confirmVariant="destructive"
          onConfirm={() => {
            // The dialog closes after this: that close isn't a Cancel.
            discarded.current = true;
            requestAnimationFrame(() => (discarded.current = false));
            const then = leaving;
            setLeaving(null);
            setDraft(null);
            setEditing(null);
            if (blocker.status === "blocked") blocker.proceed();
            else then?.();
          }}
        />
      ) : null}
    </div>
  );
}

function DocumentButtons({
  a,
  folderId,
  version,
  onGone,
}: {
  a: DriveArtifact;
  folderId: string | undefined;
  version: number | null;
  onGone: () => void;
}) {
  const actions = useDocumentActions(a, { folderId, version, onGone });
  const run = (id: string) => {
    const action = actions.find((x) => x.id === id);
    if (action && "run" in action) action.run();
  };
  return (
    <div className="no-drag flex items-center gap-0.5">
      <Btn size="sm" className="me-1" onClick={() => run("share")}>
        <UserPlusIcon />
        Share
      </Btn>
      <HintTooltip label="Copy link">
        <IconBtn label="Copy link" onClick={() => run("link")}>
          <LinkIcon />
        </IconBtn>
      </HintTooltip>
      <HintTooltip label="Download">
        <IconBtn label="Download" onClick={() => run("download")}>
          <DownloadIcon />
        </IconBtn>
      </HintTooltip>
      <DropdownMenu>
        <HintTooltip label="More">
          <DropdownMenuTrigger asChild>
            <IconBtn label="Document actions">
              <MoreHorizontalIcon />
            </IconBtn>
          </DropdownMenuTrigger>
        </HintTooltip>
        <DropdownMenuContent align="end" className="min-w-56">
          <ActionItems actions={actions} menu="dropdown" />
        </DropdownMenuContent>
      </DropdownMenu>
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
        className="min-h-0 flex-1 rounded-lg border border-border bg-white [color-scheme:light]"
      />
    );
  if (preview.kind === "video")
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black">
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
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg border border-border bg-muted/30 p-6">
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <DelimitedTable
          text={preview.text}
          delimiter={preview.delimiter ?? ","}
          footer={preview.truncated ? <Truncated /> : null}
        />
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card">
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
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
