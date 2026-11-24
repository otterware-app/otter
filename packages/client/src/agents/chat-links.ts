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
