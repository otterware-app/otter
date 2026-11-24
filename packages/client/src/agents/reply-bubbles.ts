type Block = { kind: "heading" | "paragraph" | "item" | "other" | "rule"; source: string };

const fenceOf = (line: string) => /^\s*(```|~~~)/.exec(line)?.[1];
const isHeading = (line: string) => /^#{1,6} /.test(line.trim());
const isRule = (line: string) => /^([-*_])(\s*\1){2,}\s*$/.test(line.trim());
const isItem = (line: string) => /^\s*([-*+]|\d{1,9}[.)]) /.test(line);
const isDivider = (line: string) => /^\s*\|[\s|:-]*-[\s|:-]*$/.test(line);
const indent = (line: string) => /^[ \t]*/.exec(line)![0].replace(/\t/g, "  ").length;

/** A reply's Markdown as blocks, each with its own source: what parts bubbles, not how they look. */
function blocksOf(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", source: paragraph.join("\n") });
    paragraph = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const fence = fenceOf(line);
    if (fence) {
      flush();
      const start = i;
      i += 1;
      // An open fence takes what's left: the rest is still being written.
      while (i < lines.length && fenceOf(lines[i]) !== fence) i += 1;
      blocks.push({ kind: "other", source: lines.slice(start, i + 1).join("\n") });
      i += 1;
    } else if (!trimmed) {
      flush();
      i += 1;
    } else if (isHeading(line)) {
      flush();
      blocks.push({ kind: "heading", source: trimmed });
      i += 1;
    } else if (isRule(line)) {
      flush();
      blocks.push({ kind: "rule", source: trimmed });
      i += 1;
    } else if (trimmed.startsWith(">")) {
      flush();
      const start = i;
      while (i < lines.length && lines[i].trim().startsWith(">")) i += 1;
      blocks.push({ kind: "other", source: lines.slice(start, i).join("\n") });
    } else if (trimmed.startsWith("|") && isDivider(lines[i + 1] ?? "")) {
      flush();
      const start = i;
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) i += 1;
      blocks.push({ kind: "other", source: lines.slice(start, i).join("\n") });
    } else if (isItem(line)) {
      flush();
      const start = i;
      i += 1;
      // A line under an item, indented past its marker, goes on with it.
      while (
        i < lines.length &&
        lines[i].trim() &&
        !isItem(lines[i]) &&
        indent(lines[i]) >= indent(line) + 2 &&
        !fenceOf(lines[i]) &&
        !isHeading(lines[i])
      )
        i += 1;
      blocks.push({ kind: "item", source: lines.slice(start, i).join("\n") });
    } else {
      paragraph.push(line);
      i += 1;
    }
  }
  flush();
  return blocks;
}

/**
 * A reply as WhatsApp would show it, a bubble each, as Markdown: a paragraph, a list, a heading
 * with what follows it; code, a table, a quote or an image alone. Rules part bubbles and aren't drawn.
 */
export function replyBubbles(source: string): string[] {
  const bubbles: Block[][] = [];
  let heading: Block | null = null;
  for (const block of blocksOf(source)) {
    if (block.kind === "rule") continue;
    if (block.kind === "heading") {
      if (heading) bubbles.push([heading]);
      heading = block;
    } else if (!heading && block.kind === "item" && bubbles.at(-1)?.at(-1)?.kind === "item") {
      bubbles.at(-1)!.push(block);
    } else {
      bubbles.push(heading ? [heading, block] : [block]);
      heading = null;
    }
  }
  if (heading) bubbles.push([heading]);
  return bubbles.map((blocks) =>
    blocks.reduce(
      (text, block, i) =>
        i === 0
          ? block.source
          : `${text}${block.kind === "item" && blocks[i - 1].kind === "item" ? "\n" : "\n\n"}${block.source}`,
      "",
    ),
  );
}

/**
 * The bubbles of a reply still being written: the ones it has finished, so each comes in whole
 * and stays. The last waits for the next to start. A line being written that is still only a
 * list's marker or a rule's first marks isn't read: as a paragraph it would end the bubble
 * before it, and the item or rule it becomes take that bubble back.
 */
export function writtenBubbles(source: string): string[] {
  const line = source.slice(source.lastIndexOf("\n") + 1);
  const unsure = /^\s*([-*_ ]+|\+|\d{1,9}[.)]?)\s*$/.test(line);
  return replyBubbles(unsure ? source.slice(0, source.length - line.length) : source).slice(0, -1);
}
