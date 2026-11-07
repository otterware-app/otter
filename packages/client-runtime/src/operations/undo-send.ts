import { forgetUndo, registerUndo, type UndoAction } from "./undo.ts";

export const UNDO_SEND_MS = 10_000;

export const MAY_HAVE_BEEN_SENT = "May have been sent — check Sent before sending again.";

export type SavedDraft = { accountId: string; messageId: string };

/** How the app shows a send held back for Undo (a toast in a window). */
export interface SendNotices {
  /** "Sending…", with Undo; `description` is the subject. */
  waiting(description: string, undo: () => void): SendNotice;
  /** Undone: back in the composer (`reopened`), or kept in Drafts. */
  undone(reopened: boolean): void;
}

export interface SendNotice {
  sending(): void;
  sent(uncertain: boolean): void;
  failed(openDraft: () => void): void;
  close(): void;
}

/**
 * Holds a send back for UNDO_SEND_MS: until then Undo (or z) reopens the
 * draft instead; after, it sends and says how that went.
 */
export function sendWithUndo({
  subject,
  send,
  onSent,
  savedDraft,
  openDraft,
  notices,
  log,
}: {
  subject: string;
  send: () => Promise<{ uncertain?: boolean }>;
  onSent?: () => Promise<unknown> | void;
  savedDraft: () => Promise<SavedDraft | null>;
  openDraft: (draft: SavedDraft) => void;
  notices: SendNotices;
  log?: (event: string, data: Record<string, unknown>) => void;
}): void {
  let state: "waiting" | "sending" | "cancelled" = "waiting";
  const description = subject.trim() || "(no subject)";

  const cancel = () => {
    if (state !== "waiting") return;
    state = "cancelled";
    clearTimeout(timer);
    forgetUndo(undoEntry);
    notice.close();
    log?.("cancelled", { subject: description });
    void savedDraft().then((draft) => {
      if (draft) openDraft(draft);
      notices.undone(draft !== null);
    });
  };

  const undoEntry: UndoAction = { kind: "callback", run: cancel };
  const notice = notices.waiting(description, cancel);
  registerUndo(undoEntry);

  const timer = setTimeout(() => {
    if (state !== "waiting") return;
    state = "sending";
    forgetUndo(undoEntry);
    notice.sending();
    log?.("sending", { subject: description });
    send().then(
      async (result) => {
        await onSent?.();
        notice.sent(Boolean(result.uncertain));
      },
      () =>
        notice.failed(
          () =>
            void savedDraft().then((draft) => {
              if (draft) openDraft(draft);
            }),
        ),
    );
  }, UNDO_SEND_MS);
}
