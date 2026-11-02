/**
 * A document, open in Drive: its title (rename in place), when and by whom,
 * its versions, and what it is, drawn in the app (Markdown, tables, text,
 * images, a one-file page in a sandbox) or opened in Otter Drive.
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LinkIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { driveApi, type DrivePreview } from "./api";
import { errorText } from "./hooks";
import { parseDelimited } from "./table";

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
    retry: false,
  });
  const versions = useQuery({
    queryKey: ["otter-drive", "versions", id],
    queryFn: () => driveApi.versions(id, folderId),
    enabled: (artifact.data?.versionCount ?? 0) > 1,
    retry: false,
  });
  const [version, setVersion] = useState<number | null>(null);
  const preview = useQuery({
    queryKey: ["otter-drive", "preview", id, version],
    queryFn: () => driveApi.preview(id, folderId, version ?? undefined),
    retry: false,
    staleTime: 5 * 60_000,
  });
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
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        {artifact.isError || preview.isError ? (
          <Empty
            title="Couldn't open this document"
            detail={errorText(artifact.error ?? preview.error)}
            action={<Btn onClick={back}>Back to documents</Btn>}
          />
        ) : !preview.data ? (
          <div className="flex-1 animate-pulse rounded-xl bg-muted/50" />
        ) : (
          <Preview preview={preview.data} url={a?.url ?? ""} />
        )}
      </div>
    </div>
  );
}

function Preview({ preview, url }: { preview: DrivePreview; url: string }) {
  if (preview.kind === "html")
    return (
      <iframe
        title="Document preview"
        srcDoc={preview.html}
        // Its own opaque origin: scripts run, but can reach neither the app nor Otter Drive.
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
        className="min-h-0 flex-1 rounded-xl border border-border bg-white"
      />
    );
  if (preview.kind === "image")
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-xl border border-border bg-muted/30 p-6">
        <img src={preview.src} alt="" className="max-h-full max-w-full object-contain" />
      </div>
    );
  if (preview.kind === "elsewhere")
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card text-center">
        <FileTextIcon className="size-8 text-muted-foreground/70" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">{preview.entryPath}</p>
          <p className="text-xs text-muted-foreground">
            {preview.fileCount > 1 ? `${preview.fileCount} files · ` : ""}
            {formatBytes(preview.byteSize)}
          </p>
        </div>
        <Btn size="sm" onClick={() => openLink(url)}>
          <ExternalLinkIcon />
          Open in Otter Drive
        </Btn>
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-card">
      {preview.kind === "markdown" ? (
        <div className="mx-auto max-w-3xl px-8 py-8">
          <Markdown text={preview.text} />
        </div>
      ) : preview.kind === "table" ? (
        <Table text={preview.text} delimiter={preview.delimiter ?? ","} />
      ) : (
        <pre className="px-6 py-5 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-foreground select-text">
          {preview.text}
        </pre>
      )}
      {preview.truncated ? (
        <p className="px-6 pb-5 text-xs text-muted-foreground">
          Only the beginning is shown here. Open it in Otter Drive for the rest.
        </p>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Table({ text, delimiter }: { text: string; delimiter: string }) {
  const rows = useMemo(() => parseDelimited(text, delimiter), [text, delimiter]);
  const [head, ...body] = rows;
  if (!head) return <p className="p-6 text-sm text-muted-foreground">This table is empty.</p>;
  return (
    <table className="w-max min-w-full border-collapse text-[13px] select-text">
      <thead className="sticky top-0 bg-card">
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
        {body.map((r, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- a table's rows are its positions.
          <tr key={i} className={cn(i % 2 === 1 && "bg-muted/30")}>
            <td className="px-3 py-1.5 text-right text-xs text-muted-foreground tabular-nums">
              {i + 1}
            </td>
            {head.map((_, j) => (
              <td
                // oxlint-disable-next-line react/no-array-index-key -- a table's columns are its positions.
                key={j}
                className="max-w-80 truncate border-l border-border px-3 py-1.5 text-foreground"
              >
                {r[j] ?? ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
