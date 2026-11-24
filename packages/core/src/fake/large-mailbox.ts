/**
 * A large made-up mailbox (`withFakeServices(platform, { gmailMessages })`), the same every time:
 * threads of one to eight messages over five years, from a few hundred senders, in the categories
 * and the seed's labels. Only each message's metadata is kept; its body is written when asked for.
 */
import type { FakeAttachment, FakeHeader, FakeMessage } from "./gmail.ts";

const YEAR_MS = 365 * 86_400_000;
const SPAN_MS = 5 * YEAR_MS;

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const pick = <T>(rand: () => number, list: readonly T[]): T =>
  list[Math.floor(rand() * list.length)]!;

const FIRST = [
  "Amara",
  "Ben",
  "Chloé",
  "Dmitri",
  "Elena",
  "Farid",
  "Grace",
  "Hiro",
  "Ines",
  "Jonas",
  "Kofi",
  "Lena",
  "Marco",
  "Nadia",
  "Omar",
  "Priya",
  "Quinn",
  "Rosa",
  "Sven",
  "Tara",
  "Uma",
  "Victor",
  "Wen",
  "Ximena",
  "Yusuf",
  "Zoe",
  "Aiden",
  "Beatriz",
  "Callum",
  "Dana",
];
const LAST = [
  "Okafor",
  "Lindqvist",
  "Moreau",
  "Ivanova",
  "Haddad",
  "Tanaka",
  "Nguyen",
  "García",
  "Schmidt",
  "Rossi",
  "Kowalski",
  "Mensah",
  "Patel",
  "O'Brien",
  "Dubois",
  "Kim",
  "Silva",
  "Novak",
  "Hart",
  "Bauer",
  "Costa",
  "Weber",
  "Ali",
  "Larsen",
  "Fischer",
];
const DOMAINS = [
  "gmail.example",
  "fastmail.example",
  "acme.example",
  "northwind.example",
  "contoso.example",
  "studio.example",
  "university.example",
  "hospital.example",
  "lawfirm.example",
  "bank.example",
];
const SENDERS = Array.from({ length: 300 }, (_, i) => {
  const first = FIRST[i % FIRST.length]!;
  const last = LAST[Math.floor(i / FIRST.length) % LAST.length]!;
  const domain = DOMAINS[(i * 3) % DOMAINS.length]!;
  const local = `${first}.${last}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z.]/g, "");
  return { name: `${first} ${last}`, email: `${local}@${domain}` };
});
const BRANDS = [
  ["Northwind Weekly", "news@northwind.example"],
  ["Trailhead Outfitters", "deals@trailhead.example"],
  ["Pixel Bank", "alerts@pixelbank.example"],
  ["Cloudline Status", "status@cloudline.example"],
  ["The Morning Ledger", "editors@ledger.example"],
  ["Parcelpoint", "tracking@parcelpoint.example"],
  ["Fable Books", "hello@fablebooks.example"],
  ["Gridiron Fantasy", "league@gridiron.example"],
  ["Openhouse Realty", "listings@openhouse.example"],
  ["Devforum", "digest@devforum.example"],
].map(([name, email]) => ({ name: name!, email: email! }));

const TOPICS = [
  "the quarterly plan",
  "the offsite",
  "Saturday's dinner",
  "the kitchen renovation",
  "the budget review",
  "the hiring loop",
  "the new office",
  "the conference talk",
  "the lease",
  "the school trip",
  "the product launch",
  "the board deck",
  "the insurance claim",
  "the design review",
  "the migration",
  "the photo book",
  "the tax return",
  "the wedding",
];
const PERSONAL = [
  (t: string) => `Notes on ${t}`,
  (t: string) => `Quick question about ${t}`,
  (t: string) => `Following up on ${t}`,
  (t: string) => `Draft for ${t}`,
  (t: string) => `Can we move ${t}?`,
  (t: string) => `Photos from ${t}`,
  (t: string) => `Thoughts on ${t}`,
];
const AUTOMATED = [
  (n: number) => `Your order #${100_000 + n} has shipped`,
  (n: number) => `Receipt for payment ${n % 9000}`,
  (n: number) => `Weekly digest, issue ${n % 400}`,
  (n: number) => `${n % 40} new listings match your search`,
  (n: number) => `Incident resolved: elevated error rates (${n % 97})`,
  (n: number) => `Your statement for account ending ${1000 + (n % 9000)}`,
  (n: number) => `Save ${10 + (n % 50)}% this weekend only`,
];
const WORDS = (
  "the a we our team plan week time next review project budget meeting call notes draft " +
  "update share think could would should maybe today tomorrow schedule client report numbers " +
  "design launch customer feedback quarter goals timeline risk scope decision context follow " +
  "agree change open question answer details attached version final early late morning " +
  "afternoon evening travel flight hotel dinner weekend family kids school house kitchen " +
  "garden contract invoice payment account order shipping delivery thanks again sorry about " +
  "delay happy great sounds good works for me let know if you have any"
).split(" ");

function sentence(rand: () => number): string {
  const words = Array.from({ length: 8 + Math.floor(rand() * 14) }, () => pick(rand, WORDS));
  return `${words.join(" ").replace(/^./, (c) => c.toUpperCase())}.`;
}

function paragraph(rand: () => number): string {
  return Array.from({ length: 2 + Math.floor(rand() * 5) }, () => sentence(rand)).join(" ");
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const CATEGORIES = [
  ["CATEGORY_PERSONAL", 0.45],
  ["CATEGORY_UPDATES", 0.25],
  ["CATEGORY_PROMOTIONS", 0.18],
  ["CATEGORY_SOCIAL", 0.07],
  ["CATEGORY_FORUMS", 0.05],
] as const;

function category(rand: () => number): string {
  let roll = rand();
  for (const [label, share] of CATEGORIES) {
    roll -= share;
    if (roll < 0) return label;
  }
  return "CATEGORY_PERSONAL";
}

/** Mostly short threads: about half are one message, a few run to eight. */
const threadSize = (rand: () => number) =>
  1 + Math.min(7, Math.floor(-Math.log(1 - rand() * 0.9999) * 1.4));

const ATTACHMENTS = [
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
] as const;

function address(person: { name: string; email: string }): string {
  return /[",<>@;:']/.test(person.name)
    ? `"${person.name.replace(/"/g, '\\"')}" <${person.email}>`
    : `${person.name} <${person.email}>`;
}

const rfc2822 = (time: number) => new Date(time).toUTCString().replace("GMT", "+0000");

/**
 * `count` messages for the mailbox of `me`, newest threads first. Ids are `prefix` and the
 * message's index in hex, so they never meet the seed's.
 */
export function largeMailbox(
  count: number,
  prefix: string,
  me: { name: string; email: string },
  userLabels: readonly string[],
  seededAt: number,
): FakeMessage[] {
  const messages: FakeMessage[] = [];
  const domain = me.email.split("@")[1];
  const idOf = (index: number) => `${prefix}f${index.toString(16).padStart(11, "0")}`;
  const threads = Math.ceil(count / 2.2);
  for (let t = 0; messages.length < count; t++) {
    const rand = random(t * 2_654_435_761 + 1);
    const automated = rand() < 0.45;
    const label = automated
      ? pick(rand, ["CATEGORY_UPDATES", "CATEGORY_PROMOTIONS"])
      : category(rand);
    const size = automated ? 1 : Math.min(threadSize(rand), count - messages.length);
    const them = automated ? pick(rand, BRANDS) : pick(rand, SENDERS);
    const subject = automated ? pick(rand, AUTOMATED)(t) : pick(rand, PERSONAL)(pick(rand, TOPICS));
    const newest = seededAt - (Math.min(t / threads, 1) ** 1.5 * SPAN_MS + rand() * 3_600_000);
    const recent = seededAt - newest < 30 * 86_400_000;
    const place = rand();
    const where =
      place < 0.004
        ? "SPAM"
        : place < 0.014
          ? "TRASH"
          : rand() < (recent ? 0.7 : 0.08)
            ? "INBOX"
            : null;
    const threadLabels = [
      ...(where ? [where] : []),
      label,
      ...(userLabels.length && rand() < 0.15 ? [pick(rand, userLabels)] : []),
      ...(rand() < 0.1 ? ["IMPORTANT"] : []),
    ];
    const starred = rand() < 0.02;
    const ids: string[] = [];
    const first = messages.length;
    for (let k = 0; k < size; k++) {
      const index = first + k;
      const id = idOf(index);
      const own = random(index * 40_503 + 7);
      const mine = k % 2 === 1 && own() < 0.6;
      const date = newest - (size - 1 - k) * (2 + own() * 46) * 3_600_000;
      const labelIds = mine
        ? ["SENT", ...threadLabels.filter((l) => l === "IMPORTANT" || userLabels.includes(l))]
        : [...threadLabels];
      if (!mine && own() < (recent ? 0.4 : 0.03)) labelIds.push("UNREAD");
      if (starred && k === size - 1) labelIds.push("STARRED");
      const headers: FakeHeader[] = [
        { name: "From", value: address(mine ? me : them) },
        { name: "To", value: address(mine ? them : me) },
        { name: "Subject", value: k === 0 ? subject : `Re: ${subject}` },
        { name: "Date", value: rfc2822(date) },
        { name: "Message-ID", value: `<${id}@${domain}>` },
        ...(ids.length > 0
          ? [
              { name: "In-Reply-To", value: `<${ids.at(-1)}@${domain}>` },
              { name: "References", value: ids.map((ref) => `<${ref}@${domain}>`).join(" ") },
            ]
          : []),
        ...(automated
          ? [
              {
                name: "List-Unsubscribe",
                value: `<https://${them.email.split("@")[1]}/unsubscribe>`,
              },
            ]
          : []),
      ];
      const attachments: FakeAttachment[] =
        !automated && own() < 0.08
          ? Array.from({ length: 1 + Math.floor(own() * 3) }, (_, n) => {
              const [mimeType, extension] = pick(own, ATTACHMENTS);
              return {
                id: `ANGjdJ_${id}_${n}`,
                filename: `${pick(own, TOPICS).replace(/^the /, "").replace(/\W+/g, "-")}-${n + 1}.${extension}`,
                mimeType,
                data: "",
                size: Math.floor(20_000 + own() ** 3 * 5_000_000),
              };
            })
          : [];
      ids.push(id);
      messages.push({
        id,
        threadId: ids[0]!,
        labelIds,
        internalDate: Math.round(date),
        headers,
        text: null,
        html: null,
        attachments,
        generated: index,
      });
    }
  }
  return messages;
}

function bodyStart(m: FakeMessage) {
  const rand = random(m.generated! * 7_919 + 3);
  const newsletter =
    m.labelIds.includes("CATEGORY_PROMOTIONS") || m.labelIds.includes("CATEGORY_UPDATES");
  const count = newsletter ? 12 + Math.floor(rand() * 30) : 2 + Math.floor(rand() * 6);
  return { rand, newsletter, count };
}

/** The start of a generated message's text, as long as its snippet needs, without the rest. */
export function generatedOpening(m: FakeMessage): string {
  const { rand, count } = bodyStart(m);
  let text = "Hi,";
  for (let i = 0; i < count && text.length < 200; i++) text += `\n\n${paragraph(rand)}`;
  return text;
}

/** A generated message's bodies: a few KB of HTML, a newsletter's tens, now and then hundreds. */
export function generatedBody(m: FakeMessage): { text: string; html: string } {
  const { rand, newsletter, count } = bodyStart(m);
  const from = m.headers
    .find((h) => h.name === "From")!
    .value.replace(/\s*<.*$/, "")
    .replace(/"/g, "");
  const paragraphs = Array.from({ length: count }, () => paragraph(rand));
  if (rand() < 0.01) {
    paragraphs.push(
      ...Array.from({ length: 200 + Math.floor(rand() * 800) }, () => paragraph(rand)),
    );
  }
  const text = [`Hi,`, ...paragraphs, from].join("\n\n");
  const html = newsletter
    ? `<!doctype html><html><head><style>body{margin:0;background:#f4f4f5}.wrap{max-width:600px;margin:0 auto;background:#fff;font-family:Helvetica,Arial,sans-serif}.item{padding:16px 24px;border-bottom:1px solid #e4e4e7}h2{font-size:18px;margin:0 0 8px}p{font-size:14px;line-height:1.5;color:#3f3f46}</style></head><body><table class="wrap" role="presentation" width="100%" cellpadding="0" cellspacing="0">${paragraphs
        .map(
          (p, i) =>
            `<tr><td class="item"><h2>${escapeHtml(sentence(rand))}</h2><p>${escapeHtml(p)}</p><a href="https://example.com/item/${i}" style="color:#2563eb">Read more</a></td></tr>`,
        )
        .join(
          "",
        )}<tr><td class="item"><p style="font-size:12px">You get this because you signed up. <a href="https://example.com/unsubscribe">Unsubscribe</a></p></td></tr></table></body></html>`
    : `<div dir="ltr"><div>Hi,</div><br>${paragraphs
        .map((p) => `<div>${escapeHtml(p)}</div><br>`)
        .join("")}<div>${escapeHtml(from)}</div></div>`;
  return { text, html };
}
