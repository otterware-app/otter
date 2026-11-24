/** A page's site, as a tab or the address bar shows it. */
export function hostOf(url: string): string {
  return URL.parse(url)?.host.replace(/^www\./, "") ?? url;
}

/** What's typed in an address bar, as the page to open: an address, or a search for the words. */
export function addressToUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^(https?|chrome-extension):\/\//i.test(text)) return text;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/\S*)?$/i.test(text)) return `http://${text}`;
  if (/^[^\s/:]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(text)) return `https://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}
