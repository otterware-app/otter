import type { ChatChange } from "./api.ts";

export function chatChangeKey({ target }: ChatChange): string {
  return JSON.stringify([target.kind, "accountId" in target ? target.accountId : null, target.id]);
}

export function mergeChatChanges(changes: ChatChange[]): ChatChange[] {
  const results = new Map<string, ChatChange>();
  for (const change of changes) {
    const key = chatChangeKey(change);
    const previous = results.get(key);
    results.set(key, {
      ...change,
      title: change.action === "deleted" && previous ? previous.title : change.title,
      action:
        previous?.action === "created" && change.action === "updated" ? "created" : change.action,
    });
  }
  return [...results.values()];
}

const KIND_LABELS: Record<ChatChange["target"]["kind"], string> = {
  draft: "draft",
  thread: "conversation",
  label: "label",
  view: "view",
  theme: "theme",
  event: "event",
};

/** A change as its row says it: what kind of thing, what happened ("Created"), and both ("Created draft"). */
export function chatChangeLine(change: ChatChange) {
  const kind = KIND_LABELS[change.target.kind];
  const action = `${change.action[0].toUpperCase()}${change.action.slice(1)}`;
  return { kind, action, description: `${action} ${kind}` };
}

/** It's still there to open: not deleted, and an event only with its page. */
export const canOpenChange = (change: ChatChange) =>
  change.action !== "deleted" && (change.target.kind !== "event" || Boolean(change.target.url));
