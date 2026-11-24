export function isChatFileLink(href: string): boolean {
  return (
    /^(file:|sandbox:|otter-artifact:|~\/)/i.test(href) ||
    (!/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href) &&
      /\.[a-z\d]{1,10}(?::\d+(?:-\d+)?)?(?:[?#].*)?$/i.test(href))
  );
}

export function isChatImageLink(href: string): boolean {
  return (
    /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,/i.test(href) ||
    /\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#].*)?$/i.test(href)
  );
}

/** The line a file link points at (`notes.md:12`, `a.ts:3-9`), when it names one. */
export function fileLinkLine(href: string): number | null {
  const line = /:(\d+)(?:-\d+)?(?:[?#].*)?$/.exec(href)?.[1];
  return line ? Number(line) : null;
}
