import { useEffect, useRef, useState, type RefObject } from "react";
import { agentContribution } from "../extensions/registry";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CornerUpRightIcon, ListPlusIcon, PlusIcon, QuoteIcon } from "lucide-react";
import { IconBtn, HintTooltip, cn } from "./ui";
import { COMPOSER_SURFACE } from "./composer-kit";
import {
  mailApi,
  type AgentSettingsPatch,
  type ApprovalDecision,
  type ProviderKind,
  type Skill,
} from "./api";
import type { ChatProvider } from "./agent-providers";
import { ProviderModelPicker, RuntimeModePicker, TraitsPicker } from "./model-picker";
import { ApprovalCard } from "./approval-card";
import { QuestionCard } from "./question-card";
import { buildHandoffText, type MailChatContext } from "./chat-context";
import { withCitations, type Citation } from "./chat-cite";
import {
  AttachmentChip,
  ComposerAttachments,
  filesFromPaste,
  type useChatAttachments,
} from "./chat-attachments";
import { QueuedRunsControl, useFollowUpBehavior } from "./chat-queue";
import {
  answerQuestion,
  clampTitle,
  moveQueued,
  removeQueued,
  respondApproval,
  sendMessage,
  setCitations,
  setDraft,
  setEditingQueued,
  steerQueued,
  stopRun,
  updateQueued,
  useChats,
  type Conversation,
  type Outgoing,
} from "./chat-store";
import { ContextKindIcon, SkillBadge } from "./chat-transcript";
import { toast } from "./toast";
import { useCommandHandlers } from "../keybindings/dispatch";
import { modKeyName, shortcutText } from "../keybindings/keys";
import { useLatest } from "../use-latest";

const NO_CITATIONS: Citation[] = [];

