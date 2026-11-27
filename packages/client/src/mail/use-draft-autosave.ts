import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { host } from "../host.ts";
import { useHandlers, useLatest } from "../use-latest.ts";
import { mailApi } from "./api.ts";
import type { ComposeAttachment, MessageDetail } from "./types.ts";

export type DraftSaveState = "idle" | "saving" | "saved" | "error";

export type DraftRemoteState = { kind: "conflict"; detail: MessageDetail } | { kind: "gone" };

export type DraftAnchor = {
  sessionKey: string;
  draftId: string | null;
  messageId: string | null;
  revision: string | null;
  threadId?: string;
};

const REMOTE_CHECK_MS = 10_000;
const REMOTE_NOTICE_MS = 4_000;

// Refresh lists after editing ends: saving a Gmail draft changes its message id.
// An unresolved remote conflict saves local text as a new draft rather than overwriting either version.
export function useDraftAutosave({
  accountId,
  threadId,
  signal,
  getPayload,
  delayMs = 1500,
  enabled = true,
  seeded = false,
  initialDraftId,
  initialMessageId,
  initialRevision,
  initialGone,
  initialDirty = false,
  initialSessionKey,
  autosave = true,
  onRemoteChange,
}: {
  accountId: string | null;
  threadId?: string;
  delayMs?: number;
  signal: string;
  getPayload: () => {
    from?: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body: string;
    bodyHtml: string;
    attachments?: ComposeAttachment[];
  } | null;
  enabled?: boolean;
  seeded?: boolean;
  initialDraftId?: string | null;
  initialMessageId?: string;
  initialRevision?: string;
  initialGone?: boolean;
  initialDirty?: boolean;
  initialSessionKey?: string;
  autosave?: boolean;
  onRemoteChange?: (detail: MessageDetail) => void | Promise<void>;
}) {
  const qc = useQueryClient();
  const [saveState, setSaveState] = useState<DraftSaveState>("idle");
  const [remote, setRemote] = useState<DraftRemoteState | null>(null);
  const [remoteNotice, setRemoteNotice] = useState(false);

  const draftIdRef = useRef<string | null>(initialDraftId ?? null);
  const draftAccountRef = useRef<string | null>(initialDraftId ? accountId : null);
  const versionRef = useRef<string | null>(initialRevision ?? initialMessageId ?? null);
  const messageIdRef = useRef<string | null>(initialMessageId ?? null);
  // Thread Gmail assigned on the first save. Without pinning it, every update
  // re-threads the draft — a new list row per save until sync reconciles.
  const adoptedThreadRef = useRef<string | null>(null);
  const doneRef = useRef(false);
  const savingRef = useRef(false);
  const unmountedRef = useRef(false);
  const pausedRef = useRef(!enabled);
  const remoteRef = useLatest(remote);
  const [sessionKey] = useState(() => initialSessionKey ?? crypto.randomUUID());
  const snapshotRef = useRef(initialDirty ? "" : signal);

  const signalRef = useLatest(signal);
  const accountRef = useLatest(accountId);
  const threadRef = useLatest(threadId);
  const getPayloadRef = useLatest(getPayload);
  const onRemoteChangeRef = useLatest(onRemoteChange);
  const autosaveRef = useLatest(autosave);

  useEffect(() => {
    if (initialDraftId && !draftIdRef.current) {
      draftIdRef.current = initialDraftId;
      draftAccountRef.current = accountRef.current;
    }
  }, [initialDraftId, accountRef]);

  /**
   * Treats whatever the composer shows a moment from now as already saved:
   * after it seeds itself (editor, signature) or loads another version, those
   * state updates must not look like edits and trigger a save.
   */
  const adoptingRef = useRef(false);
  const adoptCurrentSoon = () => {
    adoptingRef.current = true;
    setTimeout(() => {
      snapshotRef.current = signalRef.current;
      adoptingRef.current = false;
    }, 300);
  };

  const adoptCurrentSoonForEffect = useLatest(adoptCurrentSoon);
  useEffect(() => {
    if (!enabled) return;
    if (!seeded) adoptCurrentSoonForEffect.current();
    pausedRef.current = remoteRef.current != null;
  }, [enabled, seeded, adoptCurrentSoonForEffect, remoteRef]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["gmail:messages"] });
    void qc.invalidateQueries({ queryKey: ["gmail:combinedMessages"] });
    void qc.invalidateQueries({ queryKey: ["gmail:combinedCounts"] });
    void qc.invalidateQueries({ queryKey: ["gmail:thread"] });
    void qc.invalidateQueries({ queryKey: ["gmail:labels"] });
  };
  const refreshRef = useLatest(refresh);

  const applyVersion = async (detail: MessageDetail) => {
    pausedRef.current = true;
    try {
      await onRemoteChangeRef.current?.(detail);
      versionRef.current = detail.draftRevision ?? detail.id;
      messageIdRef.current = detail.id;
      adoptCurrentSoon();
    } finally {
      pausedRef.current = false;
    }
  };

  const handleRemoteVersion = async (messageId: string) => {
    const account = accountRef.current;
    const draftId = draftIdRef.current;
    if (!account || !draftId) return;
    pausedRef.current = true;
    try {
      const detail = await mailApi.loadDraftVersion(account, draftId, messageId);
      const dirty = signalRef.current !== snapshotRef.current;
      console.log("[useDraftAutosave:remoteChange]", { draftId, dirty });
      if (dirty) {
        setRemote({ kind: "conflict", detail });
        return;
      }
      await applyVersion(detail);
      setRemoteNotice(true);
      setTimeout(() => setRemoteNotice(false), REMOTE_NOTICE_MS);
    } catch (err) {
      console.log("[useDraftAutosave:remoteLoadFailed]", { error: String(err) });
      pausedRef.current = remoteRef.current != null;
    }
  };

  const markGone = () => {
    console.log("[useDraftAutosave:gone]", { draftId: draftIdRef.current });
    pausedRef.current = true;
    setRemote({ kind: "gone" });
  };

  const save = async () => {
    const account = accountRef.current;
    if (!account || doneRef.current || savingRef.current || pausedRef.current) return;
    if (adoptingRef.current || signalRef.current === snapshotRef.current) return;
    const payload = getPayloadRef.current();
    if (!payload) return;
    const snapshotAtSave = signalRef.current;
    savingRef.current = true;
    setSaveState("saving");
    try {
      if (draftIdRef.current && draftAccountRef.current && draftAccountRef.current !== account) {
        try {
          await mailApi.deleteDraft(draftAccountRef.current, draftIdRef.current);
        } catch {
          // orphan gets reconciled by sync
        }
        draftIdRef.current = null;
        versionRef.current = null;
        messageIdRef.current = null;
        adoptedThreadRef.current = null;
      }
      const res = await mailApi.saveDraft({
        accountId: account,
        draftId: draftIdRef.current ?? undefined,
        sessionKey,
        expectMessageId: draftIdRef.current ? (messageIdRef.current ?? undefined) : undefined,
        expectRevision: draftIdRef.current ? (versionRef.current ?? undefined) : undefined,
        ...payload,
        threadId: threadRef.current ?? adoptedThreadRef.current ?? undefined,
      });
      if ("gone" in res) {
        setSaveState("idle");
        markGone();
        return;
      }
      if ("conflict" in res) {
        setSaveState("idle");
        await handleRemoteVersion(res.messageId);
        return;
      }
      draftIdRef.current = res.draftId;
      draftAccountRef.current = account;
      if (res.messageId) {
        messageIdRef.current = res.messageId;
        versionRef.current = res.revision ?? res.messageId;
      }
      if (!threadRef.current && res.threadId) adoptedThreadRef.current = res.threadId;
      snapshotRef.current = snapshotAtSave;
      setSaveState("saved");
    } catch (err) {
      console.log("[useDraftAutosave:saveFailed]", { error: String(err) });
      setSaveState("error");
      // Retry while the composer is open; a closed one's last save carries on
      // in the backend (same session, so no duplicate draft).
      if (!unmountedRef.current && autosaveRef.current) setTimeout(() => void trigger(), 5000);
    } finally {
      savingRef.current = false;
    }
  };
  const latest = useHandlers({ save });
  // finalize awaits the unmount flush through it before deleting (the send
  // path closes the composer first, optimistically).
  const [saves] = useState(() => draftSaveQueue(latest.save));
  const trigger = saves.trigger;

  useEffect(() => {
    if (!autosave) return;
    const timer = setTimeout(() => void trigger(), delayMs);
    return () => clearTimeout(timer);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Re-run this DOM/reset lifecycle when its explicit trigger changes, even when the callback reads refs.
  }, [signal, delayMs, trigger, autosave]);

  const handleRemoteVersionForEffect = useLatest(handleRemoteVersion);
  const markGoneForEffect = useLatest(markGone);
  useEffect(() => {
    if (initialGone) markGoneForEffect.current();
  }, [initialGone, markGoneForEffect]);
  useEffect(() => {
    const check = async () => {
      const account = accountRef.current;
      const draftId = draftIdRef.current;
      if (!account || !draftId || !versionRef.current) return;
      if (doneRef.current || pausedRef.current || savingRef.current) return;
      if (!host().focused()) return;
      try {
        const { messageId, revision } = await mailApi.getDraftVersion(account, draftId);
        if (doneRef.current || savingRef.current || pausedRef.current) return;
        if (messageId === null) markGoneForEffect.current();
        else if ((revision ?? messageId) !== versionRef.current)
          await handleRemoteVersionForEffect.current(messageId);
      } catch (err) {
        console.log("[useDraftAutosave:checkFailed]", { error: String(err) });
      }
    };
    const timer = setInterval(() => void check(), REMOTE_CHECK_MS);
    const offFocus = host().onFocusChange(() => void check());
    return () => {
      clearInterval(timer);
      offFocus();
    };
  }, [accountRef, handleRemoteVersionForEffect, markGoneForEffect]);

  // Flush the last edits and refresh the lists once, on the way out. With an
  // unresolved conflict (or the draft gone), the user's text is kept as a new
  // draft instead of overwriting the other version.
  useEffect(
    () => () => {
      unmountedRef.current = true;
      if (!autosaveRef.current) {
        refreshRef.current();
        return;
      }
      if (remoteRef.current) {
        draftIdRef.current = null;
        versionRef.current = null;
        messageIdRef.current = null;
        pausedRef.current = false;
      }
      void trigger().finally(() => refreshRef.current());
    },
    [refreshRef, remoteRef, trigger, autosaveRef],
  );

  const takeTheirs = () => {
    const current = remoteRef.current;
    if (current?.kind !== "conflict") return;
    setRemote(null);
    void applyVersion(current.detail);
  };

  const keepMine = () => {
    const current = remoteRef.current;
    if (current?.kind !== "conflict") return;
    versionRef.current = current.detail.draftRevision ?? current.detail.id;
    messageIdRef.current = current.detail.id;
    setRemote(null);
    pausedRef.current = false;
    void trigger();
  };

  const saveAsNew = () => {
    draftIdRef.current = null;
    versionRef.current = null;
    messageIdRef.current = null;
    snapshotRef.current = "";
    setRemote(null);
    pausedRef.current = false;
    void trigger();
  };

  const flush = async () => {
    await trigger();
    return signalRef.current === snapshotRef.current && remoteRef.current === null;
  };

  const finalize = async (opts?: { deleteDraft?: boolean }) => {
    doneRef.current = true;
    await saves.pending();
    // Delete by id, or through the session: the backend waits for any save
    // still in flight and removes whatever draft it became.
    const account = draftAccountRef.current ?? accountRef.current;
    if (opts?.deleteDraft && account) {
      try {
        await mailApi.deleteSessionDraft(account, sessionKey, draftIdRef.current ?? undefined);
      } catch {
        // sync reconciles leftovers
      }
      draftIdRef.current = null;
    }
    refreshRef.current();
  };

  const savedDraft = async (): Promise<{ accountId: string; messageId: string } | null> => {
    await saves.pending();
    for (let i = 0; i < 100 && savingRef.current; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const account = draftAccountRef.current;
    const draftId = draftIdRef.current;
    // Sending may have saved it again since (a new message id): ask for its current version.
    const current =
      account && draftId ? await mailApi.getDraftVersion(account, draftId).catch(() => null) : null;
    const messageId = current?.messageId ?? messageIdRef.current;
    return account && messageId ? { accountId: account, messageId } : null;
  };

  /** What sending needs to send the draft itself: the backend knows the session's draft. */
  const sending = (accountId: string) => ({
    sessionKey,
    draftId: draftAccountRef.current === accountId ? (draftIdRef.current ?? undefined) : undefined,
  });

  const anchor = (account: string): DraftAnchor => ({
    sessionKey,
    draftId: draftAccountRef.current === account ? draftIdRef.current : null,
    messageId: draftAccountRef.current === account ? messageIdRef.current : null,
    revision: draftAccountRef.current === account ? versionRef.current : null,
    threadId: threadRef.current ?? adoptedThreadRef.current ?? undefined,
  });

  const reopen = () => {
    doneRef.current = false;
  };

  return {
    saveState,
    remote,
    remoteNotice,
    takeTheirs,
    keepMine,
    saveAsNew,
    finalize,
    flush,
    savedDraft,
    sending,
    reopen,
    anchor,
    isSaved: () => signalRef.current === snapshotRef.current,
  };
}

export function draftStatus(draft: {
  saveState: DraftSaveState;
  remoteNotice: boolean;
}): string | null {
  if (draft.remoteNotice) return "Updated elsewhere";
  return draftStatusText(draft.saveState);
}

export function draftStatusText(state: DraftSaveState): string | null {
  if (state === "saving") return "Saving draft…";
  if (state === "saved") return "Draft saved";
  if (state === "error") return "Couldn't save draft. Retrying…";
  return null;
}

/**
 * One save at a time. A save asked for while one is in flight runs once that one finishes, and
 * the promise handed back settles only after it: what was typed meanwhile is saved too.
 */
export function draftSaveQueue(save: () => Promise<void>) {
  let pending: Promise<void> | null = null;
  let again = false;
  const run = async () => {
    try {
      do {
        again = false;
        await save();
      } while (again);
    } finally {
      pending = null;
    }
  };
  return {
    trigger(): Promise<void> {
      if (pending) {
        again = true;
        return pending;
      }
      pending = run();
      return pending;
    },
    pending: () => pending,
  };
}
