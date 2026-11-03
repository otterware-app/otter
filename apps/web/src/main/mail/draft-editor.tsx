import { useLatest } from "../use-latest";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { sendWithUndo } from "./undo-send";
import { toast } from "./toast";
import { useQuery } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { useAccounts, useGetAttachment, usePruneThreadRows, useSendMessage } from "./hooks";
import { mailApi } from "./api";
import { RichTextArea, textToHtml, type RichTextRef } from "./rich-text";
import { RecipientInput } from "./recipient-input";
import { FromPicker } from "./new-message-view";
import { addressesOf, chosenAddress } from "./send-from";
import { useDraftAutosave } from "./use-draft-autosave";
import { IconBtn, HintTooltip } from "./ui";
import { normalizeAddressList, parseAddressEntry, splitAddressList } from "./address";
import {
  CcBccToggles,
  ComposeDocument,
  ComposerCard,
  ComposerField,
  ComposerFooter,
  SubjectInput,
  DraftRemoteBanner,
  draftStatus,
} from "./composer-kit";
import {
  CollapsedRow,
  DayDivider,
  ExpandedRow,
  dayKey,
  type DownloadAttachment,
} from "./message-reader";
import {
  AttachmentChips,
  ComposeDropOverlay,
  attachmentSignature,
  autosaveDelayMs,
  filesToComposeAttachments,
  pickComposeAttachments,
  useComposeFileDrop,
  loadMessageAttachments,
} from "./compose-attachments";
import type { ComposeAttachment, MessageDetail, MessageSummary } from "./types";

