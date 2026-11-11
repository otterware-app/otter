/** Searching agent chats as T3 Code's sidebar searches threads: titles ranked, then messages. */

export interface SearchRange {
  readonly start: number;
  readonly end: number;
}

const ALPHANUMERIC = /[\p{L}\p{N}]/u;
const LOWERCASE = /\p{Ll}/u;
const UPPERCASE = /\p{Lu}/u;
const DIGIT = /\p{N}/u;
const WRAPPING_QUOTES = /^\s*["'`“”‘’]+|["'`“”‘’]+\s*$/g;

const WHOLE_WORD = 1;
const WORD_PREFIX = 0.8;
const MID_WORD = 0.3;
/** Shorter tokens only match where a word starts: "del" does not find "model". */
const MID_WORD_LENGTH = 4;
/** Shorter tokens don't search messages: two letters are in nearly every one. */
const MESSAGE_TOKEN_LENGTH = 3;
const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

/** Case and accents folded one UTF-16 unit at a time, so offsets still read from `text`. */
export function foldSearchText(text: string): string {
  return text
    .replace(/[\u0080-￿]/g, (character) => {
      const folded = character
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[‘’]/, "'");
      return folded.length === 1 ? folded : character;
    })
    .toLowerCase();
}

export function searchTokens(query: string): string[] {
  return foldSearchText(query.replace(WRAPPING_QUOTES, "").normalize("NFC"))
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/** After a non-letter, or at a camelCase or digit boundary. */
function startsWord(text: string, index: number): boolean {
  const character = text[index]!;
  if (!ALPHANUMERIC.test(character)) return true;
  const previous = text[index - 1];
  return (
    previous === undefined ||
    !ALPHANUMERIC.test(previous) ||
    (LOWERCASE.test(previous) && UPPERCASE.test(character)) ||
    DIGIT.test(previous) !== DIGIT.test(character)
  );
}

function endsWord(text: string, end: number): boolean {
  return end >= text.length || !ALPHANUMERIC.test(text[end]!) || startsWord(text, end);
}

/** The best place for `token` in `text` (`folded` is its fold): a whole word, a word's start, inside one. */
function findToken(
  text: string,
  folded: string,
  token: string,
): { readonly at: number; readonly quality: number } | null {
  let best: { at: number; quality: number } | null = null;
  for (let at = folded.indexOf(token); at !== -1; at = folded.indexOf(token, at + 1)) {
    const quality = !startsWord(text, at)
      ? token.length >= MID_WORD_LENGTH
        ? MID_WORD
        : 0
      : endsWord(text, at + token.length)
        ? WHOLE_WORD
        : WORD_PREFIX;
    if (quality > (best?.quality ?? 0)) best = { at, quality };
    if (quality === WHOLE_WORD) break;
  }
  return best;
}

function mergeRanges(ranges: SearchRange[]): SearchRange[] {
  const merged: SearchRange[] = [];
  for (const range of ranges.toSorted((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

/** How well `title` holds every token, and where; null when one is missing. */
export function matchTitle(
  title: string,
  tokens: readonly string[],
): { readonly quality: number; readonly ranges: SearchRange[] } | null {
  if (tokens.length === 0) return null;
  const folded = foldSearchText(title);
  const ranges: SearchRange[] = [];
  let total = 0;
  for (const token of tokens) {
    const found = findToken(title, folded, token);
    if (!found) return null;
    total += found.quality;
    ranges.push({ start: found.at, end: found.at + token.length });
  }
  const phrase = tokens.join(" ");
  const bonus =
    folded.trim() === phrase ? 0.5 : tokens.length > 1 && folded.includes(phrase) ? 0.25 : 0;
  return { quality: total / tokens.length + bonus, ranges: mergeRanges(ranges) };
}

/** Chats whose titles match, best first; recent ones lift a little, halving every two weeks. */
export function rankChatTitles<T extends { readonly title: string; readonly updatedAt: number }>(
  chats: readonly T[],
  query: string,
  now: number,
): { readonly chat: T; readonly ranges: SearchRange[] }[] {
  const tokens = searchTokens(query);
  return chats
    .flatMap((chat) => {
      const match = matchTitle(chat.title, tokens);
      if (!match) return [];
      const recency = 0.5 ** (Math.max(0, now - chat.updatedAt) / HALF_LIFE_MS);
      return [{ chat, ranges: match.ranges, score: match.quality * (1 + 0.25 * recency) }];
    })
    .sort((a, b) => b.score - a.score || b.chat.updatedAt - a.chat.updatedAt)
    .map(({ chat, ranges }) => ({ chat, ranges }));
}

/** The query's tokens long enough to search messages; none means no message search. */
export function messageTokens(query: string): string[] {
  return searchTokens(query).filter((token) => token.length >= MESSAGE_TOKEN_LENGTH);
}

/** Whether `text` holds every token, how well, and where the first one is. */
export function matchMessage(
  text: string,
  tokens: readonly string[],
): { readonly quality: number; readonly offset: number } | null {
  if (tokens.length === 0) return null;
  const folded = foldSearchText(text);
  let quality = WHOLE_WORD;
  let offset = text.length;
  for (const token of tokens) {
    const found = findToken(text, folded, token);
    if (!found) return null;
    quality = Math.min(quality, found.quality);
    offset = Math.min(offset, found.at);
  }
  return { quality, offset };
}

const SNIPPET_BEFORE = 24;
const SNIPPET_LENGTH = 140;

/** One line of `text` around `offset`, as a result row shows it. */
export function messageSnippet(text: string, offset: number): string {
  let start = Math.max(0, offset - SNIPPET_BEFORE);
  while (start > 0 && start < offset && ALPHANUMERIC.test(text[start - 1]!)) start++;
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  const line = text
    .slice(start, end)
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${start > 0 ? "…" : ""}${line}${end < text.length ? "…" : ""}`;
}

/** Every place a token matches in `text`, for highlighting. */
export function findTokenRanges(text: string, tokens: readonly string[]): SearchRange[] {
  const folded = foldSearchText(text);
  const ranges: SearchRange[] = [];
  for (const token of tokens) {
    for (let at = folded.indexOf(token); at !== -1; at = folded.indexOf(token, at + token.length)) {
      if (token.length >= MID_WORD_LENGTH || startsWord(text, at)) {
        ranges.push({ start: at, end: at + token.length });
      }
    }
  }
  return mergeRanges(ranges);
}

export function splitSearchText(
  text: string,
  ranges: readonly SearchRange[],
): { readonly text: string; readonly highlighted: boolean; readonly start: number }[] {
  const parts: { text: string; highlighted: boolean; start: number }[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor)
      parts.push({ text: text.slice(cursor, range.start), highlighted: false, start: cursor });
    parts.push({ text: text.slice(range.start, range.end), highlighted: true, start: range.start });
    cursor = range.end;
  }
  if (cursor < text.length)
    parts.push({ text: text.slice(cursor), highlighted: false, start: cursor });
  return parts;
}
