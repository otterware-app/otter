import { memo, useMemo, useState } from "react";
import { useWindowDimensions } from "react-native";
import { EnrichedMarkdownText, type MarkdownStyle } from "react-native-enriched-markdown";

import { alpha, useTheme, type Theme } from "../theme.ts";

const SIZE = 16;
/** Inter's no-break space, in ems: what a reserve is counted in. */
const SPACE = 0.28125;

const styles = new WeakMap<
  Theme,
  { plain: MarkdownStyle; muted: MarkdownStyle; preview: MarkdownStyle }
>();
const parserFlags = { highlight: true, strikethrough: true, latexMath: false };
const selectionMenu = { copyAsMarkdown: { enabled: false } };

function markdownStyle(theme: Theme, variant: "plain" | "muted" | "preview"): MarkdownStyle {
  let cached = styles.get(theme);
  if (!cached) {
    cached = {
      plain: build(theme, false),
      muted: build(theme, true),
      preview: build(theme, false, 14),
    };
    styles.set(theme, cached);
  }
  return cached[variant];
}

/** MarkdownView.swift's look: Inter 16 at 1.42, headings 21 to 15, code on the card, links in the accent. */
function build(theme: Theme, muted: boolean, fontSize = SIZE): MarkdownStyle {
  const { colors, fonts } = theme;
  const color = muted ? colors.mutedForeground : colors.foreground;
  const text = { fontFamily: fonts.sans, fontSize, lineHeight: Math.round(fontSize * 1.42), color };
  const heading = (fontSize: number) => ({
    fontFamily: fonts.sans,
    fontSize,
    lineHeight: Math.round(fontSize * 1.42),
    fontWeight: "600",
    color,
    marginTop: 6,
    marginBottom: 8,
  });
  return {
    paragraph: { ...text, marginBottom: 12 },
    h1: heading(21),
    h2: heading(19),
    h3: heading(17),
    h4: heading(15),
    h5: heading(15),
    h6: heading(15),
    list: {
      ...text,
      marginBottom: 12,
      itemSpacing: 5,
      bulletColor: color,
      bulletSize: 6,
      markerColor: color,
      gapWidth: 12,
      marginLeft: 20,
    },
    blockquote: {
      ...text,
      color: colors.mutedForeground,
      borderColor: alpha(colors.mutedForeground, 0.5),
      borderWidth: 2,
      gapWidth: 12,
      backgroundColor: alpha(colors.canvas, 0),
      marginBottom: 12,
    },
    // React Native's font lookup knows no "ui-monospace": Menlo is the system's monospaced face it can name.
    codeBlock: {
      fontFamily: "Menlo",
      fontSize: 13,
      lineHeight: 19,
      color: colors.foreground,
      backgroundColor: colors.card,
      borderColor: alpha(colors.border, 0.7),
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      marginBottom: 12,
    },
    // No family: the system's monospaced font (SF Mono), as MarkdownView.swift's inline code.
    code: {
      fontSize: 14.4,
      color: colors.mutedForeground,
      backgroundColor: alpha(colors.foreground, 0),
      borderColor: alpha(colors.foreground, 0),
    },
    link: { color: colors.primary, underline: false },
    strong: { fontWeight: "bold" },
    // Inter is bundled upright only: italic takes the system font's.
    em: { fontFamily: "System" },
    table: {
      fontFamily: fonts.sans,
      fontSize: 14,
      lineHeight: 20,
      color: colors.foreground,
      headerFontFamily: fonts.sans,
      headerBackgroundColor: colors.card,
      headerTextColor: colors.foreground,
      rowEvenBackgroundColor: alpha(colors.card, 0),
      rowOddBackgroundColor: alpha(colors.card, 0),
      borderColor: alpha(colors.border, 0.7),
      borderWidth: 1,
      borderRadius: theme.radius.lg,
      cellPaddingHorizontal: 12,
      cellPaddingVertical: 8,
      marginBottom: 12,
    },
    taskList: {
      checkedColor: colors.primary,
      borderColor: colors.mutedForeground,
      checkmarkColor: colors.primaryForeground,
      checkedTextColor: colors.mutedForeground,
      checkedStrikethrough: false,
    },
    thematicBreak: { color: alpha(colors.border, 0.7), height: 1, marginTop: 4, marginBottom: 16 },
    image: { borderRadius: 14, maxHeight: 320, marginBottom: 12 },
    highlight: { color, backgroundColor: alpha(colors.warning, 0.35) },
  };
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Marks `find` as `==highlight==`, case-insensitively, outside code and link targets. */
function marked(markdown: string, find: string): string {
  const needle = find.trim();
  if (!needle) return markdown;
  const pattern = new RegExp(escaped(needle), "giu");
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      return line
        .split(/(`[^`]*`|\]\([^)]*\))/)
        .map((part, i) => (i % 2 === 1 ? part : part.replace(pattern, (match) => `==${match}==`)))
        .join("");
    })
    .join("\n");
}

/** Blocks that draw apart from the text (MarkdownView.swift's segments): code that scrolls sideways, tables, tasks. */
const hasBlocks = (markdown: string) => /^\s*(```|~~~|\||[-*+] \[[ xX]\])/m.test(markdown);

export type MarkdownProps = {
  markdown: string;
  /** In the muted color, as a quote or what an agent said between its steps. */
  muted?: boolean;
  selectable?: boolean;
  /** Clamps a compact preview to this many lines. The native view clamps CommonMark only. */
  numberOfLines?: number;
  /** What a link (or an image) does. */
  onLink?: (url: string) => void;
  /** Offers Reply beside Copy on a selection, with what's selected. */
  onReply?: (text: string) => void;
  /** Marked wherever it occurs, as Find shows it. */
  find?: string;
  /** Points kept clear at the end of the last line, for a time drawn over it (WhatsApp's way): on that line when there's room, else on its own. */
  reserve?: number;
};

/**
 * Markdown drawn natively (react-native-enriched-markdown, TextKit) as the phone's chat draws it:
 * selectable, with Reply beside Copy where there's `onReply`.
 */
export const Markdown = memo(function Markdown({
  markdown,
  muted = false,
  selectable = true,
  numberOfLines,
  onLink,
  onReply,
  find = "",
  reserve,
}: MarkdownProps) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  // The library keeps a selection after an action of ours: drawing it again lets go of it.
  const [drawn, setDrawn] = useState(0);
  const preview = numberOfLines !== undefined;
  const blocks = !preview && hasBlocks(markdown);
  const room = reserve ? ` ${" ".repeat(Math.ceil(reserve / (SIZE * SPACE * fontScale)))}` : "";
  const contextMenuItems = useMemo(
    () =>
      onReply
        ? [
            {
              text: "Reply",
              icon: "arrowshape.turn.up.left",
              onPress: ({ text }: { text: string }) => {
                onReply(text);
                setDrawn((n) => n + 1);
              },
            },
          ]
        : undefined,
    [onReply],
  );
  return (
    <EnrichedMarkdownText
      key={drawn}
      markdown={marked(markdown, find) + room}
      flavor={blocks ? "github" : "commonmark"}
      markdownStyle={markdownStyle(theme, preview ? "preview" : muted ? "muted" : "plain")}
      selectable={selectable}
      numberOfLines={numberOfLines}
      md4cFlags={parserFlags}
      selectionColor={theme.colors.primary}
      enableTaskListItemToggle={false}
      enableCodeBlockWrapToggle={false}
      selectionMenuConfig={selectionMenu}
      contextMenuItems={contextMenuItems}
      onLinkPress={onLink && (({ url }) => onLink(url))}
      onImagePress={onLink && (({ url }) => onLink(url))}
    />
  );
});