export function DraftEditor({
  accountId,
  detail,
  threadMessages,
  autoFocus = true,
  onDone,
  titleTrailing,
  titleLeading,
}: {
  accountId: string;
  detail: MessageDetail;
  threadMessages: MessageSummary[];
  autoFocus?: boolean;
  onDone: () => void;
  titleTrailing?: ReactNode;
  titleLeading?: ReactNode;
}) {
  const account = useAccounts().data?.find((a) => a.id === accountId);
  // The draft keeps the address it was written from. One the mailbox no longer sends from stays
  // (sending refuses it) until another is picked: never quietly swapped for the mailbox's own.
  const [pickedAddress, setPickedAddress] = useState(detail.fromEmail);
  const sender = account ? chosenAddress(account, pickedAddress, account.email) : undefined;
  const fromAddress = sender?.address;
  const fromUnavailable = !!sender?.unavailable;
  const [to, setTo] = useState(detail.to ?? "");
  const [cc, setCc] = useState(detail.cc ?? "");
  const [ccVisible, setCcVisible] = useState(!!detail.cc);
  const [bcc, setBcc] = useState(detail.bcc ?? "");
  const [bccVisible, setBccVisible] = useState(!!detail.bcc);
  const [subject, setSubject] = useState(detail.subject ?? "");
  const [text, setText] = useState(detail.bodyText ?? "");
  const [sending, setSending] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const editorRef = useRef<RichTextRef>(null);

  const sendMessage = useSendMessage();
  const pruneThreadRows = usePruneThreadRows();
  const getAttachment = useGetAttachment();

  const conversation = threadMessages.filter((m) => !m.labelIds.includes("DRAFT"));
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(conversation.length > 0 ? [conversation[conversation.length - 1].id] : []),
  );
  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const conversationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = conversationRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const handleDownloadAttachment: DownloadAttachment = (
    messageId,
    attachmentId,
    filename,
    mimeType,
  ) => {
    console.log("[DraftEditor:downloadAttachment]", { messageId, filename });
    void (async () => {
      try {
        const result = await getAttachment.mutateAsync({
          accountId,
          messageId,
          attachmentId,
          filename,
          mimeType,
        });
        if (result.saved) toast.success(`Saved ${filename}`);
      } catch {
        toast.error("Could not download attachment");
      }
    })();
  };

  // The draft's files must be back in memory before any save: saveDraft
  // rewrites the whole message, so a save without them silently drops the
  // attachments server-side. null = still loading (autosave and send stay
  // suspended until then).
  const [attachments, setAttachments] = useState<ComposeAttachment[] | null>(
    detail.attachments.length === 0 ? [] : null,
  );
  const [attachLoadFailed, setAttachLoadFailed] = useState(false);

  const loadAttachments = async () => {
    setAttachLoadFailed(false);
    setAttachments(null);
    try {
      setAttachments(await loadMessageAttachments(accountId, detail.id, detail.attachments));
    } catch (err) {
      console.log("[DraftEditor:attachmentsLoadFailed]", { error: String(err) });
      setAttachLoadFailed(true);
      toast.error("Could not load the draft's attachments");
    }
  };
  const loadAttachmentsRef = useLatest(loadAttachments);
  useEffect(() => {
    if (detail.attachments.length > 0) void loadAttachmentsRef.current();
  }, [detail.attachments.length, loadAttachmentsRef]);

  const draftIdQuery = useQuery({
    queryKey: ["gmail:draftId", accountId, detail.id],
    queryFn: () => mailApi.getDraftForMessage(accountId, detail.id, detail.threadId),
    staleTime: Infinity,
    retry: false,
  });

  const draft = useDraftAutosave({
    accountId,
    threadId: detail.threadId || undefined,
    delayMs: autosaveDelayMs(attachments),
    enabled: draftIdQuery.isFetched && attachments != null,
    initialDraftId: draftIdQuery.data?.draftId ?? null,
    initialMessageId: detail.id,
    initialRevision: detail.draftRevision,
    initialGone: draftIdQuery.data?.gone,
    signal: JSON.stringify({
      fromAddress,
      to,
      cc,
      bcc,
      subject,
      text,
      att: attachmentSignature(attachments),
    }),
    getPayload: () => {
      if (attachments == null) return null;
      const plain = editorRef.current?.getText() ?? text;
      const html = editorRef.current?.getHTML() ?? textToHtml(plain);
      return {
        from: fromAddress,
        to: normalizeAddressList(to),
        cc: normalizeAddressList(cc) || undefined,
        bcc: normalizeAddressList(bcc) || undefined,
        subject,
        body: plain,
        bodyHtml: `<div dir="auto">${html}</div>`,
        attachments: attachments.length > 0 ? attachments : undefined,
      };
    },
    onRemoteChange: async (next) => {
      setPickedAddress(next.fromEmail);
      setTo(next.to ?? "");
      setCc(next.cc ?? "");
      setBcc(next.bcc ?? "");
      setCcVisible(Boolean(next.cc));
      setBccVisible(Boolean(next.bcc));
      setSubject(next.subject ?? "");
      editorRef.current?.setHTML(next.bodyHtml ?? textToHtml(next.bodyText ?? ""));
      setAttachments(
        next.attachments.length > 0
          ? await loadMessageAttachments(accountId, next.id, next.attachments)
          : [],
      );
    },
  });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = e.target as Element | null;
      if (el && typeof el.closest === "function" && el.closest('[role="dialog"]')) return;
      if (el && typeof el.closest === "function" && el.closest('[data-ac-open="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      onDone();
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, [onDone]);

  const hasRecipient = splitAddressList(to).some((e) => parseAddressEntry(e).email.includes("@"));
  const canSend =
    !sending &&
    !sendMessage.isPending &&
    !!fromAddress &&
    !fromUnavailable &&
    hasRecipient &&
    attachments != null &&
    (text.trim().length > 0 || subject.trim().length > 0);

  const handleSend = async (scheduledAt?: number) => {
    if (!canSend) return;
    const plain = editorRef.current?.getText() ?? text;
    const html = `<div dir="auto">${editorRef.current?.getHTML() ?? textToHtml(plain)}</div>`;
    const others = threadMessages.filter((m) => !m.labelIds.includes("DRAFT"));
    const last = others[others.length - 1];
    console.log("[DraftEditor:send]", { draftId: draftIdQuery.data?.draftId, threaded: !!last });
    const payload = {
      accountId,
      from: fromAddress,
      to: normalizeAddressList(to),
      cc: normalizeAddressList(cc) || undefined,
      bcc: normalizeAddressList(bcc) || undefined,
      subject: subject.trim() || "(no subject)",
      body: plain,
      bodyHtml: html,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      ...(last ? { threadId: detail.threadId, replyToMessageId: last.id } : {}),
    };
    if (scheduledAt !== undefined) {
      await draft.finalize();
      try {
        await sendMessage.mutateAsync({
          ...payload,
          scheduledAt,
          ...draft.sending(payload.accountId),
        });
      } catch (err) {
        draft.reopen();
        throw err;
      }
      toast.success("Send scheduled", { description: new Date(scheduledAt).toLocaleString() });
      onDone();
      return;
    }
    setSending(true);
    pruneThreadRows(accountId, detail.threadId || detail.id);
    onDone();
    sendWithUndo({
      subject: payload.subject,
      send: () => sendMessage.mutateAsync({ ...payload, ...draft.sending(payload.accountId) }),
      onSent: () => draft.finalize(),
      savedDraft: draft.savedDraft,
    });
  };

  const handleDiscard = () => {
    console.log("[DraftEditor:discard]", { draftId: draftIdQuery.data?.draftId });
    // finalize first: it stops autosave, so closing doesn't flush a last save.
    void draft.finalize({ deleteDraft: true });
    pruneThreadRows(accountId, detail.threadId || detail.id);
    onDone();
  };

  // Drop-to-attach is suspended until the draft's originals are back in memory
  // (attachments == null), so a drop can't drop them from the next save.
  const { isDragging, dropProps } = useComposeFileDrop((files) => {
    void filesToComposeAttachments(files, attachments ?? []).then((picked) => {
      if (picked.length > 0) setAttachments((prev) => [...(prev ?? []), ...picked]);
    });
  }, attachments == null);

  const attach = () => {
    void pickComposeAttachments(attachments ?? []).then((picked) => {
      if (picked.length > 0) setAttachments((prev) => [...(prev ?? []), ...picked]);
    });
  };

  const inThread = conversation.length > 0;
  const fields = (
    <>
      {account && fromAddress && (addressesOf(account).length > 1 || fromUnavailable) ? (
        <ComposerField label="From">
          <FromPicker
            accounts={[account]}
            value={account}
            address={fromAddress}
            unavailable={fromUnavailable}
            onChange={(_, address) => setPickedAddress(address)}
          />
        </ComposerField>
      ) : null}
      <ComposerField
        label="To"
        trailing={
          <CcBccToggles
            showCc={ccVisible}
            showBcc={bccVisible}
            onShowCc={() => setCcVisible(true)}
            onShowBcc={() => setBccVisible(true)}
          />
        }
      >
        <RecipientInput value={to} onChange={setTo} ariaLabel="To" />
      </ComposerField>
      {ccVisible ? (
        <ComposerField label="Cc">
          <RecipientInput value={cc} onChange={setCc} ariaLabel="Cc" />
        </ComposerField>
      ) : null}
      {bccVisible ? (
        <ComposerField label="Bcc">
          <RecipientInput value={bcc} onChange={setBcc} ariaLabel="Bcc" />
        </ComposerField>
      ) : null}
      {inThread ? (
        <ComposerField label="Subject">
          <SubjectInput value={subject} onChange={setSubject} />
        </ComposerField>
      ) : null}
    </>
  );
  const banner = (
    <DraftRemoteBanner
      remote={draft.remote}
      mine={{ to, cc, subject, body: text }}
      onTakeTheirs={draft.takeTheirs}
      onKeepMine={draft.keepMine}
      onSaveAsNew={draft.saveAsNew}
    />
  );
  const editor = (
    <RichTextArea
      ref={editorRef}
      placeholder="Write your message…"
      ariaLabel="Message"
      onTextChange={setText}
      autoFocus={autoFocus}
      showToolbar={formatting}
      minHeightClass={inThread ? "min-h-[140px]" : "min-h-[40vh]"}
      maxHeightClass={inThread ? "max-h-[45vh]" : "max-h-none"}
      initialHTML={detail.bodyHtml ?? (detail.bodyText ? textToHtml(detail.bodyText) : undefined)}
    />
  );
  const attachmentChips = (
    <AttachmentChips
      attachments={attachments}
      onRemove={(i) => setAttachments((prev) => (prev ?? []).filter((_, j) => j !== i))}
    />
  );
  const footer = (
    <ComposerFooter
      onAttach={attach}
      attachDisabled={attachments == null}
      formatting={formatting}
      onToggleFormatting={() => setFormatting((f) => !f)}
      onDiscard={handleDiscard}
      status={
        attachments == null ? (
          attachLoadFailed ? (
            <>
              Couldn't load attachments —{" "}
              <button
                type="button"
                onClick={() => void loadAttachments()}
                className="cursor-pointer underline hover:text-foreground"
              >
                retry
              </button>
            </>
          ) : (
            "Loading attachments…"
          )
        ) : (
          draftStatus(draft)
        )
      }
      statusTone={draft.saveState === "error" || attachLoadFailed ? "error" : "muted"}
      accountId={accountId}
      canSend={canSend}
      onSchedule={handleSend}
      onSend={() => void handleSend()}
    />
  );

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col" {...dropProps}>
      <ComposeDropOverlay visible={isDragging} />
      <div
        data-toolbar=""
        className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 px-4"
      >
        {titleLeading}
        <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">Draft</div>
        <HintTooltip label="Close (keeps the draft)" hint="Esc" side="bottom">
          <IconBtn label="Close" onClick={onDone}>
            <XIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
        {titleTrailing ? (
          <span className="ml-1 flex items-center gap-1">{titleTrailing}</span>
        ) : null}
      </div>

      {inThread ? (
        <>
          <div ref={conversationRef} className="te-scroll min-h-0 flex-1 overflow-y-auto pb-2">
            {conversation.map((m, i) => {
              const prev = conversation[i - 1];
              const newDay = !prev || dayKey(prev.date) !== dayKey(m.date);
              const isExpanded = expandedIds.has(m.id);
              return (
                <div key={m.id}>
                  {newDay ? <DayDivider timestamp={m.date} /> : null}
                  {isExpanded ? (
                    <ExpandedRow
                      accountId={accountId}
                      summary={m}
                      onCollapse={() => toggleExpanded(m.id)}
                      onDownload={handleDownloadAttachment}
                    />
                  ) : (
                    <CollapsedRow
                      accountId={accountId}
                      summary={m}
                      onExpand={() => toggleExpanded(m.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="shrink-0 px-5 pb-4 pt-1" data-inline-compose="">
            <ComposerCard onSend={() => void handleSend()}>
              {banner}
              {fields}
              {editor}
              {attachmentChips}
              {footer}
            </ComposerCard>
          </div>
        </>
      ) : (
        <ComposerCard onSend={() => void handleSend()} variant="plain" className="min-h-0 flex-1">
          <ComposeDocument
            fields={
              <>
                {banner}
                {fields}
              </>
            }
            subject={<SubjectInput title value={subject} onChange={setSubject} />}
            editor={editor}
            attachments={attachmentChips}
            footer={footer}
          />
        </ComposerCard>
      )}
    </div>
  );
}
