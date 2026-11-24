import { useEffect, useRef, useState, type RefObject } from "react";
import { agentContribution } from "../extensions/registry";
import { CheckIcon, CornerUpRightIcon, ListPlusIcon, PlusIcon, QuoteIcon } from "lucide-react";
import { COMPOSER_SURFACE } from "../mail/composer-kit";
import { AgentPicker, ModelPicker, RuntimeModePicker, TraitsPicker } from "../mail/model-picker";
import { ApprovalCard } from "./approval-card";
import { QuestionCard } from "./question-card";
import type { MailChatContext } from "@otter/client/agents/chat-context";
import { removeCitation, type Citation } from "@otter/client/agents/chat-cite";
import {
  agentPick,
  alternateOf,
  canSteer as canSteerRun,
  composeOutgoing,
  composerControls,
  composerHasContent,
  runCompacting,
  runRequests,
  skillCommand,
  slashQuery as slashQueryOf,
  slashSkills as slashSkillsOf,
  submitLabel as submitLabelOf,
  submitMode as submitModeOf,
  useSkills,
} from "@otter/client/agents/composer";
import {
  AttachmentChip,
  ComposerAttachments,
  filesFromPaste,
  type useComposerAttachments,
} from "./chat-attachments";
import { useFollowUpBehavior } from "@otter/client/agents/chat-queue";
import {
  answerQuestion,
  cancelQueuedEdit,
  editQueued as editQueuedMessage,
  respondApproval,
  sendMessage,
  setCitations,
  setDraft,
  steerQueued,
  stopRun,
  updateQueued,
  useChats,
  type Conversation,
  type Outgoing,
} from "@otter/client/agents/chat-store";
import { ContextKindIcon, SkillBadge } from "./chat-transcript";
import { TalkBar, TalkButton } from "./chat-talk";
import { useTalk } from "@otter/client/agents/talk";
import { toast } from "@otter/ui/components/toast";
import { useCommandHandlers } from "../keybindings/dispatch";
import { modKeyName, shortcutText } from "../keybindings/keys";
import { Button, IconButton } from "@otter/ui/components/button";
import { Textarea } from "@otter/ui/components/textarea";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { cn } from "@otter/ui/lib/utils";
import type {
  AgentSettingsPatch,
  ApprovalDecision,
  AgentId,
  Skill,
} from "@otter/client/agents/api";
import { openClawAgentId, type ChatProvider } from "@otter/client/agents/agent-providers";

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
  files: ReturnType<typeof useComposerAttachments>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onEditCitation: (id: string, anchor: DOMRect) => void;
  onSent: () => void;
  updateSettings: (patch: AgentSettingsPatch) => void;
  compact?: boolean;
}) {
  const { provider, name: providerName, usable } = chat;
  const agentId = chat.id ?? "";
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

  const skills = useSkills(agentId, usable).data ?? [];

  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashItemRef = useRef<HTMLButtonElement | null>(null);
  const [activeSkill, setActiveSkill] = useState<Skill | null>(null);
  const handleDraftChange = (value: string) => {
    setSlashDismissed(false);
    const command = activeSkill ? null : skillCommand(value, skills);
    if (command) {
      setActiveSkill(command.skill);
      setDraft(chatId, command.rest);
      return;
    }
    setDraft(chatId, value);
  };
  const slashQuery = slashQueryOf(draft);
  const slashSkills = slashSkillsOf(skills, slashQuery);
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

  const editing = useChats((s) => (s.editingQueued?.convoId === chatId ? s.editingQueued : null));
  // A queued message left in the composer would stay held: give it back on leaving the chat.
  useEffect(() => () => cancelQueuedEdit(chatId), [chatId]);

  const [shownChat, setShownChat] = useState(chatId);
  if (shownChat !== chatId) {
    setShownChat(chatId);
    setActiveSkill(null);
  }

  const hasDraft = composerHasContent({
    draft,
    skill: activeSkill,
    files: files.count,
    citations: citations.length,
  });
  const compose = (): Outgoing | null => {
    // A chat's turns load first: sending before would start it over.
    if (!hasDraft || !usable || !convo?.loaded) return null;
    if (files.staging) {
      toast.info("Attachments are still being added");
      return null;
    }
    const { staged, sent } = files.take();
    const attached = attach ? context.attached : null;
    setDraft(chatId, "");
    setActiveSkill(null);
    setCitations(chatId, () => []);
    onSent();
    if (attached && context.quote) onClearQuote?.();
    return composeOutgoing({
      convoId: convo.id,
      agentId,
      draft,
      skill: activeSkill,
      citations,
      staged,
      sent,
      attached,
      mailReader: agentContribution(provider?.kind ?? "")?.mailReader,
    });
  };

  const alternateAction = alternateOf(followUp);

  const send = (alternate = false) => {
    if (editing) {
      saveQueuedEdit();
      return;
    }
    const msg = compose();
    if (msg) sendMessage(msg, alternate ? alternateAction : followUp);
  };

  const editQueued = (id: string) => {
    editQueuedMessage(id);
    inputRef.current?.focus();
  };
  const saveQueuedEdit = () => {
    if (!editing) return;
    const text = draft.trim();
    if (!text) return;
    updateQueued(editing.id, text);
    cancelQueuedEdit();
  };

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
  const { approvals: activeApprovals, questions: activeQuestions } = runRequests(run, {
    approvals,
    questions,
  });
  const compacting = useChats((s) => runCompacting(s, chatId));
  const canSteer = useChats((s) => canSteerRun(s, chatId));
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

  const pickAgent = (id: AgentId, gatewayAgent: string | null) =>
    updateSettings(agentPick(id, gatewayAgent));

  const { runtimeMode, pickModels, traitOptions, traitValues } = composerControls(
    provider,
    agentContribution(provider?.kind ?? ""),
  );
  const pendingApproval = activeApprovals[0];
  const pendingQuestion = activeQuestions[0];

  const submitMode = submitModeOf({
    running: run != null,
    compacting,
    followUp,
    alternate: modHeld,
  });
  const submitLabel = submitLabelOf(submitMode, Boolean(editing));
  const submitTooltip =
    submitMode === "send" || editing
      ? submitLabel
      : compacting
        ? "Queue message. The agent can't take a steer while it compacts its context"
        : `Click to ${followUp}, ${modKeyName}-click or ${shortcutText("mod+enter")} to ${alternateAction}`;

  const busy = run != null;
  const attached = context.attached;
  const call = useTalk((s) => (s.call?.chatId === chatId ? s.call : null));

  return (
    <div className={cn("relative shrink-0 pt-1", compact ? "px-2 pb-2" : "px-3 pb-3")}>
      <div className="relative mx-auto w-full max-w-3xl">
        {slashOpen ? (
          <div className="dropdown-glass absolute inset-x-0 bottom-full z-20 mb-1 max-h-64 overflow-y-auto rounded-xl p-1.5 shadow-overlay">
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
        ) : call ? (
          <TalkBar call={call} name={providerName} compact={compact} />
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
                  onRemove={() => removeCitation(chatId, citation.id)}
                />
              ))}
            </ComposerAttachments>
            {activeSkill ? (
              <div className="px-4 pt-3">
                <SkillBadge name={activeSkill.name} onRemove={() => setActiveSkill(null)} />
              </div>
            ) : null}
            <Textarea
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
                "min-h-0 rounded-none border-0 bg-transparent pb-1 leading-relaxed focus-visible:bg-transparent focus-visible:ring-0",
                compact
                  ? "max-h-40 px-3.5 pt-3"
                  : "min-h-[calc(2lh+1.25rem)] max-h-[min(20rem,45vh)] px-4.5 pt-4",
              )}
            />
            <div
              className={cn("flex min-w-0 items-center gap-1", compact ? "px-2 pb-2" : "px-3 pb-3")}
            >
              <HintTooltip label="Attach files">
                <IconButton
                  label="Attach files"
                  size={compact ? "icon-sm" : "icon"}
                  className="-ms-0.5 rounded-pill"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => filePickerRef.current?.click()}
                >
                  <PlusIcon className="size-4.5" />
                </IconButton>
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
                <AgentPicker
                  providers={chat.state?.providers ?? []}
                  active={provider}
                  agent={convo && convo.turns.length > 0 ? openClawAgentId(convo.sessionId) : null}
                  locked={Boolean(convo && convo.turns.length > 0)}
                  onPick={pickAgent}
                  returnFocus={focusComposer}
                />
                {runtimeMode ? (
                  <RuntimeModePicker
                    returnFocus={focusComposer}
                    value={runtimeMode}
                    onChange={(mode) => {
                      updateSettings({
                        [agentId]: { runtimeMode: mode },
                      });
                    }}
                  />
                ) : null}
              </div>
              {/* Codex's "Model Effort ⌄": the model reads as plain text,
                  the traits follow it muted and carry the chevron, and
                  one pill wraps both, as a single control. */}
              {provider && (pickModels || traitOptions.length > 0) ? (
                <div className="ms-auto flex min-w-0 shrink items-center rounded-pill hover:bg-accent-surface has-data-popup-open:bg-accent-surface">
                  {pickModels ? (
                    <ModelPicker
                      provider={provider}
                      onPick={(model) => updateSettings({ [agentId]: { model } })}
                      returnFocus={focusComposer}
                      chevron={traitOptions.length === 0}
                      className={cn(
                        "hover:bg-transparent data-popup-open:bg-transparent",
                        traitOptions.length > 0 && "pe-1",
                      )}
                    />
                  ) : null}
                  {traitOptions.length > 0 ? (
                    <TraitsPicker
                      returnFocus={focusComposer}
                      options={traitOptions}
                      values={traitValues}
                      className="shrink-0 ps-1 hover:bg-transparent data-popup-open:bg-transparent"
                      onChange={(id, value) => {
                        updateSettings({ [agentId]: { [id]: value } });
                      }}
                    />
                  ) : null}
                </div>
              ) : (
                <span className="ms-auto" />
              )}
              <div className="flex shrink-0 items-center gap-1">
                {provider?.talk && usable && !hasDraft ? (
                  <TalkButton
                    chatId={chatId}
                    provider={agentId}
                    sessionId={convo?.sessionId ?? null}
                    name={providerName}
                    compact={compact}
                  />
                ) : null}
                {/* Running + empty composer → Stop; with a draft the button
                    queues or steers it (T3 Code's primary actions). */}
                {busy && !hasDraft && !editing ? (
                  <HintTooltip label="Interrupt">
                    <Button
                      variant="destructive"
                      size={compact ? "icon-sm" : "icon"}
                      onClick={stop}
                      aria-label="Stop generation"
                      className="rounded-pill bg-destructive/90 shadow-xs shadow-destructive/24 inset-shadow-2xs inset-shadow-white/16 transition-transform duration-150 hover:scale-105 hover:bg-destructive active:shadow-none active:inset-shadow-black/8 margin:inset-shadow-none margin:shadow-none"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="currentColor"
                        aria-hidden
                        className="size-3"
                      >
                        <rect x="2" y="2" width="8" height="8" rx="1.5" />
                      </svg>
                    </Button>
                  </HintTooltip>
                ) : (
                  <HintTooltip label={submitTooltip}>
                    <Button
                      variant="primary"
                      size={compact ? "icon-sm" : "icon"}
                      onClick={(e) => send(e.metaKey || e.ctrlKey)}
                      disabled={!hasDraft}
                      aria-label={submitLabel}
                      className="isolate overflow-hidden rounded-pill shadow-xs transition-transform duration-150 enabled:shadow-primary/24 enabled:inset-shadow-2xs enabled:inset-shadow-white/16 hover:scale-105 hover:bg-primary/90 active:shadow-none active:inset-shadow-black/8 disabled:opacity-30 disabled:shadow-none margin:inset-shadow-none margin:shadow-none"
                    >
                      {editing ? (
                        <CheckIcon className="size-4" aria-hidden />
                      ) : submitMode === "queue" ? (
                        <ListPlusIcon className="size-4" aria-hidden />
                      ) : submitMode === "steer" ? (
                        <CornerUpRightIcon className="size-4" aria-hidden />
                      ) : (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          fill="none"
                          aria-hidden
                          className="size-3.5"
                        >
                          <path
                            d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </Button>
                  </HintTooltip>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
