import type { ChatTurnItem } from "@otter/contracts/chats";
import { findMatches } from "@otter/client/agents/chat-find";
import {
  blocksOf,
  compactionLabel,
  prettyJson,
  stepExpandable,
  stepGroupTitle,
  stepIcon,
  stepPending,
  type StepIcon,
  type StepItem,
} from "@otter/client/agents/work-log";
import { useReduceMotion } from "@otter/ui-native/accessibility";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { useRecyclingState } from "@shopify/flash-list";
import { Fragment, use, useEffect, type ReactNode } from "react";
import { Pressable, ScrollView, Text as NativeText, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { ChatMarkdown, ChatTextContext } from "./markdown.tsx";

const SYMBOLS: Record<StepIcon, IconName> = {
  terminal: "terminal",
  "file-text": "doc.text",
  "file-pen-line": "square.and.pencil",
  search: "magnifyingglass",
  globe: "globe",
  wrench: "wrench.and.screwdriver",
  command: "command",
};

const stepKey = (item: StepItem) => item.id ?? `${item.step.kind}:${item.step.title}`;

/** Work in progress breathes, as Design.swift's shimmer sweeps it; still under Reduce Motion. */
export function Shimmer({ active, children }: { active: boolean; children: ReactNode }) {
  const reduce = useReduceMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!active || reduce) {
      cancelAnimation(opacity);
      opacity.set(1);
      return;
    }
    opacity.set(withDelay(600, withRepeat(withTiming(0.45, { duration: 675 }), -1, true)));
  }, [active, reduce, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** The steps of a reply and what the agent said between them (Transcript.swift's WorkLog). */
export function WorkLog({
  items,
  live,
  turnId,
}: {
  items: ChatTurnItem[];
  live: boolean;
  /** Its reply: a recycled row starts with its steps closed. */
  turnId: string;
}) {
  return (
    <View style={{ gap: 1 }}>
      {blocksOf(items).map((block) => {
        const key =
          block.kind === "text"
            ? block.text
            : block.kind === "step"
              ? stepKey(block.item)
              : stepKey(block.items[0]);
        if (block.kind === "text")
          return block.text.trim() ? (
            <View key={key} style={{ paddingVertical: 6 }}>
              <ChatMarkdown markdown={block.text} />
            </View>
          ) : null;
        if (block.kind === "step")
          return <StepRow key={key} item={block.item} live={live} turnId={turnId} />;
        return (
          <View key={key}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7, minHeight: 28 }}>
              <Icon
                name="command"
                size={13}
                weight="medium"
                color="mutedForeground"
                style={{ width: 21 }}
              />
              <Text size="sm" color="mutedForeground">
                {stepGroupTitle(block.source)}
              </Text>
            </View>
            {block.items.map((item) => (
              <View key={stepKey(item)} style={{ paddingLeft: 14 }}>
                <StepRow item={item} live={live} turnId={turnId} />
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function StepRow({ item, live, turnId }: { item: StepItem; live: boolean; turnId: string }) {
  const theme = useTheme();
  const [open, setOpen] = useRecyclingState(false, [turnId]);
  const { step, output } = item;
  const running = stepPending(item, live);
  const more = stepExpandable(item);
  const failed = Boolean(step.compaction && output);
  const title = step.compaction ? compactionLabel(output, live) : step.title;
  const color = failed ? "error" : "mutedForeground";
  const pretty = open ? prettyJson(output) : null;
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={more ? { expanded: open } : undefined}
        disabled={!more}
        onPress={() => {
          haptics.tap();
          setOpen(!open);
        }}
      >
        <Shimmer active={running}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, minHeight: 28 }}>
            <Icon
              name={step.compaction ? "rectangle.compress.vertical" : SYMBOLS[stepIcon(step)]}
              size={13}
              weight="medium"
              color={color}
              style={{ width: 21 }}
            />
            <Text size="sm" color={color} numberOfLines={1} style={{ flexShrink: 1 }}>
              <MarkedTitle title={title} />
            </Text>
            {more ? (
              <Icon
                name="chevron.down"
                size={10}
                weight="semibold"
                color={color}
                style={{ opacity: 0.7, transform: [{ rotate: open ? "180deg" : "0deg" }] }}
              />
            ) : null}
          </View>
        </Shimmer>
      </Pressable>
      {open ? (
        <View
          style={{
            padding: 12,
            gap: 6,
            marginLeft: 28,
            marginBottom: 6,
            borderRadius: theme.radius.xl,
            backgroundColor: theme.colors.card,
          }}
        >
          <Text size="2xs" color="mutedForeground" style={{ fontFamily: theme.fonts.mono }}>
            {pretty ? "json" : "text"}
          </Text>
          {step.detail ? (
            <Text selectable size="xs" style={{ fontFamily: theme.fonts.mono }}>
              {step.detail}
            </Text>
          ) : null}
          {output ? (
            <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
              <Text selectable size="xs" style={{ fontFamily: theme.fonts.mono, lineHeight: 16 }}>
                {pretty ?? output}
              </Text>
            </ScrollView>
          ) : running ? (
            <Text size="body" color="mutedForeground">
              Running…
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function MarkedTitle({ title }: { title: string }) {
  const theme = useTheme();
  const { find } = use(ChatTextContext);
  const matches = findMatches(title, find.trim());
  if (!matches.length) return title;
  const highlight = alpha(theme.colors.warning, 0.35);
  return (
    <>
      {matches.map(({ start, end }, index) => (
        <Fragment key={start}>
          {title.slice(matches[index - 1]?.end ?? 0, start)}
          <NativeText style={{ backgroundColor: highlight }}>{title.slice(start, end)}</NativeText>
        </Fragment>
      ))}
      {title.slice(matches.at(-1)?.end)}
    </>
  );
}
