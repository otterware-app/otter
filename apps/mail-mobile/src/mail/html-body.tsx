"use dom";

import type { DOMProps } from "expo/dom";
import { useEffect, useMemo, useRef } from "react";

const tags = new Set(
  "a abbr b blockquote br caption center code dd del div dl dt em h1 h2 h3 h4 h5 h6 hr i img ins li ol p pre s small span strong sub sup table tbody td th thead tr u ul".split(
    " ",
  ),
);
const removed = new Set([
  "script",
  "style",
  "head",
  "iframe",
  "object",
  "template",
  "svg",
  "math",
  "form",
]);
const attributes = [
  "align",
  "alt",
  "cellpadding",
  "cellspacing",
  "colspan",
  "dir",
  "height",
  "rowspan",
  "title",
  "width",
];
const layoutStyles = new Set([
  "display",
  "width",
  "height",
  "min-width",
  "max-width",
  "max-height",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "border",
  "border-width",
  "border-style",
  "border-radius",
  "border-collapse",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "text-align",
  "text-decoration",
  "vertical-align",
  "white-space",
]);
const lightStyles = new Set(["color", "background-color", "border-color"]);

function safeHtml(html: string, light: boolean, inlineImages: Record<string, string>) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const clean = parsed.implementation.createHTMLDocument("");
  function copy(from: Node, into: HTMLElement) {
    if (from.nodeType === Node.TEXT_NODE) {
      into.append(clean.createTextNode(from.textContent ?? ""));
      return;
    }
    if (!(from instanceof Element) || from.namespaceURI !== "http://www.w3.org/1999/xhtml") return;
    const tag = from.localName;
    if (removed.has(tag)) return;
    const to = tags.has(tag) ? clean.createElement(tag) : into;
    if (to !== into) {
      for (const attr of attributes) {
        const value = from.getAttribute(attr);
        if (value !== null) to.setAttribute(attr, value);
      }
      if (tag === "a") {
        const href = from.getAttribute("href")?.trim() ?? "";
        if (/^(https?:\/\/|mailto:|tel:|sms:)/i.test(href)) to.setAttribute("href", href);
      }
      if (tag === "img") {
        const source = from.getAttribute("src")?.trim() ?? "";
        const cid = source.toLowerCase().startsWith("cid:")
          ? source.slice(4).replace(/^<|>$/g, "").toLowerCase()
          : null;
        const src = cid ? inlineImages[cid] : source;
        if (
          src &&
          /^(https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon);base64,)/i.test(src)
        ) {
          to.setAttribute("src", src);
          to.setAttribute("referrerpolicy", "no-referrer");
        }
      }
      if (from instanceof HTMLElement) {
        for (const name of Array.from(from.style)) {
          if (!layoutStyles.has(name) && !(light && lightStyles.has(name))) continue;
          const value = from.style.getPropertyValue(name);
          if (/^[a-z0-9#,.% ()+\- /]+$/i.test(value) && !/\b(?:url|attr|var)\s*\(/i.test(value)) {
            to.style.setProperty(name, value);
          }
        }
      }
      into.append(to);
    }
    for (const child of Array.from(from.childNodes)) copy(child, to);
  }
  for (const child of Array.from(parsed.body.childNodes)) copy(child, clean.body);
  return clean.body.innerHTML;
}

export default function HTMLBody({
  html,
  colors,
  light,
  inlineImages,
  onLink,
  onSelection,
}: {
  html: string;
  colors: { foreground: string; link: string; border: string };
  light: boolean;
  inlineImages: Record<string, string>;
  onLink: (href: string) => Promise<void>;
  onSelection?: (text: string) => Promise<void>;
  dom?: DOMProps;
}) {
  const body = useRef<HTMLDivElement>(null);
  const safe = useMemo(() => safeHtml(html, light, inlineImages), [html, inlineImages, light]);

  useEffect(() => {
    if (!onSelection) return;
    let timeout: ReturnType<typeof setTimeout>;
    const readSelection = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const selection = globalThis.getSelection();
        const text = body.current?.contains(selection?.anchorNode ?? null)
          ? (selection?.toString() ?? "")
          : "";
        void onSelection(text.slice(0, 4000));
      }, 100);
    };
    globalThis.document.addEventListener("selectionchange", readSelection);
    return () => {
      clearTimeout(timeout);
      globalThis.document.removeEventListener("selectionchange", readSelection);
    };
  }, [onSelection]);

  return (
    <>
      <style>{`
        html, body { margin: 0; padding: 0; color-scheme: ${light ? "light" : "dark"}; }
        .mail { font: -apple-system-body; color: ${colors.foreground}; overflow-wrap: anywhere; overflow: hidden; }
        .mail a { color: ${colors.link}; }
        .mail * { box-sizing: border-box; max-width: 100% !important; }
        .mail img { height: auto; }
        .mail pre { white-space: pre-wrap; }
        .mail blockquote { margin: 0 0 0 4px; padding-left: 12px; border-left: 2px solid ${colors.border}; }
      `}</style>
      <div
        ref={body}
        className="mail"
        dir="auto"
        onClick={(event) => {
          const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
          if (!link) return;
          event.preventDefault();
          void onLink(link.getAttribute("href") ?? "");
        }}
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    </>
  );
}
