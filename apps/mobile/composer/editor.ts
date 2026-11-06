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

let timer: ReturnType<typeof setTimeout> | null = null;
editor.on("update", () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const html = emailHtml(editor.getHTML());
    post({ type: "change", html, text: textOfHtml(html), blank: isBlank(editor.state) });
  }, 150);
});
editor.on("focus", () => post({ type: "focus", focused: true }));
editor.on("blur", () => post({ type: "focus", focused: false }));

window.otterComposer = {
  setContent(html: string) {
    editor.commands.setContent(normalizeHtml(html), { emitUpdate: false });
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
