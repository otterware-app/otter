import { useLatest } from "../use-latest";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikethroughIcon,
  Link2Icon,
  ListIcon,
  ListOrderedIcon,
  TextQuoteIcon,
  RemoveFormattingIcon,
  ALargeSmallIcon,
  BaselineIcon,
} from "lucide-react";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "./ui";
import { shortcutText } from "../keybindings/keys";

const SIGNATURE_ATTR = "data-signature";

const signatureBlock = (html: string) => `<br><br><div ${SIGNATURE_ATTR}="">${html}</div>`;

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

// Gmail's sizes and a few of its colors, as <font> tags every mail client reads. Normal and
// Default take the size or color off. The colors read on light and dark backgrounds.
const TEXT_SIZES = [
  { label: "Small", size: "1", preview: "0.75rem" },
  { label: "Normal", size: null, preview: "0.875rem" },
  { label: "Large", size: "4", preview: "1.125rem" },
  { label: "Huge", size: "6", preview: "1.5rem" },
] as const;

const TEXT_COLORS = [
  { label: "Gray", color: "#666666" },
  { label: "Red", color: "#cc0000" },
  { label: "Orange", color: "#e69138" },
  { label: "Green", color: "#6aa84f" },
  { label: "Blue", color: "#3d85c6" },
  { label: "Purple", color: "#8e7cc3" },
] as const;

/**
 * execCommand can set a size or color but not take one off: apply a stand-in, then strip it
 * from the <font> tags it made (and unwrap those left bare).
 */
