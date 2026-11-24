import { getAccountColor, getAccountDisplayName } from "./account-style.ts";
import { SYSTEM_LABEL_NAMES, labelDisplayName } from "./label-names.ts";
import type { MailAccount, MailLabel, MessageSummary, ViewRule } from "./types.ts";

export type ResolveLabel = (
  accountId: string | undefined,
  labelId: string,
) => MailLabel | undefined;

export type CombinedList = { viewId: string; name: string; rules: ViewRule[] };

/** Mailbox + account identity shown next to the date in a view's rows.
    mailbox is null when every selection in the view is the same mailbox,
    where naming it on every row would be redundant. */
export type CombinedMeta = { mailbox: string | null; accountName: string; accountColor: string };

export function rowLabels(message: MessageSummary): string[] {
  return message.threadLabelIds ?? message.labelIds;
}

/** A conversation with mail in both Junk and the Inbox (a junked sender wrote again) is junk only in the Junk view. */
export function isJunk(labels: string[], inJunkView: boolean): boolean {
  return labels.includes("SPAM") && (inJunkView || !labels.includes("INBOX"));
}

function ruleMailboxName(rule: ViewRule, resolveLabel: ResolveLabel): string | null {
  if (rule.allOf.length === 0) return null;
  return rule.allOf
    .map((labelId) => {
      const label = resolveLabel(rule.accountId, labelId);
      return label ? labelDisplayName(label) : (SYSTEM_LABEL_NAMES[labelId] ?? labelId);
    })
    .join(" + ");
}

export function resolveCombinedMeta(
  message: MessageSummary,
  combined: CombinedList | null,
  accounts: MailAccount[],
  resolveLabel: ResolveLabel,
): CombinedMeta | null {
  if (!combined || !message.accountId) return null;
  if (
    combined.rules.length > 0 &&
    combined.rules.every((r) => r.accountId === combined.rules[0].accountId)
  ) {
    return null;
  }
  const account = accounts.find((a) => a.id === message.accountId);
  if (!account) return null;
  const matched = combined.rules.find(
    (r) =>
      r.accountId === message.accountId &&
      r.allOf.every((id) => rowLabels(message).includes(id)) &&
      !r.noneOf.some((id) => rowLabels(message).includes(id)),
  );
  // Thread representatives may not carry the matched labels themselves (e.g.
  // your own reply in an Inbox view) — still show which account the row is from.
  if (!matched) {
    return {
      mailbox: null,
      accountName: getAccountDisplayName(account),
      accountColor: getAccountColor(account),
    };
  }
  const mailbox = ruleMailboxName(matched, resolveLabel);
  const uniform = combined.rules.every((r) => ruleMailboxName(r, resolveLabel) === mailbox);
  return {
    mailbox: uniform ? null : mailbox,
    accountName: getAccountDisplayName(account),
    accountColor: getAccountColor(account),
  };
}

export type MessageDay = { day: number; messages: MessageSummary[] };

export function groupMessagesByDay(messages: MessageSummary[]): MessageDay[] {
  const days = new Map<number, MessageDay>();
  for (const message of messages) {
    const day = new Date(message.date).setHours(0, 0, 0, 0);
    let group = days.get(day);
    if (!group) {
      group = { day, messages: [] };
      days.set(day, group);
    }
    group.messages.push(message);
  }
  return [...days.values()].sort((a, b) => b.day - a.day);
}
