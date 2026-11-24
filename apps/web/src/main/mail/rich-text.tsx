import { useLatest } from "../use-latest";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  Link2Icon,
  ListIcon,
  ListOrderedIcon,
  TextQuoteIcon,
  RemoveFormattingIcon,
  ALargeSmallIcon,
  BaselineIcon,
  Undo2Icon,
  Redo2Icon,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
} from "lucide-react";
import {
  clearFormatting,
  emailHtml,
  isBlank,
  mailExtensions,
  normalizeHtml,
  textOfHtml,
  withoutPastedStyles,
} from "./rich-text-schema";
import { Popover, PopoverPopup, PopoverTrigger } from "@otter/ui/components/popover";
import { shortcutText } from "../keybindings/keys";
import { cn } from "@otter/ui/lib/utils";

export type RichTextRef = {
  getHTML: () => string;
  getText: () => string;
  setHTML: (html: string) => void;
  clear: () => void;
  focus: () => void;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function textToHtml(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

const TEXT_SIZES = [
  { label: "Small", size: "x-small", preview: "0.75rem" },
  { label: "Normal", size: null, preview: "0.875rem" },
  { label: "Large", size: "large", preview: "1.125rem" },
  { label: "Huge", size: "xx-large", preview: "1.5rem" },
] as const;

const TEXT_COLORS = [
  { label: "Gray", color: "#666666" },
  { label: "Red", color: "#cc0000" },
  { label: "Orange", color: "#e69138" },
  { label: "Green", color: "#6aa84f" },
  { label: "Blue", color: "#3d85c6" },
  { label: "Purple", color: "#8e7cc3" },
] as const;

const ToolBtn = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button"> & { label: string; active?: boolean }
>(function ToolBtn({ label, active, className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      {...props}
      className={cn(
        "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent",
        active
          ? "bg-background text-foreground shadow-xs"
          : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
});

const Divider = () => <span className="mx-1 h-3.5 w-px shrink-0 bg-border" aria-hidden />;

function signatureContent(html: string) {
  return [{ type: "paragraph" }, { type: "signature", attrs: { html: normalizeHtml(html) } }];
}

function findSignature(editor: Editor): { pos: number; size: number } | null {
  let found: { pos: number; size: number } | null = null;
  editor.state.doc.forEach((node, pos) => {
    if (node.type.name === "signature") found = { pos, size: node.nodeSize };
  });
  return found;
}

export const RichTextArea = forwardRef<
  RichTextRef,
  {
    placeholder: string;
    ariaLabel: string;
    onTextChange?: (plainText: string) => void;
    onBlur?: () => void;
    autoFocus?: boolean;
    minHeightClass?: string;
    maxHeightClass?: string;
    initialHTML?: string;
    /**
     * The account's signature, kept in its own block below the text: set on
     * mount (caret placed above it) and swapped in place when it changes
     * (switching "From"), never touching what the user typed.
     */
    signatureHTML?: string;
  }
>(function RichTextArea(
  {
    placeholder,
    ariaLabel,
    onTextChange,
    onBlur,
    autoFocus,
    minHeightClass,
    maxHeightClass,
    initialHTML,
    signatureHTML,
  },
  ref,
) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [styleMenu, setStyleMenu] = useState<"size" | "color" | null>(null);
  const editorDomRef = useRef<HTMLElement | null>(null);
  const onTextChangeRef = useLatest(onTextChange);
  const onBlurRef = useLatest(onBlur);

  const editor = useEditor({
    extensions: mailExtensions(),
    editorProps: {
      attributes: (state) => ({
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel,
        "data-rt": "",
        "data-empty": isBlank(state) ? "true" : "false",
        "data-placeholder": placeholder,
        class: [
          "te-scroll w-full flex-1 overflow-y-auto bg-transparent px-5 py-3.5",
          "font-reading text-sm leading-relaxed text-foreground outline-none",
          minHeightClass ?? "min-h-[38px]",
          maxHeightClass ?? "max-h-[55vh]",
        ].join(" "),
      }),
      transformPastedHTML: withoutPastedStyles,
    },
    onUpdate: ({ editor }) => onTextChangeRef.current?.(readText(editor)),
    onBlur: () => onBlurRef.current?.(),
  });

  const readText = (e: Editor) => textOfHtml(e.getHTML());
  const emitChange = () => onTextChangeRef.current?.(readText(editor));

  const replaceContent = (html: string) => {
    editor
      .chain()
      .setMeta("addToHistory", false)
      .setContent(normalizeHtml(html), { emitUpdate: false })
      .run();
    emitChange();
  };

  useImperativeHandle(ref, () => ({
    getHTML: () => emailHtml(editor.getHTML()),
    getText: () => readText(editor),
    setHTML: replaceContent,
    clear: () => replaceContent(""),
    focus: () => editor.commands.focus(),
  }));

  useEffect(() => {
    editorDomRef.current = editor.view.dom;
  }, [editor]);

  const seededRef = useRef(false);
  const signatureRef = useRef<string | undefined>(undefined);
  const emitChangeForEffect = useLatest(emitChange);
  useEffect(() => {
    const signatureChanged = signatureHTML !== signatureRef.current;
    signatureRef.current = signatureHTML;
    const block = findSignature(editor);
    const quietly = () => editor.chain().setMeta("addToHistory", false);

    if (!seededRef.current && (initialHTML || signatureHTML)) {
      seededRef.current = true;
      // Content that arrives late must not clobber what the user already typed.
      if (!editor.getText().trim()) {
        quietly()
          .setContent(normalizeHtml(initialHTML ?? ""), { emitUpdate: false })
          .run();
      }
      if (signatureHTML && !findSignature(editor)) {
        quietly()
          .insertContentAt(editor.state.doc.content.size, signatureContent(signatureHTML))
          .setTextSelection(1)
          .run();
      }
      emitChangeForEffect.current();
      if (autoFocus) editor.commands.focus();
    } else if (seededRef.current && signatureChanged) {
      if (block && signatureHTML) {
        quietly()
          .command(({ tr }) => {
            tr.setNodeAttribute(block.pos, "html", normalizeHtml(signatureHTML));
            return true;
          })
          .run();
      } else if (block) {
        quietly()
          .deleteRange({ from: block.pos, to: block.pos + block.size })
          .run();
      } else if (signatureHTML) {
        quietly()
          .insertContentAt(editor.state.doc.content.size, signatureContent(signatureHTML))
          .run();
      }
      emitChangeForEffect.current();
    } else if (!seededRef.current && autoFocus) {
      editor.commands.focus();
    }
  }, [editor, autoFocus, initialHTML, signatureHTML, emitChangeForEffect]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      link: e.isActive("link"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      blockquote: e.isActive("blockquote"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      canIndent: e.can().sinkListItem("listItem"),
      canOutdent: e.can().liftListItem("listItem"),
    }),
  });

  const run = (command: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) =>
    command(editor.chain().focus()).run();

  const openLinkInput = () => {
    setLinkUrl((editor.getAttributes("link").href as string | undefined) ?? "");
    setLinkOpen(true);
  };

  const closeLinkInput = () => {
    setLinkOpen(false);
    editor.commands.focus();
  };

  const applyLink = () => {
    const raw = linkUrl.trim();
    setLinkOpen(false);
    if (!raw) {
      run((c) => c.extendMarkRange("link").unsetLink());
      return;
    }
    const href = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    if (editor.state.selection.empty && !editor.isActive("link")) {
      run((c) =>
        c.insertContent({ type: "text", text: raw, marks: [{ type: "link", attrs: { href } }] }),
      );
    } else {
      run((c) => c.extendMarkRange("link").setLink({ href }));
    }
  };

  const openStyleMenu = (menu: "size" | "color") => (open: boolean) =>
    setStyleMenu(open ? menu : null);

  const applySize = (size: string | null) => {
    setStyleMenu(null);
    run((c) => (size ? c.setFontSize(size) : c.unsetFontSize()));
  };

  const applyColor = (color: string | null) => {
    setStyleMenu(null);
    run((c) => (color ? c.setColor(color) : c.unsetColor()));
  };

  const menuItem =
    "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-foreground hover:bg-accent-surface";

  return (
    <div
      className="flex min-w-0 flex-1 flex-col"
      onKeyDown={(e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k" && editor.isFocused) {
          e.preventDefault();
          openLinkInput();
        }
      }}
    >
      <EditorContent editor={editor} className="flex min-h-0 flex-1 flex-col" />
      {linkOpen ? (
        <div
          data-keybinding-capture=""
          className="mx-3 mb-1 flex items-center gap-2 rounded-xl bg-accent-surface/50 px-3 py-1"
        >
          <span className="shrink-0 text-sm text-muted-foreground">Link</span>
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                applyLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeLinkInput();
              }
            }}
            placeholder="https://example.com"
            aria-label="Link URL"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-placeholder"
          />
          <button
            type="button"
            onClick={applyLink}
            className="shrink-0 cursor-pointer text-sm font-medium text-primary hover:brightness-110"
          >
            {linkUrl.trim() || !state.link ? "Apply" : "Remove"}
          </button>
        </div>
      ) : null}

      <div className="mx-3 mb-1 flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-px overflow-x-auto rounded-xl bg-accent-surface/50 p-0.5">
        <ToolBtn
          label={`Undo (${shortcutText("mod+z")})`}
          disabled={!state.canUndo}
          onClick={() => run((c) => c.undo())}
        >
          <Undo2Icon className="size-[15px]" />
        </ToolBtn>
        <ToolBtn
          label={`Redo (${shortcutText("mod+shift+z")})`}
          disabled={!state.canRedo}
          onClick={() => run((c) => c.redo())}
        >
          <Redo2Icon className="size-[15px]" />
        </ToolBtn>
        <Divider />
        <Popover open={styleMenu === "size"} onOpenChange={openStyleMenu("size")}>
          <PopoverTrigger
            render={
              <ToolBtn label="Text size" active={styleMenu === "size"}>
                <ALargeSmallIcon className="size-[15px]" />
              </ToolBtn>
            }
          />
          <PopoverPopup align="start" padding="compact" finalFocus={editorDomRef}>
            <div className="flex w-32 flex-col">
              {TEXT_SIZES.map(({ label, size, preview }) => (
                <button
                  key={label}
                  type="button"
                  className={menuItem}
                  style={{ fontSize: preview }}
                  onClick={() => applySize(size)}
                >
                  {label}
                </button>
              ))}
            </div>
          </PopoverPopup>
        </Popover>
        <Divider />
        <ToolBtn
          label={`Bold (${shortcutText("mod+b")})`}
          active={state.bold}
          onClick={() => run((c) => c.toggleBold())}
        >
          <BoldIcon className="size-[15px]" />
        </ToolBtn>
        <ToolBtn
          label={`Italic (${shortcutText("mod+i")})`}
          active={state.italic}
          onClick={() => run((c) => c.toggleItalic())}
        >
          <ItalicIcon className="size-[15px]" />
        </ToolBtn>
        <ToolBtn
          label={`Underline (${shortcutText("mod+u")})`}
          active={state.underline}
          onClick={() => run((c) => c.toggleUnderline())}
        >
          <UnderlineIcon className="size-[15px]" />
        </ToolBtn>
        <Popover open={styleMenu === "color"} onOpenChange={openStyleMenu("color")}>
          <PopoverTrigger
            render={
              <ToolBtn label="Text color" active={styleMenu === "color"}>
                <BaselineIcon className="size-[15px]" />
              </ToolBtn>
            }
          />
          <PopoverPopup align="start" padding="compact" finalFocus={editorDomRef}>
            <div className="flex w-36 flex-col text-sm">
              <button type="button" className={menuItem} onClick={() => applyColor(null)}>
                <span className="size-3.5 rounded-full border border-border bg-foreground" />
                Default
              </button>
              {TEXT_COLORS.map(({ label, color }) => (
                <button
                  key={label}
                  type="button"
                  className={menuItem}
                  onClick={() => applyColor(color)}
                >
                  <span className="size-3.5 rounded-full" style={{ backgroundColor: color }} />
                  {label}
                </button>
              ))}
            </div>
          </PopoverPopup>
        </Popover>
        <ToolBtn
          label={`Link (${shortcutText("mod+k")})`}
          active={state.link || linkOpen}
          onClick={openLinkInput}
        >
          <Link2Icon className="size-[15px]" />
        </ToolBtn>
        <Divider />
        <ToolBtn
          label={`Numbered list (${shortcutText("mod+shift+7")})`}
          active={state.orderedList}
          onClick={() => run((c) => c.toggleOrderedList())}
        >
          <ListOrderedIcon className="size-[15px]" />
        </ToolBtn>
        <ToolBtn
          label={`Bulleted list (${shortcutText("mod+shift+8")})`}
          active={state.bulletList}
          onClick={() => run((c) => c.toggleBulletList())}
        >
          <ListIcon className="size-[15px]" />
        </ToolBtn>
        <ToolBtn
          label={`Indent less (${shortcutText("shift+tab")})`}
          disabled={!state.canOutdent}
          onClick={() => run((c) => c.liftListItem("listItem"))}
        >
          <IndentDecreaseIcon className="size-[15px]" />
        </ToolBtn>
        <ToolBtn
          label={`Indent more (${shortcutText("tab")})`}
          disabled={!state.canIndent}
          onClick={() => run((c) => c.sinkListItem("listItem"))}
        >
          <IndentIncreaseIcon className="size-[15px]" />
        </ToolBtn>
        <ToolBtn
          label={`Quote (${shortcutText("mod+shift+9")})`}
          active={state.blockquote}
          onClick={() => run((c) => c.toggleBlockquote())}
        >
          <TextQuoteIcon className="size-[15px]" />
        </ToolBtn>
        <Divider />
        <ToolBtn
          label={`Clear formatting (${shortcutText("mod+\\")})`}
          onClick={() => clearFormatting(editor)}
        >
          <RemoveFormattingIcon className="size-[15px]" />
        </ToolBtn>
      </div>
    </div>
  );
});
