import { fakeTodoist } from "./todoist.ts";

import * as accountStore from "../services/account-store.ts";
import { fromBase64, toBase64, toBase64Url } from "../bytes.ts";
import { yieldThread } from "../pool.ts";
import type { GoogleAuth, Platform } from "../platform.ts";
import type { MailAccount } from "../types.ts";

import { DEMO_ACCOUNTS, type SeedAccount } from "@otter/shared/demo-mailboxes";
import { EXTRA_DEMO_ACCOUNTS } from "./extra-mailboxes.ts";
import { generatedBody, generatedOpening, largeMailbox } from "./large-mailbox.ts";

const SEEDS = [...DEMO_ACCOUNTS, ...EXTRA_DEMO_ACCOUNTS];
import { fakeCalendar } from "./calendar.ts";
import { answerRelay, FAKE_RELAY_URL } from "./relay.ts";

const attachmentData = (content: string) =>
  toBase64(new TextEncoder().encode(content))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

type Header = { name: string; value: string };

type Attachment = {
  id: string;
  filename: string;
  mimeType: string;
  data: string;
  size: number;
  contentId?: string;
};

type Message = {
  id: string;
  threadId: string;
  labelIds: string[];
  internalDate: number;
  headers: Header[];
  text: string | null;
  html: string | null;
  attachments: Attachment[];
  /** A large mailbox's (large-mailbox.ts): its index there, which its body is written from. */
  generated?: number;
};

export type { Attachment as FakeAttachment, Header as FakeHeader, Message as FakeMessage };

type Label = {
  id: string;
  name: string;
  type: "system" | "user";
  color?: { backgroundColor: string; textColor: string };
};

type Ref = { message: { id: string; threadId: string; labelIds?: string[] } };
type HistoryRecord = {
  id: string;
  messagesAdded?: Ref[];
  messagesDeleted?: Ref[];
  labelsAdded?: (Ref & { labelIds: string[] })[];
  labelsRemoved?: (Ref & { labelIds: string[] })[];
};

type GeneratedEdit = Pick<Message, "generated" | "labelIds">;

type Mailbox = {
  email: string;
  name: string;
  historyId: number;
  nextId: number;
  idPrefix: string;
  labels: Label[];
  messages: Record<string, Message>;
  drafts: Record<string, string>;
  history: HistoryRecord[];
  signature: string;
  /** How many messages large-mailbox.ts made for it. */
  generated?: number;
  generatedEdits?: Record<string, GeneratedEdit | null>;
};

const STATE_FILE = "demo-gmail.json";
const STATE_VERSION = 1;
/** Every answer waits this long, so the app sees a network, not a function call. */
const LATENCY_MS = 30;
const FIXTURE_WORK_MS = 8;

const SYSTEM_LABELS = [
  "INBOX",
  "SENT",
  "DRAFT",
  "SPAM",
  "TRASH",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
  "CHAT",
  "CATEGORY_PERSONAL",
  "CATEGORY_SOCIAL",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
];

function newId(box: Mailbox): string {
  return `${box.idPrefix}${(box.nextId++).toString(16).padStart(12, "0")}`;
}

