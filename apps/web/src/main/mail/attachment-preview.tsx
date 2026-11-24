/* oxlint-disable react/no-array-index-key -- Table rows and columns have stable positions and may contain identical values. */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { AppWindowIcon, Code2Icon, DownloadIcon, EyeIcon, Table2Icon, XIcon } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@otter/ui/components/dialog";
import { features } from "../features";
import { ChatMarkdown } from "../agent/chat-markdown";
import { formatAttachmentSize } from "@otter/client/agents/chat-attachments";
import {
  MEDIA_KINDS,
  attachmentPreview,
  bytesOfBase64,
  decodeHtmlSource,
  decodeText,
  parseDelimited,
  type DecodedText,
  type PreviewKind,
} from "@otter/client/file-preview";
import { DomFind, isFindKey } from "../agent/chat-find";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { Button, IconButton } from "@otter/ui/components/button";
import { Spinner } from "@otter/ui/components/spinner";

const PdfViewer = lazy(() => import("./pdf-viewer"));

export type PreviewFile = {
  name: string;
  mimeType: string;
  size: number;
  /** The file's bytes, as base64. */
  load: () => Promise<string>;
  onSave?: () => void;
  onOpen?: () => void;
};

export function AttachmentPreview({
  file,
  onClose,
}: {
  file: PreviewFile | null;
  onClose: () => void;
}) {
  const preview = file ? attachmentPreview(file.name, file.mimeType) : null;
  return (
    <Dialog open={file !== null && preview !== null} onOpenChange={(open) => !open && onClose()}>
      {file && preview ? (
        <DialogContent
          className="h-[85vh] max-w-5xl overflow-hidden bg-canvas!"
          initialFocus={false}
        >
          <PreviewSurface key={`${file.name}:${file.size}`} file={file} {...preview} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

type Loaded = {
  url: string;
  text: DecodedText | null;
  bytes: Uint8Array;
};

export function FilePreview({ file }: { file: PreviewFile }) {
  const preview = attachmentPreview(file.name, file.mimeType);
  if (!preview)
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        This file type can't be previewed.
      </div>
    );
  return <PreviewSurface key={`${file.name}:${file.size}`} file={file} inline {...preview} />;
}

function PreviewSurface({
  file,
  kind,
  mimeType,
  inline = false,
}: {
  file: PreviewFile;
  kind: PreviewKind;
  mimeType: string;
  inline?: boolean;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const toggles = kind === "markdown" || kind === "html" || kind === "table";
  const [find, setFind] = useState<number | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // A page rendered in its sandboxed frame keeps its text to itself.
  const findable = !MEDIA_KINDS.has(kind) && !(kind === "html" && rendered);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    // oxlint-disable-next-line react/set-state-in-effect -- Start an external attachment load with its loading state before the async result arrives.
    setLoaded(null);
    setError(null);
    void (async () => {
      try {
        const base64 = await file.load();
        if (cancelled) return;
        const bytes = bytesOfBase64(base64);
        // Text that isn't text fails here rather than showing garbled. A page
        // in another charset still renders; only its source can't be shown.
        let text: Loaded["text"] = null;
        if (kind === "html") text = decodeHtmlSource(bytes);
        else if (kind !== "pdf" && !MEDIA_KINDS.has(kind)) text = decodeText(bytes);
        url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        setLoaded({ url, text, bytes });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this file.");
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Re-run this DOM/reset lifecycle when its explicit trigger changes, even when the callback reads refs.
  }, [attempt, file, kind, mimeType]);

  const media = (message: string) => () => setError(message);
  const body = error ? (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm"
    >
      <p className="text-muted-foreground">{error}</p>
      <Button size="xs" onClick={() => setAttempt((n) => n + 1)}>
        Try again
      </Button>
    </div>
  ) : !loaded ? (
    <div className="flex flex-1 items-center justify-center">
      <Spinner aria-label="Loading file" className="size-5" />
    </div>
  ) : kind === "pdf" ? (
    <Suspense fallback={<div className="flex-1" />}>
      <PdfViewer data={loaded.bytes} name={file.name} />
    </Suspense>
  ) : kind === "html" && rendered ? (
    // Mail's HTML is untrusted: no scripts, forms or popups, and an opaque origin.
    <iframe
      src={loaded.url}
      title={file.name}
      sandbox=""
      className="min-h-0 flex-1 border-0 bg-white"
    />
  ) : kind === "image" ? (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      <img
        src={loaded.url}
        alt={file.name}
        className="max-h-full max-w-full object-contain"
        onError={media("Could not show this image.")}
      />
    </div>
  ) : kind === "video" ? (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
      <video
        controls
        autoPlay
        playsInline
        src={loaded.url}
        aria-label={file.name}
        className="max-h-full max-w-full"
        onError={media("Could not play this video.")}
      />
    </div>
  ) : kind === "audio" ? (
    <div className="flex flex-1 items-center justify-center p-6">
      <audio
        controls
        autoPlay
        src={loaded.url}
        aria-label={file.name}
        className="w-full max-w-md"
        onError={media("Could not play this audio.")}
      />
    </div>
  ) : kind === "table" && rendered && loaded.text ? (
    <DelimitedTable
      name={file.name}
      text={loaded.text.text}
      delimiter={mimeType === "text/csv" ? "," : "\t"}
    />
  ) : kind === "markdown" && rendered && loaded.text ? (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-5">
        <ChatMarkdown text={loaded.text.text} />
      </div>
    </div>
  ) : !loaded.text ? (
    <p className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
      This file is not UTF-8 text.
    </p>
  ) : (
    <pre className="min-h-0 flex-1 overflow-auto px-5 py-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground select-text">
      {loaded.text.text}
    </pre>
  );

  return (
    <div
      ref={surfaceRef}
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col outline-none"
      onKeyDown={(e) => {
        if (!findable || !isFindKey(e.nativeEvent)) return;
        e.preventDefault();
        e.stopPropagation();
        setFind((key) => (key ?? 0) + 1);
      }}
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 ps-4 pe-2">
        {inline ? (
          <span className="min-w-0 truncate text-sm font-medium">{file.name}</span>
        ) : (
          <DialogTitle className="min-w-0 truncate text-sm font-medium">{file.name}</DialogTitle>
        )}
        <span className="ms-1 shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatAttachmentSize(file.size)}
        </span>
        <span className="flex-1" />
        {toggles ? (
          <HintTooltip
            label={rendered ? "Show source" : kind === "table" ? "Show table" : "Show rendered"}
          >
            <IconButton
              label={rendered ? "Show source" : kind === "table" ? "Show table" : "Show rendered"}
              active={!rendered}
              onClick={() => setRendered((value) => !value)}
            >
              {!rendered ? (
                kind === "table" ? (
                  <Table2Icon className="size-4" />
                ) : (
                  <EyeIcon className="size-4" />
                )
              ) : (
                <Code2Icon className="size-4" />
              )}
            </IconButton>
          </HintTooltip>
        ) : null}
        {features.openFiles && file.onOpen ? (
          <HintTooltip label="Open in default app">
            <IconButton label="Open in default app" onClick={file.onOpen}>
              <AppWindowIcon className="size-4" />
            </IconButton>
          </HintTooltip>
        ) : null}
        {file.onSave ? (
          <HintTooltip label="Save…">
            <IconButton label="Save" onClick={file.onSave}>
              <DownloadIcon className="size-4" />
            </IconButton>
          </HintTooltip>
        ) : null}
        {inline ? null : (
          <HintTooltip label="Close">
            <DialogClose render={<IconButton label="Close" />}>
              <XIcon className="size-4" />
            </DialogClose>
          </HintTooltip>
        )}
      </div>
      {loaded?.text?.truncated && !(kind === "html" && rendered) ? (
        <div className="shrink-0 border-b border-border/60 px-4 py-1.5 text-xs text-muted-foreground">
          Showing the first 1 MB. Save the file to read all of it.
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
          {body}
        </div>
        {find !== null && findable && loaded ? (
          <div className="absolute top-3 right-3 z-10 w-72 max-w-[calc(100%-1.5rem)]">
            <DomFind
              root={bodyRef}
              label={`Find in ${file.name}`}
              focusKey={find}
              onClose={() => {
                setFind(null);
                surfaceRef.current?.focus();
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DelimitedTable({
  name,
  text,
  delimiter,
}: {
  name: string;
  text: string;
  delimiter: "," | "\t";
}) {
  const table = useMemo(() => parseDelimited(text, delimiter), [text, delimiter]);
  const [header, ...body] = table.rows;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {table.truncated ? (
        <div className="shrink-0 border-b border-border/60 px-4 py-1.5 text-xs text-muted-foreground">
          Showing the first 100 rows and 30 columns. Show the source for the rest.
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-xs" aria-label={name}>
          {header ? (
            <thead className="sticky top-0 z-10">
              <tr>
                {header.map((cell, column) => (
                  <th
                    key={column}
                    scope="col"
                    className="max-w-80 border-b border-border bg-secondary px-3 py-1.5 text-left align-bottom font-medium whitespace-pre-wrap break-words"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {body.map((row, index) => (
              <tr key={index} className="even:bg-foreground/[0.03]">
                {row.map((cell, column) => (
                  <td
                    key={column}
                    className="max-w-80 border-b border-border/60 px-3 py-1.5 align-top whitespace-pre-wrap break-words tabular-nums"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
