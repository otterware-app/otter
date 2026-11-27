import type { ChatTurn } from "@otter/contracts/chats";
import { formatAttachmentSize } from "@otter/client/agents/chat-attachments";
import { formatDuration, shownItems, splitAnswer } from "@otter/client/agents/chat-runs";
import { chatChangeKey, chatChangeLine, mergeChatChanges } from "@otter/client/agents/chat-changes";
import { citationText } from "@otter/client/agents/chat-cite";
import { STOPPED, retryTurn } from "@otter/client/agents/chat-store";
import { callUnsaid } from "@otter/client/agents/talk";
import { clockText } from "@otter/client/agents/chat-time";
import { replyBubbles, writtenBubbles } from "@otter/client/agents/reply-bubbles";
import {
  contextLabel,
  deliveryLabel,
  type MessageRow,
  type ReplyRow,
} from "@otter/client/agents/transcript";
import { useReduceMotion } from "@otter/ui-native/accessibility";
import { Bubble, bubbleColors } from "@otter/ui-native/components/bubble";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import { SwipeToReply } from "@otter/ui-native/components/swipe-to-reply";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { alpha, useTheme } from "@otter/ui-native/theme";
import * as Clipboard from "expo-clipboard";
import { Button } from "@otter/ui-native/components/button";
import { useMappingHelper, useRecyclingState } from "@shopify/flash-list";
import { Image } from "expo-image";
import { memo, use, useEffect, useState } from "react";
import { Pressable, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { ChatMarkdown, ChatTextContext } from "./markdown.tsx";
import { Shimmer, WorkLog } from "./work-log.tsx";

/** The day between messages, as WhatsApp marks it. */
export function DayPill({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: "center", paddingBottom: 10 }}>
      <View
        accessibilityRole="header"
        style={{
          height: 24,
          paddingHorizontal: 10,
          justifyContent: "center",
          borderRadius: theme.radius.full,
          backgroundColor: bubbleColors(theme).incoming,
        }}
      >
        <Text size="xs" weight="semibold" color="mutedForeground">
          {text}
        </Text>
      </View>
    </View>
  );
}

/** WhatsApp's ticks: one when sent, two when the agent has it, in the accent once it answered. */
function Ticks({ answered }: { answered: number }) {
  const color = answered === 2 ? "primary" : "mutedForeground";
  return (
    <View
      accessible
      accessibilityLabel={answered === 2 ? "Answered" : answered === 1 ? "Received" : "Sent"}
      style={{ flexDirection: "row" }}
    >
      <Icon name="checkmark" size={10} weight="bold" color={color} />
      {answered > 0 ? (
        <Icon name="checkmark" size={10} weight="bold" color={color} style={{ marginLeft: -6 }} />
      ) : null}
    </View>
  );
}

/** The room a bubble's text keeps for the time over its last line, measured from the time as drawn. */
function useStampRoom(stamp: string | undefined) {
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useRecyclingState(0, [stamp, fontScale]);
  const onLayout = (e: LayoutChangeEvent) => {
    if (stamp) setWidth(Math.ceil(e.nativeEvent.layout.width));
  };
  return { reserve: stamp ? width || stamp.length * 6 * fontScale : undefined, onLayout };
}

