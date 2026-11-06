import type { ByteStream } from "@otter-mail/core";
import { DEMO_ALIAS_ACCOUNT, type SeedThread } from "@otter-mail/shared/demo-mailboxes";

/**
 * The demo's iCloud-shaped mailbox (DEMO_ALIAS_ACCOUNT, with its two alias
 * mailboxes), served by a pretend IMAP server inside the worker: just what
 * core's IMAP provider asks of one to list, sync, read, flag and move mail.
 * Its changes last until the app quits; the mail stays in core's cache.
 */

export const DEMO_IMAP = DEMO_ALIAS_ACCOUNT;

type Message = { uid: number; flags: Set<string>; raw: Uint8Array; date: number };
type Folder = { flags: string; uidNext: number; messages: Message[] };

const UID_VALIDITY = 1;
const encoder = new TextEncoder();
const FOLDERS: [string, string][] = [
  ["INBOX", ""],
  ["Archive", "\\Archive"],
  ["Drafts", "\\Drafts"],
  ["Sent Messages", "\\Sent"],
  ["Junk", "\\Junk"],
  ["Deleted Messages", "\\Trash"],
];

type Part = {
  type: string;
  subtype: string;
  params: Record<string, string>;
  body: string;
  disposition?: string;
  filename?: string;
  encoding: string;
};

const address = (p: { name: string; email: string }) => `${p.name} <${p.email}>`;

