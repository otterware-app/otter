import { useMemo } from "react";
import { Linking, ScrollView, StyleSheet, Text, View, type TextStyle } from "react-native";

import type { Palette } from "../theme";
import { parseMarkdown, type Align, type Block, type Span } from "./parse-markdown";

const HEADING_SIZES = [22, 19, 17, 16, 16, 16];

/** An answer's markdown, as apps/ios and the web show it. */
export function Markdown({ text, colors }: { text: string; colors: Palette }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <View style={styles.blocks}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} colors={colors} />
      ))}
    </View>
  );
}

function BlockView({ block, colors }: { block: Block; colors: Palette }) {
  switch (block.type) {
    case "paragraph":
      return <Spans spans={block.spans} colors={colors} style={styles.text} />;
    case "heading":
      return (
        <Spans
          spans={block.spans}
          colors={colors}
          style={[
            styles.text,
            styles.heading,
            {
              fontSize: HEADING_SIZES[block.level - 1],
              lineHeight: HEADING_SIZES[block.level - 1]! + 7,
            },
          ]}
        />
      );
    case "code":
      return (
        <ScrollView
          horizontal
          style={[styles.codeBlock, { backgroundColor: colors.card }]}
          contentContainerStyle={styles.codeContent}
          showsHorizontalScrollIndicator={false}
        >
          <Text style={[styles.code, { color: colors.text }]} selectable>
            {block.text}
          </Text>
        </ScrollView>
      );
    case "list":
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.item}>
              <Text style={[styles.text, styles.marker, { color: colors.secondary }]}>
                {block.ordered ? `${block.start + i}.` : "•"}
              </Text>
              <View style={styles.itemBody}>
                {item.map((child, j) => (
                  <BlockView key={j} block={child} colors={colors} />
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    case "quote":
      return (
        <View style={[styles.quote, { borderColor: colors.border }]}>
          {block.blocks.map((child, i) => (
            <BlockView key={i} block={child} colors={colors} />
          ))}
        </View>
      );
    case "table":
      return <Table block={block} colors={colors} />;
    case "rule":
      return <View style={[styles.rule, { backgroundColor: colors.border }]} />;
  }
}

function Table({ block, colors }: { block: Extract<Block, { type: "table" }>; colors: Palette }) {
  const cell = (spans: Span[], align: Align, key: number, header = false) => (
    <View key={key} style={[styles.cell, { borderColor: colors.border }]}>
      <Spans
        spans={spans}
        colors={colors}
        style={[styles.cellText, header && styles.bold, { textAlign: align ?? "left" }]}
      />
    </View>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={[styles.table, { borderColor: colors.border }]}>
        <View style={[styles.row, { backgroundColor: colors.card }]}>
          {block.header.map((spans, c) => cell(spans, block.align[c] ?? null, c, true))}
        </View>
        {block.rows.map((row, r) => (
          <View key={r} style={styles.row}>
            {row.map((spans, c) => cell(spans, block.align[c] ?? null, c))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Spans({
  spans,
  colors,
  style,
}: {
  spans: Span[];
  colors: Palette;
  style: TextStyle | (TextStyle | false)[];
}) {
  return (
    <Text style={[{ color: colors.text }, style]} selectable>
      {spans.map((span, i) => (
        <Text
          key={i}
          style={[
            span.bold && styles.bold,
            span.italic && styles.italic,
            span.strike && styles.strike,
            span.code && [styles.inlineCode, { backgroundColor: colors.card }],
            span.href ? { color: colors.focus } : null,
          ]}
          onPress={span.href ? () => void Linking.openURL(span.href!) : undefined}
          accessibilityRole={span.href ? "link" : undefined}
        >
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: 10 },
  text: { fontSize: 16, lineHeight: 23 },
  heading: { fontWeight: "700", marginTop: 4 },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through" },
  inlineCode: { fontFamily: "Menlo", fontSize: 14 },
  codeBlock: { borderRadius: 10, flexGrow: 0 },
  codeContent: { padding: 12 },
  code: { fontFamily: "Menlo", fontSize: 13, lineHeight: 19 },
  list: { gap: 6 },
  item: { flexDirection: "row", gap: 6 },
  marker: { minWidth: 18, textAlign: "right", fontVariant: ["tabular-nums"] },
  itemBody: { flex: 1, gap: 6 },
  quote: { borderLeftWidth: 3, paddingLeft: 12, gap: 8 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, overflow: "hidden" },
  row: { flexDirection: "row" },
  cell: {
    width: 140,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cellText: { fontSize: 14, lineHeight: 19 },
});
