export function decodeEntities(input: string): string {
  if (!input || !input.includes("&")) return input;
  return input
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&"); // last, so a single-encoded string never double-decodes
}

export function htmlToText(html: string): string {
  const text = html
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<a\s[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label) => {
      const shown = String(label)
        .replace(/<[^>]*>/g, "")
        .trim();
      return shown && !href.includes(shown) ? `${shown} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text)
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function bodyText(m: { bodyText: string | null; bodyHtml: string | null }): string {
  return (m.bodyText ?? (m.bodyHtml ? htmlToText(m.bodyHtml) : "")).trim();
}

/**
 * The body without its quoted history ("On … wrote:" and the "> " lines
 * after it, or Outlook's "Original Message"), which the thread's earlier
 * messages already hold. Short bodies stay whole.
 */
export function withoutQuote(text: string): string {
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    const quoteFollows = lines
      .slice(i)
      .every((l) => l.trim() === "" || l.trimStart().startsWith(">"));
    if (
      /^On .+wrote:$/i.test(line) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(line) ||
      (line.startsWith(">") && quoteFollows)
    ) {
      const main = lines.slice(0, i).join("\n").trimEnd();
      return main.trim().length < 20 ? text : main;
    }
  }
  return text;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function textToHtml(text: string): string {
  return text
    .split("\n")
    .map((line) => `<div>${line ? escapeHtml(line) : "<br>"}</div>`)
    .join("");
}

export function address(name: string, email: string): string {
  return name && name !== email ? `${name} <${email}>` : email;
}

const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");

export function localTime(ms: number): string {
  const d = new Date(ms);
  const offset = -d.getTimezoneOffset();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}` +
    `${offset >= 0 ? "+" : "-"}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

export function fullDate(ms: number): string {
  return new Date(ms).toLocaleString([], {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
