import { Editor } from "@tiptap/core";

import {
  emailHtml,
  isBlank,
  mailExtensions,
  normalizeHtml,
  textOfHtml,
  withoutPastedStyles,
} from "../../web/src/main/mail/rich-text-schema";

/**
 * The composer's editor on the phone: the web's TipTap schema (rich-text-
 * schema.ts) in the native screen's WKWebView. It tells the app what's
 * written (`composer` message handler) and takes commands from it
 * (`window.otterComposer`).
 */

type Message =
  | { type: "ready" }
  | { type: "change"; html: string; text: string; blank: boolean }
  | { type: "focus"; focused: boolean };

declare global {
  interface Window {
    webkit?: { messageHandlers: { composer: { postMessage(message: Message): void } } };
    otterComposer: unknown;
  }
}

const post = (message: Message) => window.webkit?.messageHandlers.composer.postMessage(message);

const editor = new Editor({
  element: document.querySelector("#editor")!,
  extensions: mailExtensions(),
  content: "",
  editorProps: {
    transformPastedHTML: withoutPastedStyles,
    attributes: { role: "textbox", "aria-multiline": "true", "aria-label": "Message" },
  },
});

const change = () => {
  const html = emailHtml(editor.getHTML());
  return { html, text: textOfHtml(html), blank: isBlank(editor.state) };
};

let timer: ReturnType<typeof setTimeout> | null = null;
editor.on("update", () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => post({ type: "change", ...change() }), 150);
});
editor.on("focus", () => post({ type: "focus", focused: true }));
editor.on("blur", () => post({ type: "focus", focused: false }));

window.otterComposer = {
  /** What's written now, the debounce's pending change included (Send, Save Draft). */
  snapshot() {
    const now = change();
    if (timer) {
      clearTimeout(timer);
      timer = null;
      // Published too, so the app's copy is current even if what asked for it fails.
      post({ type: "change", ...now });
    }
    return now;
  },
  setContent(html: string) {
    editor.commands.setContent(normalizeHtml(html), { emitUpdate: false });
  },
  /** The From's signature (the web's signature node, at the end): replaced, added, or taken out. */
  setSignature(html: string | null) {
    let found: { pos: number; size: number } | null = null;
    editor.state.doc.forEach((node, pos) => {
      if (node.type.name === "signature") found = { pos, size: node.nodeSize };
    });
    const block = found as { pos: number; size: number } | null;
    const quietly = () => editor.chain().setMeta("addToHistory", false);
    if (block && html) {
      quietly()
        .command(({ tr }) => {
          tr.setNodeAttribute(block.pos, "html", normalizeHtml(html));
          return true;
        })
        .run();
    } else if (block) {
      quietly()
        .deleteRange({ from: block.pos, to: block.pos + block.size })
        .run();
    } else if (html) {
      quietly()
        .insertContentAt(editor.state.doc.content.size, [
          { type: "paragraph" },
          { type: "signature", attrs: { html: normalizeHtml(html) } },
        ])
        .setTextSelection(1)
        .run();
    }
    post({ type: "change", ...change() });
  },
  focus(position: "start" | "end" = "start") {
    editor.commands.focus(position);
  },
  setPlaceholder(text: string) {
    document.querySelector("#editor")?.setAttribute("data-placeholder", text);
  },
  command(name: string) {
    const chain = editor.chain().focus();
    if (name === "bold") chain.toggleBold().run();
    else if (name === "italic") chain.toggleItalic().run();
    else if (name === "bulletList") chain.toggleBulletList().run();
    else if (name === "orderedList") chain.toggleOrderedList().run();
    else if (name === "blockquote") chain.toggleBlockquote().run();
  },
};

post({ type: "ready" });
