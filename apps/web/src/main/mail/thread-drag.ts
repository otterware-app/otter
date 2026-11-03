import { ALL_MAIL_LABEL_ID, ARCHIVE_LABEL_ID } from "./label-names";

export const THREAD_DRAG_MIME = "application/x-ottermail-threads";

export type ThreadDragPayload = {
  threads: { accountId: string; threadId: string }[];
  fromLabelId: string | null;
};

export function isThreadDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(THREAD_DRAG_MIME);
}

export function readThreadDrag(dataTransfer: DataTransfer): ThreadDragPayload | null {
  const raw = dataTransfer.getData(THREAD_DRAG_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ThreadDragPayload;
  } catch {
    return null;
  }
}

export function writeThreadDrag(dataTransfer: DataTransfer, payload: ThreadDragPayload): void {
  dataTransfer.setData(THREAD_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = "copyMove";
}

/** Whether moving to `targetLabelId` takes `labelId` off. SENT/DRAFT are
    immutable in Gmail and All Mail isn't a label, so those only gain one. */
export function isMoveSourceLabel(
  labelId: string | null,
  targetLabelId: string,
  foldersAndCategories = false,
): boolean {
  return (
    labelId != null &&
    labelId !== targetLabelId &&
    labelId !== "SENT" &&
    labelId !== "DRAFT" &&
    labelId !== ALL_MAIL_LABEL_ID &&
    (!foldersAndCategories ||
      (!targetLabelId.startsWith("category:") &&
        (labelId === "INBOX" ||
          labelId === ARCHIVE_LABEL_ID ||
          labelId === "SPAM" ||
          labelId === "TRASH" ||
          labelId.startsWith("folder:"))))
  );
}

export function setThreadDragImage(
  dataTransfer: DataTransfer,
  preview: { title: string; subtitle?: string },
): void {
  const el = document.createElement("div");
  el.className =
    "dropdown-glass fixed -top-96 left-0 flex max-w-56 flex-col rounded-lg px-2.5 py-1 text-xs text-foreground";
  const title = document.createElement("span");
  title.className = "truncate font-medium";
  title.textContent = preview.title;
  el.appendChild(title);
  if (preview.subtitle) {
    const subtitle = document.createElement("span");
    subtitle.className = "truncate text-muted-foreground";
    subtitle.textContent = preview.subtitle;
    el.appendChild(subtitle);
  }
  document.body.appendChild(el);
  dataTransfer.setDragImage(el, -8, -8);
  setTimeout(() => el.remove(), 0);
}