function address(person: { name: string; email: string }): string {
  if (!person.name) return person.email;
  return /[",<>@;:]/.test(person.name)
    ? `"${person.name.replace(/"/g, '\\"')}" <${person.email}>`
    : `${person.name} <${person.email}>`;
}

const rfc2822 = (time: number) => new Date(time).toUTCString().replace("GMT", "+0000");

function seedMailbox(seed: SeedAccount, index: number, seededAt: number): Mailbox {
  const box: Mailbox = {
    email: seed.email,
    name: seed.name,
    historyId: 1000,
    nextId: 1,
    idPrefix: `19${index}`,
    labels: SYSTEM_LABELS.map((id) => ({ id, name: id, type: "system" })),
    messages: {},
    drafts: {},
    history: [],
    signature: seed.signature,
  };
  const me = { name: seed.name, email: seed.email };
  seed.labels.forEach((label, i) =>
    box.labels.push({ id: `Label_${i + 1}`, name: label.name, type: "user", color: label.color }),
  );
  const labelId = (name: string) => box.labels.find((l) => l.name === name || l.id === name)!.id;

  for (const thread of seed.threads(seededAt)) {
    const threadLabels = thread.labels.map(labelId);
    const firstSender = thread.messages.find((m) => m.from)?.from;
    const threadId = newId(box);
    const ids: string[] = [];
    thread.messages.forEach((seedMessage, i) => {
      const id = i === 0 ? threadId : newId(box);
      const mine = !seedMessage.from;
      const from = seedMessage.from ?? me;
      const to = seedMessage.to ?? (mine ? (firstSender ? [firstSender] : []) : [me]);
      const labels = seedMessage.draft
        ? ["DRAFT"]
        : mine
          ? [
              "SENT",
              ...threadLabels.filter(
                (l) => !["INBOX", "SPAM", "TRASH"].includes(l) && !l.startsWith("CATEGORY_"),
              ),
            ]
          : [...threadLabels];
      if (seedMessage.unread) labels.push("UNREAD");
      if (seedMessage.starred) labels.push("STARRED");
      const date = seededAt - seedMessage.hoursAgo * 3_600_000;
      const headers: Header[] = [
        { name: "From", value: address(from) },
        ...(to.length > 0 ? [{ name: "To", value: to.map(address).join(", ") }] : []),
        ...(seedMessage.cc?.length
          ? [{ name: "Cc", value: seedMessage.cc.map(address).join(", ") }]
          : []),
        {
          name: "Subject",
          value: i === 0 || /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`,
        },
        { name: "Date", value: rfc2822(date) },
        { name: "Message-ID", value: `<${id}@${seed.email.split("@")[1]}>` },
        ...(ids.length > 0
          ? [
              { name: "In-Reply-To", value: `<${ids.at(-1)}@${seed.email.split("@")[1]}>` },
              {
                name: "References",
                value: ids.map((ref) => `<${ref}@${seed.email.split("@")[1]}>`).join(" "),
              },
            ]
          : []),
        ...Object.entries(seedMessage.headers ?? {}).map(([name, value]) => ({ name, value })),
      ];
      ids.push(id);
      box.messages[id] = {
        id,
        threadId,
        labelIds: labels,
        internalDate: date,
        headers,
        text: seedMessage.text,
        html: seedMessage.html ?? null,
        attachments: (seedMessage.attachments ?? []).map((a, n) => {
          const data = attachmentData(a.content);
          return {
            id: `ANGjdJ_${id}_${n}`,
            filename: a.filename,
            mimeType: a.mimeType,
            data,
            size: fromBase64(data).length,
            contentId: a.contentId,
          };
        }),
      };
      if (seedMessage.draft) box.drafts[`r-${id}`] = id;
    });
  }
  return box;
}

type State = { version: number; seededAt: number; mailboxes: Record<string, Mailbox> };

let state: State;
let files: Platform["files"];
let saving: ReturnType<typeof setTimeout> | null = null;

// In the benchmark, the generated originals only live in memory. Save the small seed,
// user-created messages and edits to generated labels and deletions.
const savedMessages = new WeakMap<Mailbox, Mailbox["messages"]>();
const serialize = () =>
  JSON.stringify({
    ...state,
    mailboxes: Object.fromEntries(
      Object.entries(state.mailboxes).map(([id, box]) => [
        id,
        { ...box, messages: savedMessages.get(box) ?? box.messages },
      ]),
    ),
  });

function save(): void {
  saving ??= setTimeout(() => {
    saving = null;
    void files.write(STATE_FILE, serialize());
  }, 200);
}

async function restoreGenerated(box: Mailbox, seededAt: number, seed: SeedAccount): Promise<void> {
  if (!box.generated) return;
  const saved = box.messages;
  const edits = box.generatedEdits ?? {};
  const legacy = !box.generatedEdits;
  const originalLabels = seed.labels.map((_, i) => `Label_${i + 1}`);
  const mailbox = largeMailbox(box.generated, box.idPrefix, seed, originalLabels, seededAt);
  const kept: Mailbox["messages"] = {};
  for (const [id, m] of Object.entries(saved)) {
    if (m.generated === undefined) kept[id] = m;
  }
  savedMessages.set(box, kept);
  box.messages = { ...kept };
  box.generatedEdits = edits;
  let deadline = Date.now() + FIXTURE_WORK_MS;
  for (const m of mailbox) {
    if (Date.now() >= deadline) {
      await yieldThread();
      deadline = Date.now() + FIXTURE_WORK_MS;
    }
    const edit = legacy ? (saved[m.id] ?? null) : edits[m.id];
    if (edit === null) {
      if (legacy) edits[m.id] = null;
      continue;
    }
    if (edit) {
      if (legacy && edit.labelIds.join() !== m.labelIds.join()) {
        edits[m.id] = { generated: m.generated, labelIds: edit.labelIds };
      }
      m.labelIds = edit.labelIds;
    }
    box.messages[m.id] = m;
  }
}

/** `generated`: how many messages large-mailbox.ts adds to the first mailbox. */
async function loadState(generated: number): Promise<void> {
  const bytes = await files.read(STATE_FILE);
  if (bytes) {
    const saved = JSON.parse(new TextDecoder().decode(bytes)) as State;
    if (
      saved.version === STATE_VERSION &&
      (saved.mailboxes[SEEDS[0].email]?.generated ?? 0) === generated
    ) {
      state = saved;
      let added = false;
      for (const [i, seed] of SEEDS.entries()) {
        const box = state.mailboxes[seed.email];
        if (box) await restoreGenerated(box, state.seededAt, seed);
        else {
          state.mailboxes[seed.email] = seedMailbox(seed, i, state.seededAt);
          added = true;
        }
      }
      if (added) await files.write(STATE_FILE, serialize());
      return;
    }
  }
  const seededAt = Date.now();
  state = {
    version: STATE_VERSION,
    seededAt,
    mailboxes: Object.fromEntries(
      SEEDS.map((seed, i) => [seed.email, seedMailbox(seed, i, seededAt)]),
    ),
  };
  if (generated > 0) {
    const seed = SEEDS[0]!;
    const box = state.mailboxes[seed.email]!;
    box.generated = generated;
    box.generatedEdits = {};
    await restoreGenerated(box, seededAt, seed);
  }
  await files.write(STATE_FILE, serialize());
}

const ref = (m: Message): Ref => ({
  message: { id: m.id, threadId: m.threadId, labelIds: m.labelIds },
});

function record(box: Mailbox, entry: Omit<HistoryRecord, "id">): void {
  box.historyId += 1;
  box.history.push({ id: String(box.historyId), ...entry });
  if (box.history.length > 2000) box.history.splice(0, box.history.length - 2000);
  save();
}

function modify(box: Mailbox, m: Message, add: string[], remove: string[]): void {
  const added = [...new Set(add)].filter((l) => !m.labelIds.includes(l));
  const removed = [...new Set(remove)].filter((l) => m.labelIds.includes(l) && !add.includes(l));
  if (added.length === 0 && removed.length === 0) return;
  m.labelIds = [...m.labelIds.filter((l) => !removed.includes(l)), ...added];
  if (m.generated !== undefined && box.generatedEdits) {
    box.generatedEdits[m.id] = { generated: m.generated, labelIds: m.labelIds };
  }
  record(box, {
    ...(added.length ? { labelsAdded: [{ ...ref(m), labelIds: added }] } : {}),
    ...(removed.length ? { labelsRemoved: [{ ...ref(m), labelIds: removed }] } : {}),
  });
}

function addMessage(box: Mailbox, m: Message): void {
  unlist(box, box.messages[m.id]);
  box.messages[m.id] = m;
  const saved = savedMessages.get(box);
  if (saved) saved[m.id] = m;
  const sorted = newestFirst.get(box);
  if (sorted) {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (sorted[mid]!.internalDate > m.internalDate) low = mid + 1;
      else high = mid;
    }
    newestFirst.set(box, sorted.toSpliced(low, 0, m));
  }
  record(box, { messagesAdded: [ref(m)] });
}

/** Sorting the large mailbox again takes the app's thread for tens of milliseconds at a time. */
function unlist(box: Mailbox, m: Message | undefined): void {
  const sorted = newestFirst.get(box);
  const index = m && sorted ? sorted.indexOf(m) : -1;
  if (index >= 0) newestFirst.set(box, sorted!.toSpliced(index, 1));
}

function deleteMessage(box: Mailbox, id: string): void {
  const m = box.messages[id];
  if (!m) return;
  delete box.messages[id];
  const saved = savedMessages.get(box);
  if (saved) delete saved[id];
  if (m.generated !== undefined && box.generatedEdits) box.generatedEdits[id] = null;
  unlist(box, m);
  for (const [draftId, messageId] of Object.entries(box.drafts)) {
    if (messageId === id) delete box.drafts[draftId];
  }
  record(box, { messagesDeleted: [ref(m)] });
}

function decodeWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[bB]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?[^?]+\?[bB]\?([^?]*)\?=/g, (_m, data: string) =>
      new TextDecoder().decode(fromBase64(data)),
    );
}

type Entity = { headers: Header[]; body: string };

function parseEntity(raw: string): Entity {
  const split = raw.search(/\r?\n\r?\n/);
  const head = split < 0 ? raw : raw.slice(0, split);
  const body = split < 0 ? "" : raw.slice(split).replace(/^\r?\n\r?\n/, "");
  const headers: Header[] = [];
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && headers.length > 0) headers.at(-1)!.value += ` ${line.trim()}`;
    else {
      const colon = line.indexOf(":");
      if (colon > 0)
        headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
    }
  }
  return { headers, body };
}

const headerOf = (headers: Header[], name: string) =>
  headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** A raw RFC 822 message's headers, bodies and attachments (outlook.ts reads sendMail's with it too). */
export function parseMime(raw: string): Pick<Message, "headers" | "text" | "html" | "attachments"> {
  const out = {
    text: null as string | null,
    html: null as string | null,
    attachments: [] as Attachment[],
  };
  const walk = (entity: Entity) => {
    const type = headerOf(entity.headers, "Content-Type") || "text/plain";
    const mime = type.split(";")[0].trim().toLowerCase();
    const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
    if (mime.startsWith("multipart/") && boundary) {
      const parts = entity.body.split(`--${boundary}`).slice(1);
      for (const part of parts) {
        if (part.startsWith("--")) break;
        walk(parseEntity(part.replace(/^\r?\n/, "").replace(/\r?\n$/, "")));
      }
      return;
    }
    const base64 = /base64/i.test(headerOf(entity.headers, "Content-Transfer-Encoding"));
    const bytes = base64 ? fromBase64(entity.body) : new TextEncoder().encode(entity.body);
    const disposition = headerOf(entity.headers, "Content-Disposition");
    const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const filename = extended
      ? decodeURIComponent(extended)
      : decodeWords(/(?:file)?name="([^"]*)"/i.exec(`${disposition};${type}`)?.[1] ?? "");
    if (filename || /attachment/i.test(disposition) || mime === "text/calendar") {
      out.attachments.push({
        id: "",
        filename: filename || (mime === "text/calendar" ? "invite.ics" : "attachment"),
        mimeType: mime,
        data: toBase64Url(bytes),
        size: bytes.length,
      });
    } else if (mime === "text/html" && out.html === null) {
      out.html = new TextDecoder().decode(bytes);
    } else if (mime === "text/plain" && out.text === null) {
      out.text = new TextDecoder().decode(bytes);
    }
  };
  const top = parseEntity(raw);
  walk(top);
  const keep = new Set([
    "from",
    "to",
    "cc",
    "bcc",
    "subject",
    "in-reply-to",
    "references",
    "message-id",
  ]);
  return {
    ...out,
    headers: top.headers
      .filter((h) => keep.has(h.name.toLowerCase()))
      .map((h) => ({ name: h.name, value: decodeWords(h.value) })),
  };
}

function fromRaw(box: Mailbox, raw: string, threadId: string | undefined, labels: string[]) {
  const id = newId(box);
  const parsed = parseMime(new TextDecoder().decode(fromBase64(raw)));
  const now = Date.now();
  const headers = parsed.headers;
  if (!headerOf(headers, "Message-ID"))
    headers.push({ name: "Message-ID", value: `<${id}@${box.email.split("@")[1]}>` });
  headers.push({ name: "Date", value: rfc2822(now) });
  const toMe = [headerOf(headers, "To"), headerOf(headers, "Cc")]
    .join(",")
    .toLowerCase()
    .includes(box.email);
  const message: Message = {
    id,
    threadId:
      threadId && Object.values(box.messages).some((m) => m.threadId === threadId) ? threadId : id,
    labelIds: labels[0] === "SENT" && toMe ? [...labels, "INBOX", "UNREAD"] : labels,
    internalDate: now,
    headers,
    text: parsed.text,
    html: parsed.html,
    attachments: parsed.attachments.map((a, n) => ({ ...a, id: `ANGjdJ_${id}_${n}` })),
  };
  return message;
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const bodies = (m: Message): Pick<Message, "text" | "html"> =>
  m.generated === undefined ? m : generatedBody(m);

function plainText(m: Message): string {
  const { text, html } = bodies(m);
  if (text !== null) return text;
  return (html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");
}

const snippet = (m: Message) =>
  escapeHtml(
    (m.generated === undefined ? plainText(m) : generatedOpening(m))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180),
  );

const bodyPart = (mimeType: string, text: string) => {
  const bytes = new TextEncoder().encode(text);
  return {
    mimeType,
    filename: "",
    headers: [{ name: "Content-Type", value: `${mimeType}; charset="UTF-8"` }],
    body: { size: bytes.length, data: toBase64Url(bytes) },
  };
};

/** What `payload(m)` would say, without writing a generated message's bodies. */
function payloadType(m: Message): string {
  if (m.attachments.length > 0) return "multipart/mixed";
  const { text, html } = m.generated === undefined ? m : { text: "", html: "" };
  return text !== null && html !== null
    ? "multipart/alternative"
    : html !== null
      ? "text/html"
      : "text/plain";
}

function payload(m: Message): object {
  const parts = bodies(m);
  const text = parts.text !== null ? bodyPart("text/plain", parts.text) : null;
  const html = parts.html !== null ? bodyPart("text/html", parts.html) : null;
  let body: object =
    text && html
      ? { mimeType: "multipart/alternative", filename: "", body: { size: 0 }, parts: [text, html] }
      : (html ?? text ?? bodyPart("text/plain", ""));
  if (m.attachments.length > 0) {
    body = {
      mimeType: "multipart/mixed",
      filename: "",
      body: { size: 0 },
      parts: [
        body,
        ...m.attachments.map((a) => ({
          mimeType: a.mimeType,
          filename: a.filename,
          headers: [
            { name: "Content-Type", value: `${a.mimeType}; name="${a.filename}"` },
            {
              name: "Content-Disposition",
              value: `${a.contentId ? "inline" : "attachment"}; filename="${a.filename}"`,
            },
            ...(a.contentId ? [{ name: "Content-ID", value: `<${a.contentId}>` }] : []),
          ],
          body: { attachmentId: a.id, size: a.size },
        })),
      ],
    };
  }
  return { partId: "", ...body, headers: m.headers };
}

function messageResource(box: Mailbox, m: Message, url: URL): object {
  const format = url.searchParams.get("format") ?? "full";
  const base = {
    id: m.id,
    threadId: m.threadId,
    labelIds: m.labelIds,
    snippet: snippet(m),
    historyId: String(box.historyId),
    internalDate: String(m.internalDate),
    sizeEstimate: 2000 + m.attachments.reduce((sum, a) => sum + a.size, 0),
  };
  if (format === "minimal") return base;
  if (format === "metadata") {
    const wanted = url.searchParams.getAll("metadataHeaders").map((h) => h.toLowerCase());
    const headers = wanted.length
      ? m.headers.filter((h) => wanted.includes(h.name.toLowerCase()))
      : m.headers;
    return { ...base, payload: { mimeType: payloadType(m), headers } };
  }
  return { ...base, payload: payload(m) };
}

const IN: Record<string, string> = {
  inbox: "INBOX",
  sent: "SENT",
  draft: "DRAFT",
  drafts: "DRAFT",
  spam: "SPAM",
  trash: "TRASH",
  starred: "STARRED",
  important: "IMPORTANT",
  chats: "CHAT",
};
const IS: Record<string, string> = { unread: "UNREAD", starred: "STARRED", important: "IMPORTANT" };
const CATEGORY: Record<string, string> = {
  primary: "CATEGORY_PERSONAL",
  personal: "CATEGORY_PERSONAL",
  social: "CATEGORY_SOCIAL",
  promotions: "CATEGORY_PROMOTIONS",
  updates: "CATEGORY_UPDATES",
  forums: "CATEGORY_FORUMS",
};
const slug = (name: string) => name.toLowerCase().replace(/[\s/]+/g, "-");
const AGE: Record<string, number> = { d: 86_400_000, m: 30 * 86_400_000, y: 365 * 86_400_000 };

function matchesTerm(box: Mailbox, m: Message, term: string): boolean {
  const colon = term.indexOf(":");
  const op = colon > 0 ? term.slice(0, colon).toLowerCase() : "";
  const value = (colon > 0 ? term.slice(colon + 1) : term).replace(/^"|"$/g, "").toLowerCase();
  const has = (label: string) => m.labelIds.includes(label);
  const header = (name: string) => headerOf(m.headers, name).toLowerCase();
  switch (op) {
    case "in":
      return value === "anywhere" || has(IN[value] ?? "");
    case "is":
      return value === "read" ? !has("UNREAD") : has(IS[value] ?? "");
    case "category":
      return has(CATEGORY[value] ?? "");
    case "label": {
      const label = box.labels.find((l) => slug(l.name) === slug(value) || slug(l.id) === value);
      return !!label && has(label.id);
    }
    case "from":
    case "to":
    case "cc":
    case "subject":
      return header(op).includes(value);
    case "has":
      return value === "attachment" && m.attachments.length > 0;
    case "filename":
      return m.attachments.some((a) => a.filename.toLowerCase().includes(value));
    case "older_than":
    case "newer_than": {
      const age = /^(\d+)([dmy])$/.exec(value);
      if (!age) return true;
      const cutoff = Date.now() - Number(age[1]) * AGE[age[2]];
      return op === "older_than" ? m.internalDate < cutoff : m.internalDate > cutoff;
    }
    case "after":
    case "before": {
      const time = new Date(value.replace(/\//g, "-")).getTime();
      if (Number.isNaN(time)) return true;
      return op === "after" ? m.internalDate >= time : m.internalDate < time;
    }
    default:
      return [header("subject"), header("from"), header("to"), plainText(m).toLowerCase()].some(
        (text) => text.includes(value),
      );
  }
}

function matchesQuery(box: Mailbox, m: Message, q: string): boolean {
  const terms = q.match(/-?(?:[\w]+:)?(?:"[^"]*"|\S+)/g) ?? [];
  return terms.every((term) => {
    if (term === "OR" || term === "AND") return true;
    const negated = term.startsWith("-") && term.length > 1;
    const hit = matchesTerm(box, m, negated ? term.slice(1) : term);
    return negated ? !hit : hit;
  });
}

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const notFound = () =>
  json(
    { error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } },
    404,
  );
const badRequest = (message: string) =>
  json({ error: { code: 400, message, status: "INVALID_ARGUMENT" } }, 400);

/** Mail to refused.example is refused, and to lost.example never answered, to try failed sends. */
function sendFailure(raw: string | undefined): Response | null {
  const text = new TextDecoder().decode(fromBase64(raw ?? ""));
  if (/@refused\.example\b/i.test(text)) return badRequest("Invalid To header");
  if (/@lost\.example\b/i.test(text)) {
    return json({ error: { code: 500, message: "Backend Error", status: "INTERNAL" } }, 500);
  }
  return null;
}

type MessageListing = {
  messages: Message[];
  withoutBins: Message[];
  labels: Map<string, LabelListing>;
  threadsTotal: number;
};

type LabelListing = {
  messages: Message[];
  withoutBins: Message[];
  messagesUnread: number;
  threadsTotal: number;
  threadsUnread: number;
};

const newestFirst = new WeakMap<Mailbox, Message[]>();
const listings = new WeakMap<Mailbox, { revision: number; ready: Promise<MessageListing> }>();

function listingOf(box: Mailbox): Promise<MessageListing> {
  const revision = box.historyId;
  const cached = listings.get(box);
  if (cached?.revision === revision) return cached.ready;
  const ready = buildListing(box).then((listing) =>
    revision === box.historyId ? listing : listingOf(box),
  );
  listings.set(box, { revision, ready });
  return ready;
}

async function buildListing(box: Mailbox): Promise<MessageListing> {
  let messages = newestFirst.get(box);
  if (!messages) {
    messages = Object.values(box.messages).sort((a, b) => b.internalDate - a.internalDate);
    newestFirst.set(box, messages);
  }
  const withoutBins: Message[] = [];
  const groups = new Map<
    string,
    {
      messages: Message[];
      withoutBins: Message[];
      unread: number;
      threads: Set<string>;
      unreadThreads: Set<string>;
    }
  >();
  const threads = new Set<string>();
  let deadline = Date.now() + FIXTURE_WORK_MS;
  for (const message of messages) {
    if (box.generated && Date.now() >= deadline) {
      await yieldThread();
      deadline = Date.now() + FIXTURE_WORK_MS;
    }
    threads.add(message.threadId);
    const binned = message.labelIds.includes("SPAM") || message.labelIds.includes("TRASH");
    const unread = message.labelIds.includes("UNREAD");
    if (!binned) withoutBins.push(message);
    for (const id of message.labelIds) {
      let group = groups.get(id);
      if (!group) {
        group = {
          messages: [],
          withoutBins: [],
          unread: 0,
          threads: new Set(),
          unreadThreads: new Set(),
        };
        groups.set(id, group);
      }
      group.messages.push(message);
      if (!binned) group.withoutBins.push(message);
      group.threads.add(message.threadId);
      if (unread) {
        group.unread++;
        group.unreadThreads.add(message.threadId);
      }
    }
  }
  const labels = new Map<string, LabelListing>();
  for (const [id, group] of groups) {
    labels.set(id, {
      messages: group.messages,
      withoutBins: group.withoutBins,
      messagesUnread: group.unread,
      threadsTotal: group.threads.size,
      threadsUnread: group.unreadThreads.size,
    });
  }
  return { messages, withoutBins, labels, threadsTotal: threads.size };
}

async function labelResource(box: Mailbox, label: Label): Promise<object> {
  const counts = (await listingOf(box)).labels.get(label.id);
  return {
    ...label,
    messageListVisibility: "show",
    labelListVisibility: "labelShow",
    messagesTotal: counts?.messages.length ?? 0,
    messagesUnread: counts?.messagesUnread ?? 0,
    threadsTotal: counts?.threadsTotal ?? 0,
    threadsUnread: counts?.threadsUnread ?? 0,
  };
}

async function listMessages(box: Mailbox, url: URL): Promise<Response> {
  const labelIds = url.searchParams.getAll("labelIds");
  const q = url.searchParams.get("q") ?? "";
  const includeSpamTrash =
    url.searchParams.get("includeSpamTrash") === "true" ||
    labelIds.some((l) => l === "SPAM" || l === "TRASH");
  const maxResults = Number(url.searchParams.get("maxResults") ?? 100);
  const offset = Number(url.searchParams.get("pageToken") ?? 0);
  const listing = await listingOf(box);
  const matching = labelIds.length ? listing.labels.get(labelIds[0]!) : listing;
  const field = includeSpamTrash ? "messages" : "withoutBins";
  const candidates = matching?.[field] ?? [];
  const required = labelIds.slice(1);
  const all =
    q || required.length
      ? candidates.filter(
          (m) => required.every((l) => m.labelIds.includes(l)) && matchesQuery(box, m, q),
        )
      : candidates;
  const page = all.slice(offset, offset + maxResults);
  return json({
    ...(page.length ? { messages: page.map((m) => ({ id: m.id, threadId: m.threadId })) } : {}),
    ...(offset + maxResults < all.length ? { nextPageToken: String(offset + maxResults) } : {}),
    resultSizeEstimate: all.length,
  });
}

function checkLabels(box: Mailbox, ids: string[]): string | null {
  const unknown = ids.find((id) => !box.labels.some((l) => l.id === id));
  return unknown ? `Invalid label: ${unknown}` : null;
}

function draftResource(box: Mailbox, draftId: string): object {
  const m = box.messages[box.drafts[draftId]];
  return { id: draftId, message: { id: m.id, threadId: m.threadId, labelIds: m.labelIds } };
}

async function gmail(
  box: Mailbox,
  method: string,
  url: URL,
  body: Record<string, unknown>,
): Promise<Response> {
  const path = url.pathname.replace(/^\/gmail\/v1\/users\/me\/?/, "").split("/");
  const [collection, id, action] = path.map(decodeURIComponent);
  const thread = (threadId: string) =>
    Object.values(box.messages).filter((m) => m.threadId === threadId);

  switch (collection) {
    case "profile": {
      const listing = await listingOf(box);
      return json({
        emailAddress: box.email,
        messagesTotal: listing.messages.length,
        threadsTotal: listing.threadsTotal,
        historyId: String(box.historyId),
      });
    }

    case "watch":
      return json({
        historyId: String(box.historyId),
        expiration: String(Date.now() + 7 * 86_400_000),
      });

    case "history": {
      const start = Number(url.searchParams.get("startHistoryId"));
      // A cursor from before a reset: Gmail's answer for an expired one.
      if (!(start <= box.historyId)) return notFound();
      const maxResults = Number(url.searchParams.get("maxResults") ?? 100);
      const offset = Number(url.searchParams.get("pageToken") ?? 0);
      const all = box.history.filter((h) => Number(h.id) > start);
      return json({
        history: all.slice(offset, offset + maxResults),
        historyId: String(box.historyId),
        ...(offset + maxResults < all.length ? { nextPageToken: String(offset + maxResults) } : {}),
      });
    }

    case "labels": {
      if (!id) {
        if (method === "POST") {
          const name = String(body.name ?? "").trim();
          if (!name) return badRequest("Invalid label name");
          if (box.labels.some((l) => l.name.toLowerCase() === name.toLowerCase()))
            return json({ error: { code: 409, message: "Label name exists or conflicts" } }, 409);
          const label: Label = { id: `Label_${newId(box)}`, name, type: "user" };
          box.labels.push(label);
          save();
          return json(await labelResource(box, label));
        }
        return json({ labels: box.labels.map(({ id, name, type }) => ({ id, name, type })) });
      }
      const label = box.labels.find((l) => l.id === id);
      if (!label) return notFound();
      if (method === "DELETE") {
        if (label.type === "system") return badRequest("Invalid delete request");
        box.labels = box.labels.filter((l) => l !== label);
        for (const m of Object.values(box.messages)) {
          if (m.labelIds.includes(id)) modify(box, m, [], [id]);
        }
        save();
        return json({}, 204);
      }
      if (method === "PATCH" || method === "PUT") {
        if (typeof body.name === "string") label.name = body.name;
        if (body.color) label.color = body.color as Label["color"];
        save();
      }
      return json(await labelResource(box, label));
    }

    case "messages": {
      if (!id) return method === "GET" ? listMessages(box, url) : notFound();
      if (id === "send" && method === "POST") {
        const failure = sendFailure(body.raw as string);
        if (failure) return failure;
        const m = fromRaw(box, String(body.raw ?? ""), body.threadId as string, ["SENT"]);
        addMessage(box, m);
        return json({ id: m.id, threadId: m.threadId, labelIds: m.labelIds });
      }
      if (id === "batchDelete" && method === "POST") {
        for (const messageId of (body.ids as string[]) ?? []) deleteMessage(box, messageId);
        return json({}, 204);
      }
      if (id === "batchModify" && method === "POST") {
        const add = (body.addLabelIds as string[]) ?? [];
        const invalid = checkLabels(box, add);
        if (invalid) return badRequest(invalid);
        for (const messageId of (body.ids as string[]) ?? []) {
          const m = box.messages[messageId];
          if (m) modify(box, m, add, (body.removeLabelIds as string[]) ?? []);
        }
        return json({}, 204);
      }
      const m = box.messages[id];
      if (!m) return notFound();
      if (action === "attachments") {
        const attachment = m.attachments.find((a) => a.id === path[3]);
        if (!attachment) return notFound();
        return json({
          size: attachment.size,
          data: attachment.data || attachmentData(`A made-up ${attachment.filename}.`),
        });
      }
      if (action === "modify") {
        const add = (body.addLabelIds as string[]) ?? [];
        const invalid = checkLabels(box, add);
        if (invalid) return badRequest(invalid);
        modify(box, m, add, (body.removeLabelIds as string[]) ?? []);
      } else if (action === "trash") modify(box, m, ["TRASH"], ["SPAM"]);
      else if (action === "untrash") modify(box, m, [], ["TRASH"]);
      else if (method === "DELETE") {
        deleteMessage(box, id);
        return json({}, 204);
      }
      return json(messageResource(box, m, url));
    }

    case "threads": {
      const messages = id ? thread(id) : [];
      if (messages.length === 0) return notFound();
      if (method === "DELETE") {
        for (const m of messages) deleteMessage(box, m.id);
        return json({}, 204);
      }
      if (action === "modify") {
        const add = (body.addLabelIds as string[]) ?? [];
        const invalid = checkLabels(box, add);
        if (invalid) return badRequest(invalid);
        for (const m of messages) modify(box, m, add, (body.removeLabelIds as string[]) ?? []);
      } else if (action === "trash") {
        for (const m of messages) modify(box, m, ["TRASH"], ["SPAM"]);
      } else if (action === "untrash") {
        for (const m of messages) modify(box, m, [], ["TRASH"]);
      }
      return json({
        id,
        historyId: String(box.historyId),
        // Like Gmail: a GET honours `format`; what a change returns is minimal.
        messages: messages.map((m) =>
          messageResource(box, m, action ? new URL("x:?format=minimal") : url),
        ),
      });
    }

    case "drafts": {
      if (!id) {
        if (method === "POST") {
          const message = (body.message ?? {}) as { raw?: string; threadId?: string };
          const m = fromRaw(box, message.raw ?? "", message.threadId, ["DRAFT"]);
          const draftId = `r-${m.id}`;
          box.drafts[draftId] = m.id;
          addMessage(box, m);
          return json(draftResource(box, draftId));
        }
        const drafts = Object.keys(box.drafts)
          .filter((draftId) => box.messages[box.drafts[draftId]])
          .map((draftId) => draftResource(box, draftId));
        return json({ drafts, resultSizeEstimate: drafts.length });
      }
      if (id === "send" && method === "POST") {
        const sent = box.messages[box.drafts[String(body.id)]];
        if (!sent) return notFound();
        const message = (body.message ?? {}) as { raw?: string };
        const failure = sendFailure(message.raw);
        if (failure) return failure;
        const m = fromRaw(box, message.raw ?? "", sent.threadId, ["SENT"]);
        deleteMessage(box, sent.id);
        addMessage(box, m);
        return json({ id: m.id, threadId: m.threadId, labelIds: m.labelIds });
      }
      const current = box.messages[box.drafts[id]];
      if (!current) return notFound();
      if (method === "DELETE") {
        deleteMessage(box, current.id);
        return json({}, 204);
      }
      if (method === "PUT") {
        const message = (body.message ?? {}) as { raw?: string };
        const m = fromRaw(box, message.raw ?? "", current.threadId, ["DRAFT"]);
        deleteMessage(box, current.id);
        box.drafts[id] = m.id;
        addMessage(box, m);
      }
      return json(draftResource(box, id));
    }

    case "settings": {
      const sendAs = {
        sendAsEmail: box.email,
        displayName: box.name,
        isPrimary: true,
        isDefault: true,
        signature: box.signature,
      };
      if (path[2]) {
        if (decodeURIComponent(path[2]).toLowerCase() !== box.email) return notFound();
        if (typeof body.signature === "string") {
          box.signature = body.signature;
          save();
        }
        return json({ ...sendAs, signature: box.signature });
      }
      const alias = {
        sendAsEmail: `hello@${box.email.split("@")[1]}`,
        displayName: box.name,
        verificationStatus: "accepted",
      };
      return json({ sendAs: [sendAs, alias] });
    }
  }
  return notFound();
}

function answer(
  url: URL,
  method: string,
  headers: Headers,
  rawBody: unknown,
): Response | Promise<Response> | null {
  if (url.hostname === "gmail.googleapis.com" && url.pathname.startsWith("/gmail/v1/users/me")) {
    const account = /^Bearer demo:(.+)$/.exec(headers.get("Authorization") ?? "")?.[1];
    const box = account ? state.mailboxes[account] : undefined;
    if (!box) return json({ error: { code: 401, message: "Not a demo account." } }, 401);
    const body = typeof rawBody === "string" && rawBody ? JSON.parse(rawBody) : {};
    return gmail(box, method, url, body as Record<string, unknown>);
  }
  if (url.hostname === "www.googleapis.com" && url.pathname.startsWith("/calendar/")) {
    const account = /^Bearer demo:(.+)$/.exec(headers.get("Authorization") ?? "")?.[1];
    if (!account) return json({ error: { code: 401, message: "Not a demo account." } }, 401);
    const body = typeof rawBody === "string" && rawBody ? JSON.parse(rawBody) : {};
    return fakeCalendar(account, method, url, body as Record<string, unknown>);
  }
  if (url.hostname === "www.googleapis.com" && url.pathname === "/oauth2/v3/userinfo") {
    const account = /^Bearer demo:(.+)$/.exec(headers.get("Authorization") ?? "")?.[1];
    const seed = SEEDS.find((s) => s.email === account);
    if (!seed) return json({ error: "Not a demo account." }, 401);
    return json({ email: seed.email, name: seed.name, picture: seed.picture });
  }
  if (url.hostname === "people.googleapis.com") return json({ results: [] });
  if (
    url.hostname === "www.gravatar.com" ||
    url.hostname === "icons.duckduckgo.com" ||
    (url.hostname === "www.google.com" && url.pathname.startsWith("/s2/favicons"))
  ) {
    return new Response(null, { status: 404 });
  }
  if (url.hostname.endsWith(".example") || url.hostname === "example.com") {
    return new Response(null, { status: 200 });
  }
  return null;
}

export async function installFakeGmail(
  demoFiles: Platform["files"],
  { messages = 0 }: { messages?: number } = {},
): Promise<void> {
  files = demoFiles;
  await loadState(messages);
  const todoist = await fakeTodoist(demoFiles);
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    if (url.origin === "https://api.todoist.com") return todoist(url, init);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const response =
      url.origin === FAKE_RELAY_URL
        ? await answerRelay(url, method, init?.body)
        : await answer(url, method, new Headers(init?.headers ?? request?.headers), init?.body);
    if (!response) return realFetch(input, init);
    await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
    return response;
  };
}

function demoAccount(seed: SeedAccount): MailAccount {
  return {
    id: seed.email,
    email: seed.email,
    name: seed.name,
    displayName: seed.displayName,
    color: seed.color,
    picture: seed.picture,
  };
}

export function demoGoogleAuth(): GoogleAuth {
  const isDemo = (accountId: string) => SEEDS.some((seed) => seed.email === accountId);
  return {
    bypassGmailQuota: (accountId) => Boolean(state?.mailboxes[accountId]?.generated),
    async load() {
      if ((await accountStore.listAccounts()).length > 0) return;
      for (const seed of DEMO_ACCOUNTS) await accountStore.addAccount(demoAccount(seed));
    },
    async addAccount(loginHint) {
      const present = new Set((await accountStore.listAccounts()).map((a) => a.id));
      const seed =
        SEEDS.find((s) => s.email === loginHint) ?? SEEDS.find((s) => !present.has(s.email));
      if (!seed) throw new Error("Every demo mailbox is already here.");
      const account = demoAccount(seed);
      await accountStore.addAccount(account);
      return account;
    },
    cancelSignIn() {},
    isSignedIn: isDemo,
    getAccessToken: async (accountId) => `demo:${accountId}`,
    getIdToken: async () => "demo-google-id-token",
    async removeTokens() {},
  };
}

export const largeGmailAccountId = DEMO_ACCOUNTS[0]!.email;

export async function stageLargeGmailChanges(accountId: string, count: number): Promise<number> {
  const box = state?.mailboxes[accountId];
  if (!box?.generated) throw new Error("The large fake Gmail mailbox is unavailable.");
  const gmail = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer demo:${accountId}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) throw new Error(`Fake Gmail returned ${response.status} for ${path}`);
    return response;
  };
  const { messages } = (await (await gmail(`/messages?maxResults=${count}`)).json()) as {
    messages: { id: string }[];
  };
  let netMessages = 0;
  for (const [index, { id }] of messages.entries()) {
    if (index % 5 < 2) {
      const raw = toBase64(
        new TextEncoder().encode(
          `From: Bench <bench@example.com>\r\nTo: ${accountId}\r\nSubject: New ${index}\r\n\r\nHello ${index}`,
        ),
      );
      await gmail("/messages/send", { method: "POST", body: JSON.stringify({ raw }) });
      netMessages++;
    } else if (index % 5 < 4) {
      const starred = box.messages[id]?.labelIds.includes("STARRED");
      await gmail(`/messages/${id}/modify?format=minimal`, {
        method: "POST",
        body: JSON.stringify({
          addLabelIds: starred ? [] : ["STARRED"],
          removeLabelIds: starred ? ["STARRED", "UNREAD", "INBOX"] : ["UNREAD", "INBOX"],
        }),
      });
    } else {
      await gmail(`/messages/${id}`, { method: "DELETE" });
      netMessages--;
    }
  }
  return netMessages;
}
