/**
 * The made-up agent's margin notes: its answer when core asks it about the day's things
 * (services/margin-notes.ts's prompt), written from what each item says.
 */

type Item = {
  ref: string;
  kind: string;
  subject?: string;
  from?: string;
  snippet?: string;
  title?: string;
  start?: string;
  attendees?: number;
  yourResponse?: string;
  name?: string;
  lastRun?: { status: string; error?: string };
  paused?: string;
};

type Note = {
  ref: string;
  kind: "summary" | "draft" | "question" | "done";
  text: string;
  action?: { label: string; prompt: string };
};

/** The prompt's items, when it's core asking for notes. */
function itemsOf(prompt: string): Item[] | null {
  if (!prompt.startsWith("You write short notes in the margin")) return null;
  const json = /```json\s*([\s\S]*?)```/.exec(prompt)?.[1];
  try {
    return json ? (JSON.parse(json) as Item[]) : null;
  } catch {
    return null;
  }
}

const sender = (from = "") => from.replace(/\s*<.*>$/, "").split(" ")[0] || "They";
const sentence = (text = "") => (/^[^.!?]*[.!?]/.exec(text)?.[0] ?? text).slice(0, 160).trim();
const time = (iso = "") =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function noteOn(item: Item): Note | null {
  const { ref } = item;
  if (item.kind === "scheduled task")
    return {
      ref,
      kind: "question",
      text: item.paused
        ? `“${item.name}” is paused: ${item.paused.toLowerCase()}. Turn it back on once the mail server answers?`
        : `“${item.name}” failed last time: ${item.lastRun?.error ?? "no reason given"}`,
      action: {
        label: "Look into it",
        prompt: `Find out why the scheduled task “${item.name}” failed, fix it if you can, and tell me what you changed.`,
      },
    };
  if (item.kind === "event") {
    if (item.yourResponse === "needsAction")
      return {
        ref,
        kind: "question",
        text: `You haven't answered “${item.title}” at ${time(item.start)}. Nothing clashes with it.`,
        action: { label: "Accept", prompt: `Accept the invitation to “${item.title}”.` },
      };
    if ((item.attendees ?? 0) > 2)
      return {
        ref,
        kind: "summary",
        text: `${item.attendees} people at ${time(item.start)}. I can pull together the threads that mention it.`,
        action: {
          label: "Prepare a brief",
          prompt: `Prepare a short brief for “${item.title}”: who's coming and what's been said about it in my mail.`,
        },
      };
    return null;
  }
  const subject = item.subject ?? "";
  const who = sender(item.from);
  if (/dinner/i.test(subject))
    return {
      ref,
      kind: "draft",
      text: `${who} is making extra and says see you at 7. A short thanks would do: “Perfect, we'll bring the bread. See you Saturday!”`,
      action: {
        label: "Draft reply",
        prompt: `Draft a short, warm reply to ${who}: thanks, Jonas and I will be there at 7 with the bread.`,
      },
    };
  if (/invoice/i.test(subject))
    return {
      ref,
      kind: "question",
      text: `${who}'s invoice: ${sentence(item.snippet)} Pay it from the usual card, or forward it to accounting?`,
      action: {
        label: "Forward to accounting",
        prompt: `Forward “${subject}” to accounting with a line asking them to pay it.`,
      },
    };
  if (/newsletter|issue #|digest/i.test(subject))
    return {
      ref,
      kind: "summary",
      text: `This issue, in a line: ${sentence(item.snippet)}`,
    };
  if (/sign-in code|verification/i.test(subject))
    return { ref, kind: "done", text: "A sign-in code. Nothing to do once you've used it." };
  if (/won|gift card/i.test(subject))
    return {
      ref,
      kind: "summary",
      text: "Looks like spam.",
      action: { label: "Move to spam", prompt: `Move “${subject}” to spam.` },
    };
  return { ref, kind: "summary", text: `${who}: ${sentence(item.snippet)}` };
}

/** The made-up agent's answer to `prompt` when it asks for notes; null when it doesn't. */
export function scriptedNotes(prompt: string): string | null {
  const items = itemsOf(prompt);
  if (!items) return null;
  return JSON.stringify(items.flatMap((item) => noteOn(item) ?? []));
}