function endsInText(markdown: string) {
  return !/^\s*(```|~~~|\||>|!\[)/m.test(markdown.split("\n\n").at(-1) ?? "");
}

const CONTEXT_ICONS: Record<string, IconName> = {
  quote: "text.quote",
  draft: "square.and.pencil",
  sent: "paperplane",
};

/** One message of yours, in WhatsApp's bubble on the right: what it carried, the words, when, and whether the agent has it. */
export function UserTurn({
  row,
  answered,
  joinsAbove,
  joinsBelow,
}: {
  row: MessageRow;
  /** 0: sent; 1: the agent is on it; 2: it answered. */
  answered: number;
  joinsAbove: boolean;
  joinsBelow: boolean;
}) {
  const theme = useTheme();
  const { quote } = use(ChatTextContext);
  const { turn } = row;
  const steer =
    row.steered ?? (turn.intent === "steer" || turn.intent === "promoted" ? turn.intent : null);
  const hasWords = Boolean(turn.text || turn.skill || turn.citations?.length);
  const inlineStamp = Boolean(turn.text) && endsInText(turn.text);
  const time = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      {steer ? (
        <View
          accessible
          accessibilityLabel="Steer"
          accessibilityHint={
            steer === "promoted"
              ? "Queued, then steered the active turn"
              : "Steered the active turn"
          }
          style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
        >
          <Icon name="arrow.uturn.forward" size={10} color="mutedForeground" />
          <Text size="2xs" weight="medium" color="mutedForeground">
            Steer
          </Text>
        </View>
      ) : null}
      {turn.startedAt ? (
        <Text size="2xs" color="mutedForeground" tabular>
          {clockText(turn.startedAt)}
        </Text>
      ) : null}
      {turn.spoken ? (
        <View accessible accessibilityLabel="Said in a call">
          <Icon name="waveform" size={10} weight="semibold" color="mutedForeground" />
        </View>
      ) : (
        <Ticks answered={answered} />
      )}
    </View>
  );
  const stamp = turn.startedAt ? clockText(turn.startedAt) : "";
  const room = useStampRoom(
    inlineStamp ? `${steer ?? ""}${stamp}${turn.spoken ? "~" : "✓"}` : undefined,
  );
  return (
    <View style={{ alignItems: "flex-end", gap: 4, paddingLeft: 56 }}>
      {turn.context ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Icon
            name={CONTEXT_ICONS[turn.context.kind] ?? "envelope"}
            size={13}
            color="mutedForeground"
          />
          <Text size="body" color="mutedForeground" numberOfLines={1}>
            {contextLabel(turn.context)}
          </Text>
        </View>
      ) : null}
      {turn.attachments?.length ? <Attachments turn={turn} /> : null}
      {hasWords ? (
        <SwipeToReply
          onReply={quote && turn.text ? () => quote(citationText(turn.text), "You") : undefined}
        >
          <Bubble
            side="trailing"
            joinsAbove={joinsAbove}
            joinsBelow={joinsBelow}
            style={[
              { paddingHorizontal: 11, paddingTop: 6, paddingBottom: 7, gap: 6 },
              row.waiting && {
                backgroundColor: "transparent",
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: alpha(theme.colors.mutedForeground, 0.4),
              },
            ]}
          >
            {turn.skill ? (
              <Text
                size="body"
                weight="medium"
                color="mutedForeground"
                style={{ fontFamily: theme.fonts.mono }}
              >
                /{turn.skill}
              </Text>
            ) : null}
            {turn.citations?.map((citation) => (
              <View key={citation.text} style={{ gap: 6 }}>
                <QuotedReply text={citation.text} />
                {citation.comment ? <Text size="base">{citation.comment}</Text> : null}
              </View>
            ))}
            {turn.text ? (
              <ChatMarkdown markdown={turn.text} reserve={room.reserve} source="You" />
            ) : null}
            <View
              onLayout={room.onLayout}
              style={
                inlineStamp
                  ? { position: "absolute", right: 9, bottom: 5 }
                  : { alignSelf: "flex-end" }
              }
            >
              {time}
            </View>
          </Bubble>
        </SwipeToReply>
      ) : (
        <View style={{ paddingRight: 4 }}>{time}</View>
      )}
    </View>
  );
}

/** A message quoted in a reply: the accent's bar, and the start of it. */
function QuotedReply({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        borderRadius: theme.radius.lg,
        overflow: "hidden",
        backgroundColor: alpha(theme.colors.foreground, 0.06),
      }}
    >
      <View style={{ width: 4, backgroundColor: theme.colors.primary }} />
      <Text
        size="sm"
        color="mutedForeground"
        numberOfLines={3}
        style={{ flex: 1, paddingLeft: 10, paddingRight: 8, paddingVertical: 6 }}
      >
        {text.replace(/\n/g, " ")}
      </Text>
    </View>
  );
}

function Attachments({ turn }: { turn: ChatTurn }) {
  const theme = useTheme();
  const files = turn.attachments ?? [];
  const images = files.filter((file) => file.kind === "image");
  return (
    <View style={{ alignItems: "flex-end", gap: 6 }}>
      {images.length ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            gap: 6,
            maxWidth: 214,
          }}
        >
          {images.map((file) => (
            <View
              key={file.name}
              accessible
              accessibilityLabel={file.name}
              style={{
                width: 104,
                height: 104,
                borderRadius: 14,
                overflow: "hidden",
                backgroundColor: theme.colors.card,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {file.thumb ? (
                <Image
                  source={{ uri: file.thumb }}
                  style={{ width: 104, height: 104 }}
                  contentFit="cover"
                />
              ) : (
                <Icon name="photo" color="mutedForeground" />
              )}
            </View>
          ))}
        </View>
      ) : null}
      {files
        .filter((file) => file.kind !== "image")
        .map((file) => (
          <View
            key={file.name}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 14,
              backgroundColor: theme.colors.card,
            }}
          >
            <Icon name="doc" size={15} color="mutedForeground" />
            <View style={{ gap: 1 }}>
              <Text size="sm" weight="medium" numberOfLines={1}>
                {file.name}
              </Text>
              <Text size="xs" color="mutedForeground">
                {formatAttachmentSize(file.size)}
              </Text>
            </View>
          </View>
        ))}
    </View>
  );
}

function CopyButton({ text }: { text: string }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? "Copied" : "Copy message"}
      hitSlop={6}
      onPress={() => {
        void Clipboard.setStringAsync(text);
        setCopied(true);
        haptics.done();
      }}
      style={{
        width: 28,
        height: 28,
        borderRadius: theme.radius.full,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: alpha(bubbleColors(theme).incoming, 0.85),
      }}
    >
      <Icon name={copied ? "checkmark" : "doc.on.doc"} size={13} color="mutedForeground" />
    </Pressable>
  );
}

/** The agent writing: three dots in its bubble. */
function TypingBubble() {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    t.set(withRepeat(withTiming(1, { duration: 1200, easing: linear }), -1, false));
    return () => cancelAnimation(t);
  }, [reduce, t]);
  return (
    <View
      accessible
      accessibilityLabel="Writing"
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        gap: 5,
        height: 36,
        paddingHorizontal: 14,
        alignItems: "center",
        borderRadius: 18,
        backgroundColor: bubbleColors(theme).incoming,
      }}
    >
      {DOTS.map((dot) => (
        <Dot key={dot} t={t} dot={dot} color={theme.colors.mutedForeground} />
      ))}
    </View>
  );
}

const DOTS = [0, 1, 2];

function linear(t: number) {
  "worklet";
  return t;
}

function Dot({ t, dot, color }: { t: SharedValue<number>; dot: number; color: string }) {
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + 0.65 * Math.max(0, Math.sin(t.get() * 2 * Math.PI - dot * 0.7)),
  }));
  return (
    <Animated.View
      style={[{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color }, style]}
    />
  );
}

/** What the agent was doing on its last turn, while it runs. */
export type Live = "working" | "compacting" | "waiting";

/** A reply: its work folded under a pill, its answer a bubble a paragraph, and how it ended (AssistantTurnView). */
export function AssistantTurn({
  row,
  name,
  live,
  continued,
  found,
  canFork,
  onFork,
  speaking = false,
}: {
  row: ReplyRow;
  /** The agent's name. */
  name: string;
  /** What the run is doing, while this reply is being written. */
  live: Live | null;
  /** The turn before it was a steer: its work continued the run. */
  continued: boolean;
  /** Find in chat is on it: its work shows. */
  found: boolean;
  canFork: boolean;
  onFork: () => void;
  /** Being said in the call going on: its words light up as the voice reaches them. */
  speaking?: boolean;
}) {
  const theme = useTheme();
  const { turn } = row;
  const { getMappingKey } = useMappingHelper();
  const [open, setOpen] = useRecyclingState(false, [turn.id]);
  const items = shownItems(turn);
  const { work, answer } = row.layout?.heard ? { work: items, answer: "" } : splitAnswer(items);
  const showsWork = open || found;
  const said =
    live && !showsWork
      ? items.flatMap((item) => (item.kind === "text" ? [item.text.trim()] : [])).join("\n\n")
      : answer;
  const bubbles = live ? writtenBubbles(said) : replyBubbles(said);
  const steps = work.filter((item) => item.kind === "step").length;
  const summary = live
    ? { working: "Working…", compacting: "Compacting…", waiting: "Waiting…" }[live]
    : (row.layout?.fold?.label ??
      (turn.startedAt && turn.finishedAt && turn.finishedAt > turn.startedAt
        ? `${continued ? "Continued" : "Worked"} for ${formatDuration(turn.finishedAt - turn.startedAt)}`
        : `Took ${steps} step${steps === 1 ? "" : "s"}`));
  const delivered = deliveryLabel(turn);
  const changes = row.showsChanges ? mergeChatChanges(turn.changes ?? []) : [];
  const time = !live && turn.finishedAt ? clockText(turn.finishedAt) : undefined;
  return (
    <View style={{ gap: 3, alignItems: "flex-start" }}>
      {delivered && turn.delivered ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            height: 26,
            paddingHorizontal: 10,
            marginBottom: 3,
            borderRadius: theme.radius.full,
            backgroundColor: bubbleColors(theme).incoming,
          }}
        >
          <Icon
            name={turn.delivered.kind === "automation" ? "clock" : "paperplane"}
            size={12}
            color="mutedForeground"
          />
          <Text size="xs" weight="medium" color="mutedForeground">
            {delivered}
          </Text>
        </View>
      ) : null}
      {work.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={summary}
          accessibilityState={{ expanded: showsWork }}
          onPress={() => {
            haptics.tap();
            setOpen(!open);
          }}
          style={{
            height: 28,
            paddingHorizontal: 11,
            marginBottom: 3,
            justifyContent: "center",
            borderRadius: theme.radius.full,
            backgroundColor: bubbleColors(theme).incoming,
          }}
        >
          <Shimmer active={Boolean(live)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon
                name={live ? "circle.dashed" : "gearshape.2"}
                size={12}
                weight="medium"
                color="mutedForeground"
              />
              <Text size="body" weight="medium" color="mutedForeground">
                {summary}
              </Text>
              <Icon
                name="chevron.right"
                size={10}
                weight="semibold"
                color="faintForeground"
                style={{ transform: [{ rotate: showsWork ? "90deg" : "0deg" }] }}
              />
            </View>
          </Shimmer>
        </Pressable>
      ) : null}
      {work.length && showsWork ? (
        <View
          style={{
            alignSelf: "stretch",
            paddingHorizontal: 12,
            paddingVertical: 8,
            marginBottom: 3,
            borderRadius: 18,
            backgroundColor: bubbleColors(theme).incoming,
          }}
        >
          <WorkLog items={work} live={Boolean(live)} turnId={turn.id} />
        </View>
      ) : null}
      {speaking ? (
        <SpokenWords text={said} />
      ) : (
        bubbles.map((markdown, index) => (
          <ReplyText
            key={getMappingKey(`${turn.id}-${index}`, index)}
            markdown={markdown}
            last={index === bubbles.length - 1}
            time={time}
            answer={time && index === bubbles.length - 1 ? answer : ""}
            canFork={canFork}
            onFork={onFork}
          />
        ))
      )}
      {live && !work.length ? <TypingBubble /> : null}
      {turn.error ? (
        <Failure error={turn.error} name={name} retry={row.retry} turnId={turn.id} />
      ) : null}
      {changes.length ? <Changes changes={changes} /> : null}
      {row.detached ? (
        <Text size="sm" color="mutedForeground">
          Lost {name} mid-reply. The rest shows here once it's back.
        </Text>
      ) : null}
      {turn.forked ? (
        <View
          style={{
            alignSelf: "stretch",
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingTop: 8,
          }}
        >
          <View style={{ flex: 1, height: 1, backgroundColor: alpha(theme.colors.border, 0.7) }} />
          <Icon name="arrow.triangle.branch" size={13} color="mutedForeground" />
          <Text size="body" color="mutedForeground">
            Forked from conversation
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: alpha(theme.colors.border, 0.7) }} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * A paragraph of the answer, on the page as in Claude's app; the last carries the time, Fork and
 * Copy under it.
 */
const ReplyText = memo(function ReplyText({
  markdown,
  last,
  time,
  answer,
  canFork,
  onFork,
}: {
  markdown: string;
  last: boolean;
  time: string | undefined;
  answer: string;
  canFork: boolean;
  onFork: () => void;
}) {
  const { quote } = use(ChatTextContext);
  const stamp = last ? time : undefined;
  return (
    <View style={{ alignSelf: "stretch", paddingHorizontal: 4, paddingBottom: last ? 0 : 8 }}>
      <SwipeToReply onReply={quote && (() => quote(citationText(markdown)))}>
        <ChatMarkdown markdown={markdown} />
      </SwipeToReply>
      {stamp ? (
        <ReplyActions time={stamp} answer={answer} canFork={canFork} onFork={onFork} />
      ) : null}
    </View>
  );
});

/** Under an answer: when it came, then Fork and Copy. */
function ReplyActions({
  time,
  answer,
  canFork,
  onFork,
}: {
  time: string;
  answer: string;
  canFork: boolean;
  onFork: () => void;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
      <Text size="2xs" color="mutedForeground" tabular style={{ marginRight: 4 }}>
        {time}
      </Text>
      {answer && canFork ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fork from here"
          hitSlop={6}
          onPress={onFork}
          style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="arrow.triangle.branch" size={13} color="mutedForeground" />
        </Pressable>
      ) : null}
      {answer ? <CopyButton text={answer} /> : null}
    </View>
  );
}

/**
 * What the voice is saying in a call, lit as it's said: the words it hasn't reached yet stay dim,
 * as Claude's voice mode does.
 */
function SpokenWords({ text }: { text: string }) {
  const [unsaid, setUnsaid] = useState(() => callUnsaid());
  useEffect(() => {
    const timer = setInterval(() => setUnsaid(callUnsaid()), 80);
    return () => clearInterval(timer);
  }, []);
  // A word lights up whole, as the voice starts it.
  const reached = Math.max(0, text.length - unsaid);
  const space = text.indexOf(" ", reached);
  const said = unsaid === 0 || space < 0 ? text.length : space;
  return (
    <View style={{ alignSelf: "stretch", paddingHorizontal: 4 }}>
      <Text size="base" style={{ lineHeight: 23 }}>
        {text.slice(0, said)}
        <Text size="base" color="faintForeground" style={{ lineHeight: 23 }}>
          {text.slice(said)}
        </Text>
      </Text>
    </View>
  );
}

function Failure({
  error,
  name,
  retry,
  turnId,
}: {
  error: string;
  name: string;
  retry: boolean;
  turnId: string;
}) {
  const theme = useTheme();
  const color = error === STOPPED ? "mutedForeground" : "error";
  return (
    <View style={{ gap: 8, alignItems: "flex-start" }}>
      <View
        style={{
          flexDirection: "row",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 9,
          borderRadius: 18,
          backgroundColor: bubbleColors(theme).incoming,
        }}
      >
        <Icon name="exclamationmark.circle" size={15} color={color} style={{ marginTop: 2 }} />
        <View style={{ gap: 2, flexShrink: 1 }}>
          <Text size="sm" weight="semibold" color={color}>
            {name} error
          </Text>
          <Text size="sm" color={color}>
            {error}
          </Text>
        </View>
      </View>
      {retry ? (
        <Button
          title="Retry"
          icon="arrow.clockwise"
          variant="secondary"
          size="sm"
          onPress={() => retryTurn(turnId)}
        />
      ) : null}
    </View>
  );
}

const CHANGE_ICONS: Record<string, IconName> = {
  draft: "square.and.pencil",
  thread: "envelope",
  label: "tag",
  view: "line.3.horizontal.decrease",
  theme: "paintpalette",
  event: "calendar",
};

/** What the agent changed in Otter: listed, to know it happened. */
function Changes({ changes }: { changes: NonNullable<ChatTurn["changes"]> }) {
  const theme = useTheme();
  return (
    <View
      style={{
        alignSelf: "stretch",
        marginTop: 3,
        marginRight: 44,
        borderRadius: 18,
        backgroundColor: bubbleColors(theme).incoming,
      }}
    >
      {changes.map((change, index) => {
        const line = chatChangeLine(change);
        return (
          <View
            key={chatChangeKey(change)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              minHeight: 40,
              paddingHorizontal: 12,
              borderTopWidth: index > 0 ? 1 : 0,
              borderTopColor: alpha(theme.colors.border, 0.7),
            }}
          >
            <Icon
              name={CHANGE_ICONS[change.target.kind] ?? "doc"}
              size={14}
              color="mutedForeground"
              style={{ width: 21 }}
            />
            <Text size="sm" numberOfLines={1} style={{ flex: 1 }}>
              {change.title || line.kind}
            </Text>
            <Text size="body" color="mutedForeground">
              {line.action}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
