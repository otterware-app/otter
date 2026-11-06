/**
 * The agent's answers as blocks and styled spans, for React Native to draw:
 * what the web's react-markdown with remark-gfm shows of them (headings,
 * lists, quotes, code, tables, rules; bold, italics, code, strikethrough and
 * links inline). Not CommonMark: enough of it for what models write.
 */

export type Span = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  href?: string;
};

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { type: "paragraph"; spans: Span[] }
  | { type: "heading"; level: number; spans: Span[] }
  | { type: "code"; lang: string; text: string }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "quote"; blocks: Block[] }
  | { type: "table"; align: Align[]; header: Span[][]; rows: Span[][][] }
  | { type: "rule" };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

export function parseMarkdown(source: string): Block[] {
  return blocks(source.replace(/\r\n?/g, "\n").split("\n"));
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) out.push({ type: "paragraph", spans: inline(paragraph.join("\n")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const close = new RegExp(`^ {0,3}${fence[1]![0]}{${fence[1]!.length},}\\s*$`);
      const body: string[] = [];
      for (i += 1; i < lines.length && !close.test(lines[i]!); i += 1) body.push(lines[i]!);
      out.push({ type: "code", lang: fence[2] ?? "", text: body.join("\n") });
      i += 1;
      continue;
    }
    if (!line.trim()) {
      flush();
      i += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      out.push({ type: "heading", level: heading[1]!.length, spans: inline(heading[2]!) });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      flush();
      out.push({ type: "rule" });
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      for (; i < lines.length && lines[i]!.trim(); i += 1) {
        const m = QUOTE.exec(lines[i]!);
        quoted.push(m ? m[1]! : lines[i]!);
      }
      out.push({ type: "quote", blocks: blocks(quoted) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]!)) {
      const header = cells(line);
      const align = cells(lines[i + 1]!).map(alignOf);
      if (align.length === header.length) {
        flush();
        const rows: Span[][][] = [];
        for (i += 2; i < lines.length && lines[i]!.includes("|") && lines[i]!.trim(); i += 1) {
          const row = cells(lines[i]!);
          rows.push(header.map((_, c) => inline(row[c] ?? "")));
        }
        out.push({ type: "table", align, header: header.map((h) => inline(h)), rows });
        continue;
      }
    }
    const item = ITEM.exec(line);
    if (item && (paragraph.length === 0 || item[1]!.length === 0)) {
      flush();
      i = list(lines, i, out);
      continue;
    }
    paragraph.push(line.trim());
    i += 1;
  }
  flush();
  return out;
}

/** A list from line `i`: its items, each with what's indented under it. Returns the line after it. */
function list(lines: string[], i: number, out: Block[]): number {
  const first = ITEM.exec(lines[i]!)!;
  const indent = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const items: Block[][] = [];
  let body: string[] | null = null;
  let contentIndent = 0;
  const end = () => {
    if (body) items.push(blocks(body));
  };
  for (; i < lines.length; i += 1) {
    const line = lines[i]!;
    const m = ITEM.exec(line);
    if (m && m[1]!.length === indent && /\d/.test(m[2]!) === ordered) {
      end();
      body = [m[3]!];
      contentIndent = indent + m[2]!.length + 1;
      continue;
    }
    if (!line.trim()) {
      const next = lines[i + 1];
      if (next === undefined || (!next.startsWith(" ".repeat(indent + 1)) && !ITEM.test(next)))
        break;
      body?.push("");
      continue;
    }
    const lead = line.length - line.trimStart().length;
    if (lead > indent) {
      body?.push(line.slice(Math.min(lead, contentIndent)));
      continue;
    }
    if (m || FENCE.test(line) || HEADING.test(line) || QUOTE.test(line)) break;
    // A lazy continuation of the item's paragraph.
    body?.push(line.trim());
  }
  end();
  out.push({ type: "list", ordered, start: ordered ? parseInt(first[2]!, 10) : 1, items });
  return i;
}

function cells(row: string): string[] {
  const trimmed = row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : null;
}

type Style = Omit<Span, "text">;

const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)|<(https?:\/\/[^\s>]+)>|(https?:\/\/[^\s<]*[^\s<.,:;"')\]])|(\*\*|__)(?=\S)([\s\S]*?\S)\7|~~(?=\S)([\s\S]*?\S)~~|(\*|_)(?=\S)([\s\S]*?\S)\10|\\([\\`*_{}[\]()#+\-.!|~>])/g;

/** Inline markdown as spans; a `_` inside a word stays a character, as GFM has it. */
export function inline(text: string, style: Style = {}): Span[] {
  const spans: Span[] = [];
  const push = (t: string, s: Style = style) => {
    if (!t) return;
    const last = spans[spans.length - 1];
    if (last && sameStyle(last, s)) last.text += t;
    else spans.push({ text: t, ...s });
  };
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index;
    if (m[10] === "_" || m[7] === "__") {
      const before = text[start - 1];
      const after = text[start + m[0].length];
      if ((before && /\w/.test(before)) || (after && /\w/.test(after))) continue;
    }
    push(text.slice(at, start));
    at = start + m[0].length;
    if (m[1] !== undefined) push(m[2]!.replace(/^ (.*) $/, "$1"), { ...style, code: true });
    else if (m[3] !== undefined) {
      for (const s of inline(m[3], { ...style, href: m[4]! })) spans.push(s);
    } else if (m[5] ?? m[6]) push(m[5] ?? m[6]!, { ...style, href: m[5] ?? m[6]! });
    else if (m[8] !== undefined)
      for (const s of inline(m[8], { ...style, bold: true })) push(s.text, s);
    else if (m[9] !== undefined)
      for (const s of inline(m[9], { ...style, strike: true })) push(s.text, s);
    else if (m[11] !== undefined)
      for (const s of inline(m[11], { ...style, italic: true })) push(s.text, s);
    else if (m[12] !== undefined) push(m[12]);
  }
  push(text.slice(at));
  return spans;
}

function sameStyle(a: Style, b: Style): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.code) === Boolean(b.code) &&
    Boolean(a.strike) === Boolean(b.strike) &&
    a.href === b.href
  );
}
