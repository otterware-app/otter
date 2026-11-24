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