function clearFontAttribute(
  editor: HTMLElement,
  attribute: "size" | "color",
  apply: (standIn: string) => void,
) {
  const standIn = attribute === "size" ? "7" : "#010203";
  const selector = `font[${attribute}="${standIn}"]`;
  const existing = new Set(editor.querySelectorAll(selector));
  apply(standIn);
  const unwrapped: ChildNode[] = [];
  for (const font of editor.querySelectorAll(selector)) {
    if (existing.has(font)) continue;
    font.removeAttribute(attribute);
    if (font.attributes.length > 0) continue;
    unwrapped.push(...font.childNodes);
    font.replaceWith(...font.childNodes);
  }
  // The selection was inside the tags just removed: keep the same text selected.
  const first = unwrapped[0];
  const last = unwrapped.at(-1);
  if (!first || !last) return;
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

type ToolbarState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
};

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
        "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg",
        active
          ? "bg-accent-surface text-foreground"
          : "text-muted-foreground hover:bg-accent-surface hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
});

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
    showToolbar?: boolean;
    initialHTML?: string;
    /**
     * The account's signature, kept in its own block below the text: set on
     * mount (caret placed above it) and swapped in place when it changes
     * (switching "From"), never touching what the user typed.
     */
    signatureHTML?: string;
    /** Text sizes and colors in the toolbar (signatures). */
    textStyles?: boolean;
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
    showToolbar = true,
    initialHTML,
    signatureHTML,
    textStyles,
  },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(true);
  const [toolbar, setToolbar] = useState<ToolbarState>({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const savedRange = useRef<Range | null>(null);
  const [styleMenu, setStyleMenu] = useState<"size" | "color" | null>(null);

  const readText = () => editorRef.current?.innerText ?? "";

  const emitChange = () => {
    const text = readText();
    setEmpty(text.trim().length === 0);
    onTextChange?.(text);
  };

  useImperativeHandle(ref, () => ({
    getHTML: () => editorRef.current?.innerHTML ?? "",
    getText: readText,
    setHTML: (html: string) => {
      if (editorRef.current) editorRef.current.innerHTML = html;
      emitChange();
    },
    clear: () => {
      if (editorRef.current) editorRef.current.innerHTML = "";
      emitChange();
    },
    focus: () => editorRef.current?.focus(),
  }));

  // The signature lives in its own marked block so a later change (switching
  // the From account) swaps just that block — never the user's text.
  const seededRef = useRef(false);
  const signatureRef = useRef<string | undefined>(undefined);
  const emitChangeForEffect = useLatest(emitChange);
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const signatureChanged = signatureHTML !== signatureRef.current;
    signatureRef.current = signatureHTML;
    const block = el.querySelector<HTMLElement>(`[${SIGNATURE_ATTR}]`);

    if (!seededRef.current && (initialHTML || signatureHTML)) {
      seededRef.current = true;
      // Content that arrives late must not clobber what the user already typed.
      if (!el.textContent?.trim()) el.innerHTML = initialHTML ?? "";
      if (signatureHTML && !block) {
        el.insertAdjacentHTML("beforeend", signatureBlock(signatureHTML));
        // Caret at the very start so typing lands above the signature.
        const range = document.createRange();
        range.setStart(el, 0);
        range.collapse(true);
        const selection = document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      emitChangeForEffect.current();
    } else if (seededRef.current && signatureChanged) {
      if (block && signatureHTML) block.innerHTML = signatureHTML;
      else if (block) block.remove();
      else if (signatureHTML) el.insertAdjacentHTML("beforeend", signatureBlock(signatureHTML));
      emitChangeForEffect.current();
    }
    if (autoFocus) el.focus();
  }, [autoFocus, initialHTML, signatureHTML, emitChangeForEffect]);

  const refreshToolbar = () => {
    const el = editorRef.current;
    if (!el || !el.contains(document.getSelection()?.anchorNode ?? null)) return;
    setToolbar({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      strike: document.queryCommandState("strikeThrough"),
    });
  };

  const refreshToolbarForEffect = useLatest(refreshToolbar);
  useEffect(() => {
    const refresh = () => refreshToolbarForEffect.current();
    document.addEventListener("selectionchange", refresh);
    return () => document.removeEventListener("selectionchange", refresh);
  }, [refreshToolbarForEffect]);

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    emitChange();
    // Toggling with a still caret fires no selectionchange — sync immediately
    // so the button reflects the new typing style.
    refreshToolbar();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const run = (fn: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    if (!e.shiftKey) {
      if (key === "b") return run(() => exec("bold"));
      if (key === "i") return run(() => exec("italic"));
      if (key === "u") return run(() => exec("underline"));
      if (key === "k") return run(openLinkInput);
      if (key === "\\") return run(() => exec("removeFormat"));
      return;
    }
    if (key === "x") return run(() => exec("strikeThrough"));
    if (e.code === "Digit7") return run(() => exec("insertOrderedList"));
    if (e.code === "Digit8") return run(() => exec("insertUnorderedList"));
    if (e.code === "Digit9") return run(() => exec("formatBlock", "blockquote"));
  };

  const saveRange = () => {
    const selection = document.getSelection();
    savedRange.current =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  };

  const restoreRange = () => {
    editorRef.current?.focus();
    const selection = document.getSelection();
    if (savedRange.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
  };

  const openLinkInput = () => {
    saveRange();
    setLinkUrl("");
    setLinkOpen(true);
  };

  const openStyleMenu = (menu: "size" | "color") => (open: boolean) => {
    if (open) saveRange();
    setStyleMenu(open ? menu : null);
  };

  const applyStyle = (attribute: "size" | "color", value: string | null) => {
    setStyleMenu(null);
    const editor = editorRef.current;
    if (!editor) return;
    restoreRange();
    document.execCommand("styleWithCSS", false, "false");
    const command = attribute === "size" ? "fontSize" : "foreColor";
    if (value) document.execCommand(command, false, value);
    else
      clearFontAttribute(editor, attribute, (standIn) =>
        document.execCommand(command, false, standIn),
      );
    emitChange();
  };

  const menuItem =
    "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-foreground hover:bg-accent-surface";

  const applyLink = () => {
    const raw = linkUrl.trim();
    setLinkOpen(false);
    if (!raw) return;
    const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    const editor = editorRef.current;
    if (!editor) return;
    restoreRange();
    const selection = document.getSelection();
    if (selection && !selection.isCollapsed) {
      document.execCommand("createLink", false, url);
    } else {
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${escapeHtml(url)}">${escapeHtml(raw)}</a>`,
      );
    }
    emitChange();
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div
        className={cn(
          "flex items-center gap-0.5 border-b border-border/40 px-4 py-1.5",
          !showToolbar && "hidden",
        )}
      >
        <ToolBtn
          label={`Bold (${shortcutText("mod+b")})`}
          active={toolbar.bold}
          onClick={() => exec("bold")}
        >
          <BoldIcon className="size-4" />
        </ToolBtn>
        <ToolBtn
          label={`Italic (${shortcutText("mod+i")})`}
          active={toolbar.italic}
          onClick={() => exec("italic")}
        >
          <ItalicIcon className="size-4" />
        </ToolBtn>
        <ToolBtn
          label={`Underline (${shortcutText("mod+u")})`}
          active={toolbar.underline}
          onClick={() => exec("underline")}
        >
          <UnderlineIcon className="size-4" />
        </ToolBtn>
        <ToolBtn
          label={`Strikethrough (${shortcutText("mod+shift+x")})`}
          active={toolbar.strike}
          onClick={() => exec("strikeThrough")}
        >
          <StrikethroughIcon className="size-4" />
        </ToolBtn>
        {textStyles ? (
          <>
            <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
            <Popover open={styleMenu === "size"} onOpenChange={openStyleMenu("size")}>
              <PopoverTrigger
                render={
                  <ToolBtn label="Text size" active={styleMenu === "size"}>
                    <ALargeSmallIcon className="size-4" />
                  </ToolBtn>
                }
              />
              <PopoverPopup align="start" padding="compact" finalFocus={editorRef}>
                <div className="flex w-32 flex-col">
                  {TEXT_SIZES.map(({ label, size, preview }) => (
                    <button
                      key={label}
                      type="button"
                      className={menuItem}
                      style={{ fontSize: preview }}
                      onClick={() => applyStyle("size", size)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </PopoverPopup>
            </Popover>
            <Popover open={styleMenu === "color"} onOpenChange={openStyleMenu("color")}>
              <PopoverTrigger
                render={
                  <ToolBtn label="Text color" active={styleMenu === "color"}>
                    <BaselineIcon className="size-4" />
                  </ToolBtn>
                }
              />
              <PopoverPopup align="start" padding="compact" finalFocus={editorRef}>
                <div className="flex w-36 flex-col text-sm">
                  <button
                    type="button"
                    className={menuItem}
                    onClick={() => applyStyle("color", null)}
                  >
                    <span className="size-3.5 rounded-full border border-border bg-foreground" />
                    Default
                  </button>
                  {TEXT_COLORS.map(({ label, color }) => (
                    <button
                      key={label}
                      type="button"
                      className={menuItem}
                      onClick={() => applyStyle("color", color)}
                    >
                      <span className="size-3.5 rounded-full" style={{ backgroundColor: color }} />
                      {label}
                    </button>
                  ))}
                </div>
              </PopoverPopup>
            </Popover>
          </>
        ) : null}
        <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
        <ToolBtn label={`Link (${shortcutText("mod+k")})`} onClick={openLinkInput}>
          <Link2Icon className="size-4" />
        </ToolBtn>
        <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
        <ToolBtn
          label={`Bulleted list (${shortcutText("mod+shift+8")})`}
          onClick={() => exec("insertUnorderedList")}
        >
          <ListIcon className="size-4" />
        </ToolBtn>
        <ToolBtn
          label={`Numbered list (${shortcutText("mod+shift+7")})`}
          onClick={() => exec("insertOrderedList")}
        >
          <ListOrderedIcon className="size-4" />
        </ToolBtn>
        <ToolBtn
          label={`Quote (${shortcutText("mod+shift+9")})`}
          onClick={() => exec("formatBlock", "blockquote")}
        >
          <TextQuoteIcon className="size-4" />
        </ToolBtn>
        <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
        <ToolBtn
          label={`Clear formatting (${shortcutText("mod+\\")})`}
          onClick={() => exec("removeFormat")}
        >
          <RemoveFormattingIcon className="size-4" />
        </ToolBtn>
      </div>

      {linkOpen ? (
        <div className="flex items-center gap-2 border-b border-border/40 px-5 py-1.5">
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
                setLinkOpen(false);
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
            Apply
          </button>
        </div>
      ) : null}

      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-rt=""
        data-empty={empty ? "true" : "false"}
        data-placeholder={placeholder}
        onInput={emitChange}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        className={[
          "te-scroll w-full flex-1 overflow-y-auto bg-transparent px-5 py-3.5",
          "text-sm leading-relaxed text-foreground outline-none",
          minHeightClass ?? "min-h-[38px]",
          maxHeightClass ?? "max-h-[55vh]",
        ].join(" ")}
      />
    </div>
  );
});
