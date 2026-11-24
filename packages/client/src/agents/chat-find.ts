/**
 * Where `query` occurs in `text`, ignoring case. Folded by the pattern, so the offsets are the
 * text's own ("İstanbul" lowercased is longer).
 */
export function findMatches(text: string, query: string): { start: number; end: number }[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  return [...text.matchAll(pattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** The turns `query` occurs in, as `findMatches` finds it: their text and their steps' titles. */
export function findTurns(
  turns: {
    id: string;
    text: string;
    items?: ({ kind: "text"; text: string } | { kind: "step"; step: { title: string } })[];
  }[],
  query: string,
): string[] {
  const needle = query.trim();
  return turns
    .filter((turn) =>
      [
        turn.text,
        ...(turn.items ?? []).map((i) => (i.kind === "text" ? i.text : i.step.title)),
      ].some((text) => findMatches(text, needle).length > 0),
    )
    .map((turn) => turn.id);
}
