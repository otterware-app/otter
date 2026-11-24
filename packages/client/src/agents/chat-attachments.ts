import { useEffect, useState } from "react";
import { host } from "../host.ts";
import { useLatest } from "../use-latest.ts";
import { agentApi, type ChatAttachment } from "./api.ts";

export type SentAttachment = { name: string; kind: "image" | "file"; size: number; thumb?: string };

export function formatAttachmentSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

const IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const IMAGE_EXTENSIONS = /\.(gif|jpe?g|png|webp)$/i;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

/** A file picked, pasted or dropped: what the composer knows of it before reading it. */
export type PickedFile = { name: string; type: string; size: number };

/** An image the agent can see: GIF, JPEG, PNG or WebP, by its type or, without one, its name. */
export function isImage(file: PickedFile): boolean {
  return (
    IMAGE_TYPES.has(file.type) ||
    ((!file.type || file.type === "application/octet-stream") && IMAGE_EXTENSIONS.test(file.name))
  );
}

/** Why a file can't be attached, or null when it can. */
export function attachmentProblem(file: PickedFile): string | null {
  const image = isImage(file);
  if (!image && file.type.startsWith("image/") && !/heic|heif/i.test(file.type))
    return `'${file.name}' is not a supported image type. Attach GIF, JPEG, PNG, or WebP images.`;
  if (file.size === 0) return `'${file.name}' is empty or could not be read.`;
  const limit = image ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
  if (file.size > limit)
    return `'${file.name}' exceeds the ${limit / 1024 / 1024} MB attachment limit.`;
  return null;
}

/** A file's extension as its chip shows it ("PDF"), or "File". */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1, dot + 6).toUpperCase() : "File";
}

export type DraftAttachment = {
  key: string;
  name: string;
  kind: "image" | "file";
  size: number;
  /** The app's picture of the image while it's in the composer. */
  previewUrl?: string;
  /** A small JPEG of the image, as a data URL, kept with the sent message. */
  thumb?: string;
  /** Once staged with core: what the message sends. */
  staged?: ChatAttachment;
};

/** What a draft attachment's chip says under its name. */
export const attachmentDetail = (item: DraftAttachment) =>
  item.kind === "image"
    ? "Image"
    : `${extensionOf(item.name)} · ${formatAttachmentSize(item.size)}`;

/** What the composer asks of the app for the files it attaches. */
export type AttachmentFiles<F extends PickedFile> = {
  bytes(file: F): Promise<Uint8Array>;
  /** A picture of an image to show while it's in the composer, which `release` frees. */
  preview?(file: F): string;
  release?(url: string): void;
  thumbnail?(url: string): Promise<string | undefined>;
};

/** The files a message attaches, staged with core as they're added (10 at most). */
export function useChatAttachments<F extends PickedFile>(files: AttachmentFiles<F>) {
  const [items, setItems] = useState<DraftAttachment[]>([]);
  const itemsRef = useLatest(items);
  const io = useLatest(files);
  const fail = (title: string) => host().notice({ tone: "error", title });
  const release = (item: DraftAttachment | undefined) => {
    if (item?.previewUrl) io.current.release?.(item.previewUrl);
  };

  useEffect(
    () => () => {
      for (const item of itemsRef.current)
        if (item.previewUrl) io.current.release?.(item.previewUrl);
    },
    [itemsRef, io],
  );

  const add = async (picked: F[]) => {
    const room = MAX_ATTACHMENTS - itemsRef.current.length;
    if (picked.length > room) {
      fail(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
      picked = picked.slice(0, Math.max(0, room));
    }
    for (const file of picked) {
      const problem = attachmentProblem(file);
      if (problem) {
        fail(problem);
        continue;
      }
      const image = isImage(file);
      const key = crypto.randomUUID();
      const previewUrl = image ? io.current.preview?.(file) : undefined;
      const name = file.name || (image ? "Pasted image.png" : "Attachment");
      setItems((list) => [
        ...list,
        { key, name, kind: image ? "image" : "file", size: file.size, previewUrl },
      ]);
      void (async () => {
        try {
          const item = {
            name,
            mime: file.type || "application/octet-stream",
            bytes: await io.current.bytes(file),
          };
          const [thumb, result] = await Promise.all([
            previewUrl ? io.current.thumbnail?.(previewUrl) : Promise.resolve(undefined),
            agentApi.stageAttachments([item]),
          ]);
          const staged = result.attachments[0];
          if (!staged) throw new Error(result.errors[0] ?? `'${name}' could not be attached.`);
          setItems((list) => list.map((a) => (a.key === key ? { ...a, staged, thumb } : a)));
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
          setItems((list) => list.filter((a) => a.key !== key));
          if (previewUrl) io.current.release?.(previewUrl);
        }
      })();
    }
  };

  const remove = (key: string) =>
    setItems((list) => {
      release(list.find((a) => a.key === key));
      return list.filter((a) => a.key !== key);
    });

  /** Empties the composer of them: what's staged goes with the message. */
  const take = (): { staged: ChatAttachment[]; sent: SentAttachment[] } => {
    const ready = itemsRef.current.filter((a) => a.staged);
    for (const item of itemsRef.current) release(item);
    setItems([]);
    return {
      staged: ready.map((a) => a.staged!),
      sent: ready.map((a) => ({ name: a.name, kind: a.kind, size: a.size, thumb: a.thumb })),
    };
  };

  return {
    items,
    add,
    remove,
    take,
    staging: items.some((a) => !a.staged),
    count: items.length,
  };
}
