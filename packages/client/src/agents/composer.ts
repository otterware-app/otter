import { useQuery } from "@tanstack/react-query";
import type { AgentTraits } from "./agent-traits.ts";
import {
  agentApi,
  type AgentId,
  type AgentSettingsPatch,
  type ChatAttachment,
  type ProviderSnapshot,
  type Skill,
} from "./api.ts";
import type { SentAttachment } from "./chat-attachments.ts";
import { withCitations, type Citation } from "./chat-cite.ts";
import { buildHandoffText, type MailChatContext } from "./chat-context.ts";
import type { FollowUpBehavior } from "./chat-queue.ts";
import {
  clampTitle,
  isCompacting,
  type ChatsState,
  type Outgoing,
  type Run,
} from "./chat-store.ts";

/** The skills an agent offers for `/`. */
export function useSkills(agentId: AgentId, enabled: boolean) {
  return useQuery<Skill[]>({
    queryKey: ["agent-skills", agentId],
    queryFn: () => agentApi.skills(agentId),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** A draft typed as a skill's command and a space: the skill, and the rest of the draft. */
export function skillCommand(
  draft: string,
  skills: Skill[],
): { skill: Skill; rest: string } | null {
  const m = draft.match(/^\/([a-z0-9:_-]+)\s([\s\S]*)$/i);
  const skill = m && skills.find((s) => s.name.toLowerCase() === m[1].toLowerCase());
  return skill ? { skill, rest: m[2] } : null;
}

/** What's typed after `/` while the draft is only that: the skills it asks for. */
export function slashQuery(draft: string): string | null {
  const m = draft.match(/^\/([a-z0-9:_-]*)$/i);
  return m ? m[1].toLowerCase() : null;
}

export const slashSkills = (skills: Skill[], query: string | null): Skill[] =>
  query === null ? [] : skills.filter((s) => s.name.toLowerCase().includes(query)).slice(0, 8);

type RunState = Pick<ChatsState, "runs" | "approvals" | "questions" | "conversations">;

/** The approvals and questions the run asks you, in order. */
export function runRequests(
  run: Run | null,
  { approvals, questions }: Pick<ChatsState, "approvals" | "questions">,
) {
  return {
    approvals: run ? approvals.filter((a) => a.requestId === run.requestId) : [],
    questions: run ? questions.filter((q) => q.requestId === run.requestId) : [],
  };
}

/** The chat's run compacts its context before it goes on. */
export const runCompacting = (s: RunState, chatId: string) =>
  Boolean(s.runs[chatId]) &&
  isCompacting(s.conversations.find((c) => c.id === chatId)?.turns ?? []);

/** A message can join the chat's run now: it runs, and isn't waiting on an approval or compacting. */
export function canSteer(s: RunState, chatId: string): boolean {
  const run = s.runs[chatId];
  return (
    Boolean(run) &&
    !s.approvals.some((a) => a.requestId === run.requestId) &&
    !runCompacting(s, chatId)
  );
}

/** The chat's run waits on you: an approval or an answer. */
export function runAsking(s: RunState, chatId: string): boolean {
  const run = s.runs[chatId];
  return (
    Boolean(run) &&
    (s.approvals.some((a) => a.requestId === run.requestId) ||
      s.questions.some((q) => q.requestId === run.requestId))
  );
}

export type SubmitMode = "send" | "queue" | "steer";

export const alternateOf = (followUp: FollowUpBehavior): FollowUpBehavior =>
  followUp === "queue" ? "steer" : "queue";

/**
 * What sending does now: starts a run, or, while one goes, follows your follow-up behavior
 * (`alternate`: its opposite, for this message). A run that compacts takes no steer.
 */
export function submitMode({
  running,
  compacting,
  followUp,
  alternate,
}: {
  running: boolean;
  compacting: boolean;
  followUp: FollowUpBehavior;
  alternate: boolean;
}): SubmitMode {
  if (!running) return "send";
  if (compacting) return "queue";
  return alternate ? alternateOf(followUp) : followUp;
}

export function submitLabel(mode: SubmitMode, editingQueued: boolean): string {
  if (editingQueued) return "Update queued message";
  return mode === "queue" ? "Queue message" : mode === "steer" ? "Steer message" : "Send message";
}

/** The composer holds something to send. */
export const composerHasContent = (c: {
  draft: string;
  skill: Skill | null;
  files: number;
  citations: number;
}) => Boolean(c.draft.trim() || c.skill || c.files > 0 || c.citations > 0);

/** The message the composer sends: its text with what it quotes, and the mail it's about when attached. */
export function composeOutgoing({
  convoId,
  agentId,
  draft,
  skill,
  citations,
  staged,
  sent,
  attached,
  mailReader,
}: {
  convoId: string;
  agentId: AgentId;
  draft: string;
  skill: Skill | null;
  citations: Citation[];
  staged: ChatAttachment[];
  sent: SentAttachment[];
  attached: MailChatContext["attached"];
  mailReader: string | undefined;
}): Outgoing {
  const question = draft.trim();
  const text = withCitations(question, citations);
  return {
    id: crypto.randomUUID(),
    convoId,
    provider: agentId,
    question,
    input: attached ? buildHandoffText(text, attached.context, mailReader) : text,
    skill: skill ?? undefined,
    title: clampTitle(
      skill
        ? `/${skill.name} ${question}`
        : question || citations[0]?.comment || citations[0]?.text || sent[0]?.name || "Attachment",
    ),
    attachments: staged.length > 0 ? staged : undefined,
    sent: sent.length > 0 ? sent : undefined,
    citations: citations.length > 0 ? citations : undefined,
    context: attached?.meta,
  };
}

/** What the composer offers to change about the agent: its mode, its model, the model's traits. */
export function composerControls(
  provider: ProviderSnapshot | undefined,
  traits: AgentTraits | undefined,
) {
  const model = provider?.models.find((m) => m.slug === provider.model);
  const settings = traits?.ownModelSettings ? undefined : provider?.settings;
  return {
    runtimeMode: traits?.serverApprovals ? null : (provider?.settings.runtimeMode ?? null),
    pickModels: Boolean(provider && !traits?.subAgents && provider.models.length > 1),
    traitOptions: model?.options ?? [],
    traitValues: {
      reasoningEffort: settings?.reasoningEffort ?? "",
      serviceTier: settings?.serviceTier ?? "",
    },
  };
}

/** Picking an agent, or one of a gateway's agents (its model), for new chats. */
export const agentPick = (id: AgentId, gatewayAgent: string | null): AgentSettingsPatch =>
  gatewayAgent ? { selected: id, [id]: { model: gatewayAgent } } : { selected: id };