export function ChatComposer({
  chatId,
  convo,
  chat,
  context,
  onClearQuote,
  files,
  inputRef,
  onEditCitation,
  onSent,
  updateSettings,
  compact = false,
}: {
  chatId: string;
  convo: Conversation | undefined;
  chat: ChatProvider;
  context: MailChatContext;
  onClearQuote?: () => void;
  files: ReturnType<typeof useChatAttachments>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onEditCitation: (id: string, anchor: DOMRect) => void;
  onSent: () => void;
  updateSettings: (patch: AgentSettingsPatch) => void;
  compact?: boolean;
}) {
  const { kind: providerKind, provider, name: providerName, usable } = chat;
  const draft = useChats((s) => s.drafts[chatId] ?? "");
  const citations = useChats((s) => s.citations[chatId]) ?? NO_CITATIONS;
  const run = useChats((s) => s.runs[chatId]) ?? null;
  const queue = useChats((s) => s.queue);
  const approvals = useChats((s) => s.approvals);
  const questions = useChats((s) => s.questions);
  const [attach, setAttach] = useState(true);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const [modHeld, setModHeld] = useState(false);
  useEffect(() => {
    const sync = (e: KeyboardEvent) => setModHeld(e.metaKey || e.ctrlKey);
    const clear = () => setModHeld(false);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, []);
  const followUp = useFollowUpBehavior();
  const [respondingApproval, setRespondingApproval] = useState<string | null>(null);
  const [answeringQuestion, setAnsweringQuestion] = useState<string | null>(null);

  const skillsQuery = useQuery<Skill[]>({
    queryKey: ["agent-skills", providerKind],
    queryFn: () => mailApi.agentSkills(providerKind),
    enabled: usable,
    staleTime: 5 * 60_000,
  });
  const skills = skillsQuery.data ?? [];

  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashItemRef = useRef<HTMLButtonElement | null>(null);
  const [activeSkill, setActiveSkill] = useState<Skill | null>(null);
  const handleDraftChange = (value: string) => {
    setSlashDismissed(false);
    if (!activeSkill) {
      const m = value.match(/^\/([a-z0-9:_-]+)\s([\s\S]*)$/i);
      const sk = m && skills.find((s) => s.name.toLowerCase() === m[1].toLowerCase());
      if (sk) {
        setActiveSkill(sk);
        setDraft(chatId, m![2]);
        return;
      }
    }
    setDraft(chatId, value);
  };
  const slashMatch = draft.match(/^\/([a-z0-9:_-]*)$/i);
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : null;
  const slashSkills =
    slashQuery !== null
      ? skills.filter((s) => s.name.toLowerCase().includes(slashQuery)).slice(0, 8)
      : [];
  const slashOpen = slashQuery !== null && !slashDismissed && slashSkills.length > 0;
  const [indexForQuery, setIndexForQuery] = useState(slashQuery);
  if (indexForQuery !== slashQuery) {
    setIndexForQuery(slashQuery);
    setSlashIndex(0);
  }
  useEffect(() => {
    slashItemRef.current?.scrollIntoView({ block: "nearest" });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Re-run this DOM/reset lifecycle when its explicit trigger changes, even when the callback reads refs.
  }, [slashIndex]);
  const pickSkill = (skill: Skill) => {
    setActiveSkill(skill);
    setDraft(chatId, "");
    setSlashDismissed(true);
    inputRef.current?.focus();
  };

  // A fresh quote re-arms the attach toggle so it isn't silently dropped.
  const [attachedQuote, setAttachedQuote] = useState(context.quote);
  if (attachedQuote !== context.quote) {
    setAttachedQuote(context.quote);
    if (context.quote) setAttach(true);
  }

  const [editing, setEditing] = useState<{
    id: string;
    savedDraft: string;
  } | null>(null);
  const editingId = editing?.id ?? null;
  useEffect(() => setEditingQueued(editingId), [editingId]);
  useEffect(() => () => setEditingQueued(null), []);

  // Another chat: its own draft (kept per chat), without this one's skill or edit.
  const [shownChat, setShownChat] = useState(chatId);
  if (shownChat !== chatId) {
    setShownChat(chatId);
    setActiveSkill(null);
    setEditing(null);
  }

  const compose = (): Outgoing | null => {
    const question = draft.trim();
    if (
      (!question && !activeSkill && files.count === 0 && citations.length === 0) ||
      !usable ||
      // A chat's turns load first: sending before would start it over.
      !convo?.loaded
    )
      return null;
    if (files.staging) {
      toast.info("Attachments are still being added");
      return null;
    }
    const { staged, sent } = files.take();
    const attached = attach ? context.attached : null;
    const skill = activeSkill ?? undefined;
    const cited = citations;
    const text = withCitations(question, cited);
    setDraft(chatId, "");
    setActiveSkill(null);
    setCitations(chatId, () => []);
    onSent();
    if (attached && context.quote) onClearQuote?.();
    return {
      id: crypto.randomUUID(),
      convoId: convo.id,
      provider: providerKind,
      question,
      input: attached ? buildHandoffText(text, attached.context, providerKind) : text,
      skill,
      title: clampTitle(
        skill
          ? `/${skill.name} ${question}`
          : question || cited[0]?.comment || cited[0]?.text || sent[0]?.name || "Attachment",
      ),
      attachments: staged.length > 0 ? staged : undefined,
      sent: sent.length > 0 ? sent : undefined,
      citations: cited.length > 0 ? cited : undefined,
      context: attached?.meta,
    };
  };

  const alternateAction = followUp === "queue" ? "steer" : "queue";

  const send = (alternate = false) => {
    if (editing) {
      saveQueuedEdit();
      return;
    }
    const msg = compose();
    if (msg) sendMessage(msg, alternate ? alternateAction : followUp);
  };

  const editQueued = (id: string) => {
    const msg = queue.find((m) => m.id === id);
    if (!msg) return;
    setEditing({ id, savedDraft: editing ? editing.savedDraft : draft });
    setDraft(chatId, msg.question);
    inputRef.current?.focus();
  };
  const cancelQueuedEdit = () => {
    if (!editing) return;
    setDraft(chatId, editing.savedDraft);
    setEditing(null);
  };
  const saveQueuedEdit = () => {
    if (!editing) return;
    const text = draft.trim();
    if (!text) return;
    updateQueued(editing.id, text);
    cancelQueuedEdit();
  };
  const removeQueuedMessage = (id: string) => {
    if (editing?.id === id) cancelQueuedEdit();
    removeQueued(id);
  };
  // The edited message left the queue (it started, or was removed): keep a
  // dirty edit in the composer, otherwise restore the user's draft.
  const cancelQueuedEditForEffect = useLatest(cancelQueuedEdit);
  useEffect(() => {
    if (!editing || queue.some((m) => m.id === editing.id)) return;
    const original = draft.trim();
    if (original && !editing.savedDraft.trim()) {
      // oxlint-disable-next-line react/set-state-in-effect -- Coordinate queue consumption and editing with the external agent turn lifecycle.
      setEditing(null);
      toast.info("Queued message is no longer queued", {
        description: "Your unsaved edit was kept in the composer.",
      });
    } else {
      cancelQueuedEditForEffect.current();
    }
  }, [queue, cancelQueuedEditForEffect, draft, editing]);

  const respond = (approvalId: string, decision: ApprovalDecision) => {
    setRespondingApproval(approvalId);
    void respondApproval(approvalId, decision).finally(() => setRespondingApproval(null));
  };
  const answer = (questionId: string, answers: Record<string, string[]> | null) => {
    setAnsweringQuestion(questionId);
    void answerQuestion(questionId, answers).finally(() => setAnsweringQuestion(null));
  };
  const stop = () => stopRun(chatId);

  const activeQueue = queue.filter((m) => m.convoId === chatId);
  const activeApprovals = run ? approvals.filter((a) => a.requestId === run.requestId) : [];
  const activeQuestions = run ? questions.filter((q) => q.requestId === run.requestId) : [];
  // Steer needs a running turn in this chat that isn't waiting on an approval.
  const canSteer = run != null && activeApprovals.length === 0;
  useCommandHandlers({
    "agent.sendQueuedNow": () => {
      const next = activeQueue[0];
      if (!next || !canSteer) return false;
      steerQueued(next.id);
    },
    "agent.editQueued": () => {
      const latest = activeQueue[activeQueue.length - 1];
      const caretAtStart = (inputRef.current?.selectionStart ?? 0) === 0;
      if (!latest || editing || !caretAtStart) return false;
      editQueued(latest.id);
    },
  });

  const focusComposer = () => inputRef.current?.focus();

  const pickModel = (kind: ProviderKind, slug: string) => {
    updateSettings({ selected: kind, [kind]: { model: slug } });
  };

  const agent = agentContribution(providerKind);
  const runtimeMode = agent?.serverApprovals ? null : (provider?.settings.runtimeMode ?? null);
  const pendingApproval = activeApprovals[0];
  const pendingQuestion = activeQuestions[0];

  const currentModel = provider?.models.find((m) => m.slug === provider.model);
  const traitOptions = currentModel?.options ?? [];
  const traitSettings = agent?.ownModelSettings ? undefined : provider?.settings;
  const traitValues = {
    reasoningEffort: traitSettings?.reasoningEffort ?? "",
    serviceTier: traitSettings?.serviceTier ?? "",
  };

  const hasDraft = Boolean(draft.trim() || activeSkill || files.count > 0 || citations.length > 0);
  const submitMode: "send" | "queue" | "steer" = run
    ? modHeld
      ? alternateAction
      : followUp
    : "send";
  const submitLabel = editing
    ? "Update queued message"
    : submitMode === "queue"
      ? "Queue message"
      : submitMode === "steer"
        ? "Steer message"
        : "Send message";
  const submitTooltip =
    submitMode === "send" || editing
      ? submitLabel
      : `Click to ${followUp}, ${modKeyName}-click or ${shortcutText("mod+enter")} to ${alternateAction}`;

  const busy = run != null;
  const attached = context.attached;

  return (
    <div className={cn("relative shrink-0 pt-1", compact ? "px-2 pb-2" : "px-3 pb-3")}>
      <div className="relative mx-auto w-full max-w-3xl">
        {slashOpen ? (
          <div className="dropdown-glass absolute inset-x-0 bottom-full z-20 mb-1 max-h-64 overflow-y-auto rounded-xl p-1.5 shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Skills</div>
            {slashSkills.map((s, i) => (
              <button
                key={s.name}
                type="button"
                ref={i === slashIndex ? slashItemRef : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickSkill(s);
                }}
                onMouseEnter={() => setSlashIndex(i)}
                className={cn(
                  "flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left",
                  i === slashIndex && "bg-accent-surface",
                )}
              >
                <span className="text-sm font-medium text-foreground">/{s.name}</span>
                <span className="w-full truncate text-xs text-muted-foreground">
                  {s.description}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <QueuedRunsControl
          items={activeQueue}
          editingId={editing?.id ?? null}
          canSteer={canSteer}
          onEdit={editQueued}
          onCancelEdit={cancelQueuedEdit}
          onSteer={steerQueued}
          onRemove={removeQueuedMessage}
          onMove={moveQueued}
        />
        {pendingApproval && busy ? (
          <ApprovalCard
            key={pendingApproval.approval.id}
            agent={providerName}
            approval={pendingApproval.approval}
            pendingCount={activeApprovals.length}
            responding={respondingApproval === pendingApproval.approval.id}
            onRespond={(decision) => respond(pendingApproval.approval.id, decision)}
            onCancel={stop}
          />
        ) : pendingQuestion && busy ? (
          <QuestionCard
            key={pendingQuestion.question.id}
            agent={providerName}
            question={pendingQuestion.question}
            pendingCount={activeQuestions.length}
            responding={answeringQuestion === pendingQuestion.question.id}
            onAnswer={(answers) => answer(pendingQuestion.question.id, answers)}
          />
        ) : (
          <div className={cn("relative", COMPOSER_SURFACE, compact && "rounded-lg")}>
            <ComposerAttachments items={files.items} onRemove={files.remove} compact={compact}>
              {/* The mail this message is about; click to leave it out. */}
              {attached ? (
                <AttachmentChip
                  compact={compact}
                  name={attached.name}
                  detail={attached.detail}
                  title={attach ? "Attached to this message" : "Not attached"}
                  tile={<ContextKindIcon kind={attached.kind} />}
                  off={!attach}
                  onClick={() => setAttach((a) => !a)}
                />
              ) : null}
              {citations.map((citation) => (
                <AttachmentChip
                  compact={compact}
                  key={citation.id}
                  name={`“${citation.text}”`}
                  detail={citation.comment || "Quote"}
                  title={
                    citation.comment ? `${citation.text}\n\n${citation.comment}` : citation.text
                  }
                  tile={<QuoteIcon />}
                  onClick={(e) =>
                    onEditCitation(citation.id, e.currentTarget.getBoundingClientRect())
                  }
                  onRemove={() =>
                    setCitations(chatId, (list) => list.filter((c) => c.id !== citation.id))
                  }
                />
              ))}
            </ComposerAttachments>
            {activeSkill ? (
              <div className="px-4 pt-3">
                <SkillBadge name={activeSkill.name} onRemove={() => setActiveSkill(null)} />
              </div>
            ) : null}
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              onPaste={(e) => {
                const pasted = filesFromPaste(e.clipboardData);
                if (pasted.length === 0) return;
                e.preventDefault();
                void files.add(pasted);
              }}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && draft === "" && activeSkill && !slashOpen) {
                  e.preventDefault();
                  setActiveSkill(null);
                  return;
                }
                if (slashOpen) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashIndex((i) => Math.min(slashSkills.length - 1, i + 1));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashIndex((i) => Math.max(0, i - 1));
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    pickSkill(slashSkills[slashIndex]);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setSlashDismissed(true);
                    return;
                  }
                }
                if (e.key === "Escape" && editing) {
                  e.preventDefault();
                  cancelQueuedEdit();
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(e.metaKey || e.ctrlKey);
                }
              }}
              placeholder="Ask anything, / for skills"
              aria-label={`Message ${providerName}`}
              rows={compact ? 1 : 2}
              className={cn(
                "w-full resize-none bg-transparent pb-1 text-sm leading-relaxed text-foreground outline-none placeholder:text-placeholder",
                "field-sizing-content",
                compact
                  ? "max-h-40 px-3.5 pt-3"
                  : "min-h-[calc(2lh+1.25rem)] max-h-[min(20rem,45vh)] px-4.5 pt-4",
              )}
            />
            <div
              className={cn("flex min-w-0 items-center gap-1", compact ? "px-2 pb-2" : "px-3 pb-3")}
            >
              <HintTooltip label="Attach files">
                <IconBtn
                  label="Attach files"
                  className={cn("-ms-0.5 rounded-full", compact ? "size-7" : "size-8")}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => filePickerRef.current?.click()}
                >
                  <PlusIcon className="size-4.5" />
                </IconBtn>
              </HintTooltip>
              <input
                ref={filePickerRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.currentTarget.files ?? []);
                  e.currentTarget.value = "";
                  void files.add(picked);
                  focusComposer();
                }}
              />
              <div className="flex min-w-0 shrink items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {runtimeMode ? (
                  <RuntimeModePicker
                    returnFocus={focusComposer}
                    value={runtimeMode}
                    onChange={(mode) => {
                      updateSettings({
                        [providerKind]: { runtimeMode: mode },
                      });
                    }}
                  />
                ) : null}
              </div>
              {/* Codex's "Model Effort ⌄": the model reads as plain text,
                  the traits follow it muted and carry the chevron, and
                  one pill wraps both, as a single control. */}
              <div className="ms-auto flex min-w-0 shrink items-center rounded-full hover:bg-accent-surface has-[[data-state=open]]:bg-accent-surface">
                <ProviderModelPicker
                  providers={chat.state?.providers ?? []}
                  activeKind={providerKind}
                  lockedKind={convo && convo.turns.length > 0 ? convo.provider : null}
                  onPick={pickModel}
                  returnFocus={focusComposer}
                  chevron={traitOptions.length === 0}
                  className={cn(
                    "hover:bg-transparent data-[state=open]:bg-transparent",
                    traitOptions.length > 0 && "pe-1",
                  )}
                />
                {traitOptions.length > 0 ? (
                  <TraitsPicker
                    returnFocus={focusComposer}
                    options={traitOptions}
                    values={traitValues}
                    className="shrink-0 ps-1 hover:bg-transparent data-[state=open]:bg-transparent"
                    onChange={(id, value) => {
                      updateSettings({ [providerKind]: { [id]: value } });
                    }}
                  />
                ) : null}
              </div>
              <div className="flex shrink-0 items-center">
                {/* Running + empty composer → Stop; with a draft the button
                    queues or steers it (Otter Code's primary actions). */}
                {busy && !hasDraft && !editing ? (
                  <HintTooltip label="Interrupt">
                    <button
                      type="button"
                      onClick={stop}
                      aria-label="Stop generation"
                      className={cn(
                        "flex cursor-pointer items-center justify-center rounded-full bg-destructive/90 text-white shadow-xs shadow-destructive/24 inset-shadow-2xs inset-shadow-white/16 transition-transform duration-150 hover:scale-105 hover:bg-destructive active:shadow-none active:inset-shadow-black/8",
                        compact ? "size-7" : "size-8",
                      )}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="currentColor"
                        aria-hidden
                      >
                        <rect x="2" y="2" width="8" height="8" rx="1.5" />
                      </svg>
                    </button>
                  </HintTooltip>
                ) : (
                  <HintTooltip label={submitTooltip}>
                    <button
                      type="button"
                      onClick={(e) => send(e.metaKey || e.ctrlKey)}
                      disabled={!hasDraft}
                      aria-label={submitLabel}
                      className={cn(
                        "relative isolate flex items-center justify-center overflow-hidden rounded-full bg-primary text-primary-foreground shadow-xs transition-transform duration-150 enabled:cursor-pointer enabled:shadow-primary/24 enabled:inset-shadow-2xs enabled:inset-shadow-white/16 hover:scale-105 hover:bg-primary/90 active:shadow-none active:inset-shadow-black/8 disabled:pointer-events-none disabled:opacity-30 disabled:shadow-none",
                        compact ? "size-7" : "size-8",
                      )}
                    >
                      {editing ? (
                        <CheckIcon className="size-4" aria-hidden />
                      ) : submitMode === "queue" ? (
                        <ListPlusIcon className="size-4" aria-hidden />
                      ) : submitMode === "steer" ? (
                        <CornerUpRightIcon className="size-4" aria-hidden />
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                          <path
                            d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  </HintTooltip>
                )}
              </div>
            </div>
            {providerKind === "openrouter" && usable ? (
              <div className="flex items-center justify-between gap-2 px-4 pb-3 text-xs text-muted-foreground">
                <span>OpenRouter</span>
                <button
                  type="button"
                  className="cursor-pointer hover:text-foreground"
                  onClick={() =>
                    void window.desktopBridge.openExternal("https://openrouter.ai/activity")
                  }
                >
                  Manage usage
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
