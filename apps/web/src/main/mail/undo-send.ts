import { toast } from "./toast";
import { forgetUndo, registerUndo, type UndoAction } from "./undo";

export const UNDO_SEND_MS = 10_000;

export type SavedDraft = { accountId: string; messageId: string };

let openDraft: (draft: SavedDraft) => void = () => {};

export function setDraftOpener(open: (draft: SavedDraft) => void): () => void {
  openDraft = open;
  return () => {
    if (openDraft === open) openDraft = () => {};
  };
}

export function sendWithUndo({
  subject,
  send,
  onSent,
  savedDraft,
}: {
  subject: string;
  send: () => Promise<unknown>;
  onSent?: () => Promise<unknown> | void;
  savedDraft: () => Promise<SavedDraft | null>;
}): void {
  let state: "waiting" | "sending" | "cancelled" = "waiting";
  const description = subject.trim() || "(no subject)";

  const cancel = () => {
    if (state !== "waiting") return;
    state = "cancelled";
    clearTimeout(timer);
    forgetUndo(undoEntry);
    toast.close(toastId);
    console.log("[undoSend:cancelled]", { subject: description });
    void savedDraft().then((draft) => {
      if (draft) {
        openDraft(draft);
        toast.info("Sending undone", { description: "The message is back in the composer." });
      } else {
        toast.info("Sending undone", { description: "The message was kept in Drafts." });
      }
    });
  };

  const undoEntry: UndoAction = { kind: "callback", run: cancel };
  const toastId = toast.loading("Sending…", {
    description,
    action: { label: "Undo", onClick: cancel },
  });
  registerUndo(undoEntry);

  const timer = setTimeout(() => {
    if (state !== "waiting") return;
    state = "sending";
    forgetUndo(undoEntry);
    toast.update(toastId, "loading", "Sending…", { description, timeout: 0 });
    console.log("[undoSend:sending]", { subject: description });
    send().then(
      async () => {
        await onSent?.();
        toast.update(toastId, "success", "Sent", { description });
      },
      () => toast.update(toastId, "error", `Couldn't send “${description}” — kept in Drafts`),
    );
  }, UNDO_SEND_MS);
}