function wrap64(base64: string): string {
  return base64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

/** The message's source, and the parts its BODYSTRUCTURE describes. */
function source(
  headers: string[],
  parts: Part[],
  alternative: boolean,
): { raw: string; structure: string } {
  const head = (p: Part) =>
    [
      `Content-Type: ${p.type}/${p.subtype}${Object.entries(p.params)
        .map(([k, v]) => `; ${k}="${v}"`)
        .join("")}`,
      `Content-Transfer-Encoding: ${p.encoding}`,
      ...(p.disposition ? [`Content-Disposition: ${p.disposition}; filename="${p.filename}"`] : []),
    ].join("\r\n");
  const single = (p: Part) => {
    const size = encoder.encode(p.body).length;
    const params = `(${Object.entries(p.params)
      .map(([k, v]) => `"${k.toUpperCase()}" "${v}"`)
      .join(" ")})`;
    const disposition = p.disposition
      ? `("${p.disposition.toUpperCase()}" ("FILENAME" "${p.filename}"))`
      : "NIL";
    return p.type === "text"
      ? `("TEXT" "${p.subtype.toUpperCase()}" ${params} NIL NIL "${p.encoding.toUpperCase()}" ${size} ${p.body.split("\r\n").length} NIL ${disposition} NIL)`
      : `("${p.type.toUpperCase()}" "${p.subtype.toUpperCase()}" ${params} NIL NIL "${p.encoding.toUpperCase()}" ${size} NIL ${disposition} NIL)`;
  };
  const multipart = (
    subtype: string,
    boundary: string,
    children: { raw: string; structure: string }[],
  ) => ({
    raw: [
      `Content-Type: multipart/${subtype}; boundary="${boundary}"`,
      "",
      ...children.flatMap((c) => [`--${boundary}`, c.raw]),
      `--${boundary}--`,
      "",
    ].join("\r\n"),
    structure: `(${children.map((c) => c.structure).join("")} "${subtype.toUpperCase()}" ("BOUNDARY" "${boundary}") NIL NIL NIL)`,
  });
  const leaf = (p: Part) => ({ raw: `${head(p)}\r\n\r\n${p.body}`, structure: single(p) });
  const [text, ...rest] = parts;
  const body = alternative
    ? multipart("alternative", "alt", [leaf(text!), leaf(rest.shift()!)])
    : leaf(text!);
  const whole = rest.length > 0 ? multipart("mixed", "mix", [body, ...rest.map(leaf)]) : body;
  return { raw: `${headers.join("\r\n")}\r\n${whole.raw}`, structure: whole.structure };
}

function seed(now: number): Map<string, Folder> {
  const folders = new Map<string, Folder>(
    [...FOLDERS, ...DEMO_IMAP.labels.map((l): [string, string] => [l.name, ""])].map(
      ([name, flags]) => [name, { flags, uidNext: 1, messages: [] }],
    ),
  );
  const me = { name: DEMO_IMAP.name, email: DEMO_IMAP.email };
  const own = new Set([DEMO_IMAP.email, ...DEMO_IMAP.sendAs].map((a) => a.toLowerCase()));
  const threads: SeedThread[] = DEMO_IMAP.threads(now);
  threads.forEach((thread, t) => {
    const ids: string[] = [];
    thread.messages.forEach((message, m) => {
      const from = message.from ?? me;
      const firstSender = thread.messages.find((x) => x.from)?.from;
      const to = message.to ?? (from === me && firstSender ? [firstSender] : [me]);
      const date = now - message.hoursAgo * 3_600_000;
      const id = message.headers?.["Message-ID"] ?? `<demo-${t}-${m}@icloud.example>`;
      const headers = [
        `From: ${address(from)}`,
        `To: ${to.map(address).join(", ")}`,
        ...(message.cc?.length ? [`Cc: ${message.cc.map(address).join(", ")}`] : []),
        `Subject: ${thread.subject}`,
        `Date: ${new Date(date).toUTCString()}`,
        `Message-ID: ${id}`,
        ...(ids.length ? [`In-Reply-To: ${ids.at(-1)}`, `References: ${ids.join(" ")}`] : []),
        ...Object.entries(message.headers ?? {})
          .filter(([k]) => k !== "Message-ID")
          .map(([k, v]) => `${k}: ${v}`),
        "MIME-Version: 1.0",
      ];
      ids.push(id);
      const text: Part = {
        type: "text",
        subtype: "plain",
        params: { charset: "utf-8" },
        body: message.text.replace(/\r?\n/g, "\r\n"),
        encoding: "8bit",
      };
      const html: Part[] = message.html
        ? [
            {
              type: "text",
              subtype: "html",
              params: { charset: "utf-8" },
              body: message.html.replace(/\r?\n/g, "\r\n"),
              encoding: "8bit",
            },
          ]
        : [];
      const attachments: Part[] = (message.attachments ?? []).map((a) => {
        const [type, subtype] = a.mimeType.split("/");
        return {
          type: type!,
          subtype: subtype!,
          params: { name: a.filename },
          body: wrap64(a.content),
          disposition: "attachment",
          filename: a.filename,
          encoding: "base64",
        };
      });
      const built = source(headers, [text, ...html, ...attachments], html.length > 0);
      const flags = new Set<string>();
      if (!message.unread) flags.add("\\Seen");
      if (message.starred) flags.add("\\Flagged");
      const mine = own.has(from.email.toLowerCase());
      const places = message.draft
        ? ["Drafts"]
        : mine
          ? ["Sent Messages"]
          : thread.labels.filter((l) => l !== "SENT").map((l) => (l === "ARCHIVE" ? "Archive" : l));
      for (const place of places.length ? places : ["Archive"]) {
        const folder = folders.get(place);
        if (!folder) continue;
        folder.messages.push({
          uid: folder.uidNext++,
          flags: new Set(flags),
          raw: encoder.encode(built.raw),
          date,
        });
        structures.set(built.raw, built.structure);
      }
    });
  });
  return folders;
}

const structures = new Map<string, string>();
let mailbox: Map<string, Folder> | null = null;

const literal = (text: string | Uint8Array) => {
  const bytes = typeof text === "string" ? encoder.encode(text) : text;
  return [encoder.encode(`{${bytes.length}}\r\n`), bytes];
};
const nstring = (text: string | null) => (text ? literal(text) : [encoder.encode("NIL")]);

function header(raw: string, name: string): string | null {
  const head = raw.slice(0, raw.indexOf("\r\n\r\n"));
  const match = new RegExp(`^${name}: (.*)$`, "im").exec(head);
  return match ? match[1]! : null;
}

function envelope(raw: string): (string | Uint8Array)[] {
  const addresses = (value: string | null) => {
    if (!value) return ["NIL"];
    const list = value.split(/,\s*/).map((entry) => {
      const [, name = "", email = entry] = /^(.*?)\s*<(.+)>$/.exec(entry) ?? [];
      const [box, host] = email.split("@");
      return ["(", ...nstring(name), " NIL ", ...nstring(box!), " ", ...nstring(host!), ")"];
    });
    return ["(", ...list.flat(), ")"];
  };
  return [
    "(",
    ...nstring(header(raw, "Date")),
    " ",
    ...nstring(header(raw, "Subject")),
    " ",
    ...addresses(header(raw, "From")),
    " ",
    ...addresses(header(raw, "From")),
    " ",
    ...addresses(header(raw, "From")),
    " ",
    ...addresses(header(raw, "To")),
    " ",
    ...addresses(header(raw, "Cc")),
    " NIL ",
    ...nstring(header(raw, "In-Reply-To")),
    " ",
    ...nstring(header(raw, "Message-ID")),
    ")",
  ];
}

function inSet(set: string, uid: number, top: number): boolean {
  return set.split(",").some((range) => {
    const [a, b = a] = range.split(":").map((n) => (n === "*" ? top : Number(n)));
    return uid >= Math.min(a!, b!) && uid <= Math.max(a!, b!);
  });
}

const unquote = (word: string) => word.replace(/^"(.*)"$/, "$1");

class DemoImapStream implements ByteStream {
  private out: Uint8Array[] = [];
  private waiting: ((chunk: Uint8Array | null) => void) | null = null;
  private pending = new Uint8Array();
  private selected: Folder | null = null;
  private closed = false;

  constructor(private folders: Map<string, Folder>) {
    this.send("* OK [CAPABILITY IMAP4rev1 LITERAL+ UIDPLUS MOVE SPECIAL-USE] Demo IMAP ready\r\n");
  }

  private send(...parts: (string | Uint8Array)[]): void {
    for (const part of parts) {
      const chunk = typeof part === "string" ? encoder.encode(part) : part;
      if (this.waiting) {
        const resolve = this.waiting;
        this.waiting = null;
        resolve(chunk);
      } else this.out.push(chunk);
    }
  }

  read(): Promise<Uint8Array | null> {
    const chunk = this.out.shift();
    if (chunk) return Promise.resolve(chunk);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => (this.waiting = resolve));
  }

  async write(data: Uint8Array): Promise<void> {
    const joined = new Uint8Array(this.pending.length + data.length);
    joined.set(this.pending);
    joined.set(data, this.pending.length);
    this.pending = joined;
    for (;;) {
      const command = this.takeCommand();
      if (!command) return;
      this.answer(command.line, command.literals);
    }
  }

  /** One command: its line, with its literals (LITERAL+'s `{n+}`, as advertised) taken out. */
  private takeCommand(): { line: string; literals: Uint8Array[] } | null {
    const bytes = this.pending;
    const literals: Uint8Array[] = [];
    let line = "";
    let at = 0;
    for (;;) {
      let end = at;
      while (end + 1 < bytes.length && !(bytes[end] === 13 && bytes[end + 1] === 10)) end++;
      if (end + 1 >= bytes.length) return null;
      const part = new TextDecoder().decode(bytes.slice(at, end));
      const literal = /\{(\d+)\+?\}$/.exec(part);
      if (!literal) {
        this.pending = bytes.slice(end + 2);
        return { line: line + part, literals };
      }
      const size = Number(literal[1]);
      if (bytes.length < end + 2 + size) return null;
      literals.push(bytes.slice(end + 2, end + 2 + size));
      line += part.slice(0, -literal[0].length);
      at = end + 2 + size;
    }
  }

  private answer(line: string, literals: Uint8Array[]): void {
    const [tag = "*", ...words] = line.split(" ");
    const verb = (words[0] === "UID" ? `UID ${words[1]}` : (words[0] ?? "")).toUpperCase();
    const args = words.slice(verb.startsWith("UID ") ? 2 : 1);
    const ok = (code = "") => this.send(`${tag} OK ${code}done\r\n`);
    const folder = (name: string) => this.folders.get(unquote(name)) ?? null;
    switch (verb) {
      case "CAPABILITY":
        this.send("* CAPABILITY IMAP4rev1 LITERAL+ UIDPLUS MOVE SPECIAL-USE\r\n");
        return ok();
      case "LOGIN":
      case "NOOP":
      case "ID":
      case "CHECK":
        return ok();
      case "LOGOUT":
        this.send("* BYE\r\n");
        ok();
        return this.close();
      case "LIST":
      case "LSUB":
        for (const [name, f] of this.folders) {
          this.send(`* ${verb} (\\HasNoChildren${f.flags ? ` ${f.flags}` : ""}) "/" "${name}"\r\n`);
        }
        return ok();
      case "STATUS": {
        const name = /^STATUS ("[^"]*"|\S+)/i.exec(words.join(" "))?.[1] ?? "";
        const f = folder(name);
        if (!f) return this.send(`${tag} NO no such folder\r\n`);
        const unseen = f.messages.filter((m) => !m.flags.has("\\Seen")).length;
        this.send(
          `* STATUS ${name} (MESSAGES ${f.messages.length} UIDNEXT ${f.uidNext} UIDVALIDITY ${UID_VALIDITY} UNSEEN ${unseen})\r\n`,
        );
        return ok();
      }
      case "SELECT":
      case "EXAMINE": {
        const f = folder(args.join(" "));
        if (!f) return this.send(`${tag} NO no such folder\r\n`);
        this.selected = f;
        this.send(
          `* ${f.messages.length} EXISTS\r\n* FLAGS (\\Seen \\Flagged \\Deleted \\Draft \\Answered)\r\n* OK [UIDVALIDITY ${UID_VALIDITY}] ok\r\n* OK [UIDNEXT ${f.uidNext}] ok\r\n`,
        );
        return ok(verb === "EXAMINE" ? "[READ-ONLY] " : "[READ-WRITE] ");
      }
      case "CLOSE":
      case "UNSELECT":
        this.selected = null;
        return ok();
      case "CREATE":
        this.folders.set(unquote(args.join(" ")), { flags: "", uidNext: 1, messages: [] });
        return ok();
      case "DELETE":
        this.folders.delete(unquote(args.join(" ")));
        return ok();
      case "APPEND": {
        const name = /^("[^"]*"|\S+)/.exec(args.join(" "))?.[1] ?? "";
        const f = folder(name);
        const raw = literals[0];
        if (!f || !raw) return this.send(`${tag} NO can't append\r\n`);
        const flags = new Set(
          /\(([^)]*)\)/.exec(args.join(" "))?.[1]?.split(" ").filter(Boolean) ?? [],
        );
        const uid = f.uidNext++;
        f.messages.push({ uid, flags, raw, date: Date.now() });
        return ok(`[APPENDUID ${UID_VALIDITY} ${uid}] `);
      }
    }
    const box = this.selected;
    if (!box) return this.send(`${tag} BAD select a folder first\r\n`);
    const top = box.uidNext - 1;
    switch (verb) {
      case "UID SEARCH":
      case "SEARCH": {
        const rest = args.join(" ");
        const id = /HEADER Message-ID ("[^"]*"|\S+)/i.exec(rest)?.[1];
        const uids = box.messages
          .filter(
            (m) => !id || header(new TextDecoder().decode(m.raw), "Message-ID") === unquote(id),
          )
          .filter((m) => !/\bUNDELETED\b/i.test(rest) || !m.flags.has("\\Deleted"))
          .map((m) => m.uid);
        this.send(`* SEARCH${uids.map((u) => ` ${u}`).join("")}\r\n`);
        return ok();
      }
      case "UID FETCH": {
        const [set = "", ...items] = args;
        const wanted = items.join(" ").toUpperCase();
        box.messages.forEach((m, i) => {
          if (!inSet(set, m.uid, top)) return;
          const raw = new TextDecoder().decode(m.raw);
          const split = raw.indexOf("\r\n\r\n");
          const parts: (string | Uint8Array)[] = [`* ${i + 1} FETCH (UID ${m.uid}`];
          if (wanted.includes("FLAGS")) parts.push(` FLAGS (${[...m.flags].join(" ")})`);
          if (wanted.includes("INTERNALDATE"))
            parts.push(` INTERNALDATE "${internalDate(m.date)}"`);
          if (wanted.includes("RFC822.SIZE")) parts.push(` RFC822.SIZE ${m.raw.length}`);
          if (wanted.includes("ENVELOPE")) parts.push(" ENVELOPE ", ...envelope(raw));
          if (wanted.includes("BODYSTRUCTURE")) {
            parts.push(` BODYSTRUCTURE ${structures.get(raw) ?? structureOf(raw)}`);
          }
          const fields = /BODY\.PEEK\[HEADER\.FIELDS \(([^)]*)\)\]/.exec(wanted)?.[1];
          if (fields) {
            const lines = fields
              .split(" ")
              .flatMap((name) => {
                const value = header(raw, name);
                return value === null ? [] : [`${name}: ${value}\r\n`];
              })
              .join("");
            parts.push(` BODY[HEADER.FIELDS (${fields})] `, ...literal(`${lines}\r\n`));
          }
          if (/BODY\.PEEK\[\](?!<)/.test(wanted)) parts.push(" BODY[] ", ...literal(m.raw));
          const start = /BODY\.PEEK\[TEXT\]<0\.(\d+)>/.exec(wanted)?.[1];
          if (start) {
            const text = encoder.encode(raw.slice(split + 4)).slice(0, Number(start));
            parts.push(" BODY[TEXT]<0> ", ...literal(text));
          }
          this.send(...parts, ")\r\n");
        });
        return ok();
      }
      case "UID STORE": {
        const [set = "", op = "", ...rest] = args;
        const flags = rest.join(" ").replace(/[()]/g, "").split(" ").filter(Boolean);
        for (const m of box.messages) {
          if (!inSet(set, m.uid, top)) continue;
          if (op.startsWith("+")) flags.forEach((f) => m.flags.add(f));
          else if (op.startsWith("-")) flags.forEach((f) => m.flags.delete(f));
          else m.flags = new Set(flags);
        }
        return ok();
      }
      case "UID COPY":
      case "UID MOVE": {
        const [set = "", ...rest] = args;
        const target = folder(rest.join(" "));
        if (!target) return this.send(`${tag} NO [TRYCREATE] no such folder\r\n`);
        const moving = box.messages.filter((m) => inSet(set, m.uid, top));
        const from: number[] = [];
        const to: number[] = [];
        for (const m of moving) {
          const uid = target.uidNext++;
          target.messages.push({ ...m, uid, flags: new Set(m.flags) });
          from.push(m.uid);
          to.push(uid);
        }
        if (verb === "UID MOVE") {
          box.messages = box.messages.filter((m) => !moving.includes(m));
        }
        return ok(
          from.length ? `[COPYUID ${UID_VALIDITY} ${from.join(",")} ${to.join(",")}] ` : "",
        );
      }
      case "EXPUNGE":
      case "UID EXPUNGE":
        box.messages = box.messages.filter((m) => !m.flags.has("\\Deleted"));
        return ok();
      default:
        return this.send(`${tag} BAD ${verb} isn't pretended here\r\n`);
    }
  }

  async startTls(): Promise<void> {}

  close(): void {
    this.closed = true;
    this.waiting?.(null);
    this.waiting = null;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function internalDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

/** An appended message (a draft, a sent copy): described as text, which is all core reads from it. */
function structureOf(raw: string): string {
  const size = encoder.encode(raw.slice(raw.indexOf("\r\n\r\n") + 4)).length;
  const type = /^Content-Type: (\w+)\/([\w.+-]+)/im.exec(raw);
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(raw)?.[1];
  if (type?.[1]?.toLowerCase() === "multipart" && boundary) {
    return `(("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "8BIT" ${size} 1) "${type[2]!.toUpperCase()}" ("BOUNDARY" "${boundary}"))`;
  }
  return `("TEXT" "${(type?.[2] ?? "plain").toUpperCase()}" ("CHARSET" "utf-8") NIL NIL "8BIT" ${size} 1)`;
}

/** A connection to the pretend server; every connection sees the same mail. */
export function connectDemoImap(): ByteStream {
  mailbox ??= seed(Date.now());
  return new DemoImapStream(mailbox);
}
