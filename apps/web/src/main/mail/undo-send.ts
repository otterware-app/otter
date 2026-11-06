import {
  MAY_HAVE_BEEN_SENT,
  sendWithUndo as send,
  type SavedDraft,
} from "@otter-mail/client-runtime/operations";

import { toast } from "./toast";

export {
  MAY_HAVE_BEEN_SENT,
  UNDO_SEND_MS,
  type SavedDraft,
} from "@otter-mail/client-runtime/operations";

let openDraft: (draft: SavedDraft) => void = () => {};

export function setDraftOpener(open: (draft: SavedDraft) => void): () => void {
  openDraft = open;
  return () => {
    if (openDraft === open) openDraft = () => {};
  };
}

export function sendWithUndo(options: {
  subject: string;
  send: () => Promise<{ uncertain?: boolean }>;
  onSent?: () => Promise<unknown> | void;
  savedDraft: () => Promise<SavedDraft | null>;
}): void {
  send({
    ...options,
    openDraft: (draft) => openDraft(draft),
    log: (event, data) => console.log(`[undoSend:${event}]`, data),
    notices: {
      waiting(description, undo) {
        const id = toast.loading("Sending…", {
          description,
          action: { label: "Undo", onClick: undo },
        });
        return {
          sending: () => toast.update(id, "loading", "Sending…", { description, timeout: 0 }),
          sent: (uncertain) =>
            uncertain
              ? toast.update(id, "warning", MAY_HAVE_BEEN_SENT, { description, timeout: 0 })
              : toast.update(id, "success", "Sent", { description }),
          failed: (reopen) =>
            toast.update(id, "error", `Couldn't send “${description}” — kept in Drafts`, {
              timeout: 0,
              action: { label: "Open draft", onClick: reopen },
            }),
          close: () => toast.close(id),
        };
      },
      undone: (reopened) =>
        toast.info("Sending undone", {
          description: reopened
            ? "The message is back in the composer."
            : "The message was kept in Drafts.",
        }),
    },
  });
}
