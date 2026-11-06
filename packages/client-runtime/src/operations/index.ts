import type { CoreBridge } from "../connection/index.ts";
import type { ThreadLists, OverlayTransform } from "../state/messages.ts";
import {
  inThread,
  messageChange,
  threadChange,
  without,
  type ModifyMessageParams,
  type ModifyThreadParams,
} from "./labels.ts";
import {
  beginUndoGroup,
  isPureMarkRead,
  registerRedo,
  registerUndo,
  takeUndo,
  type ActionSummary,
  type UndoAction,
} from "./undo.ts";

export * from "./archive.ts";
export * from "./labels.ts";
export * from "./summary.ts";
export * from "./undo.ts";
export * from "./undo-send.ts";

/** The bridge's own budget: a write past it finishes in core's background, so it's kept. */
export const isIpcTimeout = (error: unknown): boolean =>
  /Request timeout/i.test(error instanceof Error ? error.message : String(error));

export interface MailOperationsOptions {
  core: CoreBridge;
  threadLists: ThreadLists;
  /** The mailbox keeps archived mail in a folder (Outlook, IMAP). */
  archiveFolder(accountId: string): boolean | undefined;
  /** How a label change reads in its toast ("Archived", "Moved to “Receipts”"). */
  summarize?(
    params: ModifyThreadParams | ModifyMessageParams,
    noun: ActionSummary["noun"],
  ): ActionSummary | undefined;
  onError(error: unknown): void;
}

export type MailOperations = ReturnType<typeof makeMailOperations>;

/**
 * Mail writes as one step each: the thread lists change at once (an
 * overlay), core writes, and the overlay either stays until the lists load
 * again or goes if the write failed. Each registers its undo; `undo()` runs
 * the last one back, quietly, and keeps it for redo.
 */
export function makeMailOperations(options: MailOperationsOptions) {
  const { core, threadLists } = options;

  async function write(
    accountId: string,
    transform: OverlayTransform,
    run: () => Promise<unknown>,
  ): Promise<void> {
    const overlay = threadLists.overlay(accountId, transform);
    try {
      await run();
      overlay.settle();
    } catch (error) {
      if (isIpcTimeout(error)) return overlay.settle();
      overlay.drop();
      options.onError(error);
      throw error;
    }
  }

  const quietly = { quiet: true };
  type Options = { quiet?: boolean };

  function modifyThread(params: ModifyThreadParams, { quiet = false }: Options = {}) {
    const { accountId, threadId, addLabelIds = [], removeLabelIds = [] } = params;
    if (!quiet && !isPureMarkRead(addLabelIds, removeLabelIds)) {
      registerUndo(
        {
          kind: "modifyThread",
          params: { accountId, threadId, addLabelIds: removeLabelIds, removeLabelIds: addLabelIds },
        },
        options.summarize?.(params, "conversation"),
      );
    }
    return write(accountId, threadChange(params, options.archiveFolder(accountId)), () =>
      core.invoke("gmail:modifyThread", params),
    );
  }

  function modifyMessage(params: ModifyMessageParams, { quiet = false }: Options = {}) {
    const { accountId, messageId, addLabelIds = [], removeLabelIds = [] } = params;
    if (!quiet && !isPureMarkRead(addLabelIds, removeLabelIds)) {
      registerUndo(
        {
          kind: "modifyMessage",
          params: {
            accountId,
            messageId,
            addLabelIds: removeLabelIds,
            removeLabelIds: addLabelIds,
          },
        },
        options.summarize?.(params, "message"),
      );
    }
    return write(accountId, messageChange(params, options.archiveFolder(accountId)), () =>
      core.invoke("gmail:modifyMessage", params),
    );
  }

  function trashThread(accountId: string, threadId: string, { quiet = false }: Options = {}) {
    if (!quiet)
      registerUndo(
        { kind: "untrashThread", params: { accountId, threadId } },
        { verb: "Moved", suffix: " to Trash", noun: "conversation" },
      );
    return write(accountId, without(inThread(accountId, threadId)), () =>
      core.invoke("gmail:trashThread", { accountId, threadId }),
    );
  }

  function trashMessage(accountId: string, messageId: string, { quiet = false }: Options = {}) {
    if (!quiet)
      registerUndo(
        { kind: "untrashMessage", params: { accountId, messageId } },
        { verb: "Moved", suffix: " to Trash", noun: "message" },
      );
    return write(
      accountId,
      without((m) => m.id === messageId),
      () => core.invoke("gmail:trashMessage", { accountId, messageId }),
    );
  }

  async function untrash(accountId: string, channel: string, params: object): Promise<void> {
    try {
      await core.invoke(channel, params);
    } catch (error) {
      if (!isIpcTimeout(error)) {
        options.onError(error);
        throw error;
      }
    }
    threadLists.invalidate(accountId);
  }

  /** Archive from the list it's in: Inbox, or the folder a folder mailbox keeps it in. */
  const archiveThread = (accountId: string, threadId: string, from: string) =>
    modifyThread({ accountId, threadId, removeLabelIds: [from] });

  function run(action: UndoAction, options: Options): Promise<unknown> {
    switch (action.kind) {
      case "modifyMessage":
        return modifyMessage(action.params, options);
      case "modifyThread":
        return modifyThread(action.params, options);
      case "untrashThread":
        return untrash(action.params.accountId, "gmail:untrashThread", action.params);
      case "untrashMessage":
        return untrash(action.params.accountId, "gmail:untrashMessage", action.params);
      case "trashThread":
        return trashThread(action.params.accountId, action.params.threadId, options);
      case "trashMessage":
        return trashMessage(action.params.accountId, action.params.messageId, options);
      case "callback":
        action.run();
        return Promise.resolve();
      case "batch":
        if (!options.quiet) beginUndoGroup(action.actions.length);
        return Promise.all(action.actions.map((a) => run(a, options)));
    }
  }

  /** Undoes the last action (or `action`, from its toast); false when there's none. */
  async function undo(action: UndoAction | null = takeUndo()): Promise<boolean> {
    if (!action) return false;
    await run(action, quietly);
    registerRedo(action);
    return true;
  }

  return {
    modifyThread,
    modifyMessage,
    archiveThread,
    trashThread,
    trashMessage,
    untrashThread: (accountId: string, threadId: string) =>
      untrash(accountId, "gmail:untrashThread", { accountId, threadId }),
    untrashMessage: (accountId: string, messageId: string) =>
      untrash(accountId, "gmail:untrashMessage", { accountId, messageId }),
    /** Runs an action again (a redo): it registers its own undo and announces itself. */
    redo: (action: UndoAction) => run(action, {}),
    undo,
  };
}
