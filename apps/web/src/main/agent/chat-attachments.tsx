import {
  Children,
  useEffect,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  attachmentDetail,
  formatAttachmentSize,
  useChatAttachments,
  type AttachmentFiles,
  type DraftAttachment,
  type SentAttachment,
} from "@otter/client/agents/chat-attachments";
import { FileTextIcon, ImageIcon, PaperclipIcon, XIcon } from "lucide-react";
import { Spinner } from "@otter/ui/components/spinner";
import { cn } from "@otter/ui/lib/utils";

function thumbnail(url: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.addEventListener(
      "load",
      () => {
        const scale = Math.min(1, 240 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      },
      { once: true },
    );
    img.addEventListener("error", () => resolve(undefined), { once: true });
    img.src = url;
  });
}

const BROWSER_FILES: AttachmentFiles<File> = {
  bytes: async (file) => new Uint8Array(await file.arrayBuffer()),
  preview: (file) => URL.createObjectURL(file),
  release: (url) => URL.revokeObjectURL(url),
  thumbnail,
};

export const useComposerAttachments = () => useChatAttachments(BROWSER_FILES);

const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes("Files");
const movedWithin = (e: DragEvent) =>
  e.relatedTarget !== null && e.currentTarget.contains(e.relatedTarget as Node);

export function useFileDrop(onFiles: (files: File[]) => void) {
  const [active, setActive] = useState(false);
  // Cancelling a drag with Escape may never fire dragleave.
  useEffect(() => {
    const clear = () => setActive(false);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, []);
  return {
    active,
    handlers: {
      onDragEnter: (e: DragEvent) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        if (!movedWithin(e)) setActive(true);
      },
      onDragOver: (e: DragEvent) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setActive(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        if (!movedWithin(e)) setActive(false);
      },
      onDrop: (e: DragEvent) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setActive(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) onFiles(files);
      },
    },
  };
}

export function DropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-primary/[0.035]">
      <div
        role="status"
        className="flex items-center gap-2 rounded-pill border border-primary/25 bg-background/95 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg margin:shadow-none margin:border-overlay-edge margin:bg-popover"
      >
        <PaperclipIcon className="size-4 text-primary" aria-hidden />
        Drop files to attach
      </div>
    </div>
  );
}

/** T3 Code's paste rule: images (or files without text) attach; text pastes. */
export function filesFromPaste(data: DataTransfer): File[] {
  const files = Array.from(data.files);
  if (files.length === 0) return [];
  const text = data.getData("text/plain");
  if (files.some((f) => f.type.startsWith("image/"))) return files;
  return text ? [] : files;
}

export function AttachmentChip({
  tile,
  name,
  detail,
  title,
  pending,
  off,
  compact = false,
  onClick,
  onRemove,
}: {
  tile: ReactNode;
  name: string;
  detail?: string;
  title?: string;
  pending?: boolean;
  off?: boolean;
  compact?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onRemove?: () => void;
}) {
  return (
    <div
      title={title ?? name}
      className={cn(
        "group/attachment relative flex w-max min-w-0 shrink-0 items-center gap-2 border border-foreground/10 bg-card pl-1.5 pr-3 transition-opacity",
        compact ? "h-9 max-w-44 rounded-lg py-1 pl-1" : "h-11 max-w-60 rounded-xl py-1.5",
        off && "opacity-50",
      )}
    >
      {onClick ? (
        <button
          type="button"
          aria-pressed={!off}
          aria-label={name}
          onClick={onClick}
          className="absolute inset-0 z-10 cursor-pointer rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
        />
      ) : null}
      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden bg-foreground/[0.06] text-muted-foreground",
          compact ? "size-7 rounded-sm [&_svg]:size-3.5" : "size-8 rounded-lg [&_svg]:size-4",
        )}
      >
        {tile}
        {pending ? (
          <span className="absolute inset-0 flex items-center justify-center bg-card/70">
            <Spinner />
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cn("truncate text-body leading-4 text-foreground", off && "line-through")}>
          {name}
        </span>
        {detail ? (
          <span className="truncate text-2xs leading-4 text-muted-foreground">{detail}</span>
        ) : null}
      </span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="absolute -right-1.5 -top-1.5 z-20 flex size-4.5 cursor-pointer items-center justify-center rounded-full border border-foreground/10 bg-popover text-muted-foreground opacity-0 shadow-sm hover:text-foreground group-hover/attachment:opacity-100 focus-visible:opacity-100 margin:shadow-none"
        >
          <XIcon className="size-2.5" />
        </button>
      ) : null}
    </div>
  );
}

export function ComposerAttachments({
  items,
  onRemove,
  compact = false,
  children,
}: {
  items: DraftAttachment[];
  onRemove: (key: string) => void;
  compact?: boolean;
  children?: ReactNode;
}) {
  if (items.length === 0 && Children.toArray(children).length === 0) return null;
  return (
    <div
      className={cn(
        "flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        compact ? "px-2 pt-2" : "px-3 pt-3",
      )}
    >
      {children}
      {items.map((item) => (
        <AttachmentChip
          key={item.key}
          name={item.name}
          detail={attachmentDetail(item)}
          pending={!item.staged}
          compact={compact}
          onRemove={() => onRemove(item.key)}
          tile={
            item.kind === "image" && item.previewUrl ? (
              <img className="size-full object-cover" alt="" src={item.previewUrl} />
            ) : item.kind === "image" ? (
              <ImageIcon />
            ) : (
              <FileTextIcon />
            )
          }
        />
      ))}
    </div>
  );
}

/* oxlint-disable react/no-array-index-key -- Sent messages keep immutable attachment snapshots, including repeated filenames. */
export function SentAttachments({ attachments }: { attachments: SentAttachment[] }) {
  const images = attachments.filter((a) => a.kind === "image");
  const files = attachments.filter((a) => a.kind === "file");
  return (
    <>
      {images.length > 0 ? (
        <div
          className={cn(
            "mb-2 grid max-w-[210px] gap-2",
            images.length > 1 ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          {images.map((image, i) => (
            <div
              key={i}
              className="aspect-[4/3] overflow-hidden rounded-xl border border-border/60 bg-background/70"
              title={image.name}
            >
              {image.thumb ? (
                <img src={image.thumb} alt={image.name} className="block size-full object-cover" />
              ) : (
                <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-2xs text-faint-foreground">
                  {image.name}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="mb-2 flex flex-col gap-1">
          {files.map((file, i) => (
            <div key={i} className="flex min-w-0 items-center gap-2 py-0.5 text-sm">
              <FileTextIcon className="size-4 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs opacity-60">{formatAttachmentSize(file.size)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
/* oxlint-enable react/no-array-index-key */
