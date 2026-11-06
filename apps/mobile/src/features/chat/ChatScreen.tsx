import { clampTitle } from "@otter-mail/client-runtime/state/chats";
import type { ChatTurn, ChatTurnItem } from "@otter-mail/contracts/chats";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SymbolView } from "expo-symbols";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import type { RootStack } from "../../App";
import {
  chats,
  defaultAgent,
  updateAgentSettings,
  useAgents,
  useChats,
  type AgentProvider,
} from "../../state/chats";
import { clientPlatform } from "../../state/client";
import { core } from "../../state/core";
import { GlassPanel } from "../GlassPanel";
import { useKeyboardInset } from "../keyboard";
import { agentName } from "../settings/AgentSettings";
import { usePalette, type Palette } from "../theme";
import { AgentMenu } from "./AgentMenu";
import { ApprovalCard, QuestionCard } from "./ChatCards";
import { ChatList } from "./ChatList";
import { Markdown } from "./Markdown";
import { contextMeta, handoffText } from "./context";

type Props = NativeStackScreenProps<RootStack, "Chat">;

const SUGGESTIONS = ["Summarize this conversation", "Draft a reply", "What do I need to do?"];
const EDGE = 24;

/**
 * The agent (the Swift app's AgentView): one of the account's chats, synced through
 * core and the relay, on client-runtime's chats store, the web app's. The chat
 * list swipes in from the left.
 */
export function ChatScreen({ navigation, route }: Props) {
  const colors = usePalette();
  const keyboard = useKeyboardInset();
  const state = useAgents();
  const { providers } = state;
  const conversations = useChats((s) => s.conversations);
  const activeId = useChats((s) => s.activeId);
  const runs = useChats((s) => s.runs);
  const ready = useChats((s) => s.ready);
  const approvals = useChats((s) => s.approvals);
  const questions = useChats((s) => s.questions);
  const convo = conversations.find((c) => c.id === activeId);
  const started = Boolean(convo && convo.turns.length > 0);
  const provider =
    (started || convo?.provider ? providers.find((p) => p.kind === convo?.provider) : undefined) ??
    defaultAgent(state);
  const name = provider ? agentName(provider) : "the agent";
  const run = convo ? runs[convo.id] : undefined;
  const approval = run && approvals.find((a) => a.requestId === run.requestId)?.approval;
  const question = run && questions.find((q) => q.requestId === run.requestId)?.question;
  const steers = provider?.kind !== "openrouter";
  const [context, setContext] = useState(route.params?.context);
  const [draft, setDraft] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const scroll = useRef<{ scrollToEnd(options: { animated: boolean }): void }>(null);

  useEffect(() => {
    if (convo && !convo.loaded) void chats.loadChat(convo.id);
  }, [convo]);

  // A chat from the reader starts fresh, about that mail.
  useEffect(() => {
    if (route.params?.context && provider) chats.newChat(provider.kind);
  }, [route.params?.context]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <AgentMenu
          providers={providers}
          provider={provider}
          locked={started}
          colors={colors}
          onPickAgent={(kind) => {
            void updateAgentSettings({ selected: kind });
            chats.newChat(kind);
          }}
        />
      ),
      headerLeft: () => (
        <Pressable
          onPress={() => setListOpen(true)}
          hitSlop={10}
          accessibilityLabel="Chats"
          testID="chat-list"
        >
          <SymbolView name="clock.arrow.circlepath" size={20} tintColor={colors.text} />
        </Pressable>
      ),
      headerRight: () =>
        provider ? (
          <Pressable
            onPress={() => chats.newChat(provider.kind)}
            disabled={!started}
            hitSlop={10}
            accessibilityLabel="New chat"
            testID="chat-new"
            style={{ opacity: started ? 1 : 0.35 }}
          >
            <SymbolView name="square.and.pencil" size={20} tintColor={colors.text} />
          </Pressable>
        ) : null,
    });
  });

  const send = (text: string) => {
    const typed = text.trim();
    if (!typed || !provider || (run && !steers)) return;
    const id = convo?.id ?? chats.newChat(provider.kind);
    const about = !started ? context : undefined;
    setDraft("");
    setContext(undefined);
    chats.sendMessage(
      {
        id: clientPlatform.newId(),
        convoId: id,
        provider: provider.kind,
        question: typed,
        input: about ? handoffText(typed, about, provider.kind) : typed,
        title: clampTitle(typed),
        ...(about ? { context: contextMeta(about) } : {}),
      },
      "steer",
    );
  };

  const unavailable = ready ? unavailableOf(provider, providers.length, name) : null;

  return (
    <View style={[styles.fill, { paddingBottom: keyboard }]}>
      <ScrollView
        ref={scroll as never}
        contentContainerStyle={styles.transcript}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardDismissMode="interactive"
        testID="chat-transcript"
      >
        {convo?.turns.map((turn) => (
          <Turn key={turn.id} turn={turn} colors={colors} running={Boolean(run)} />
        ))}
      </ScrollView>
      {!started ? (
        <View style={styles.overlay} pointerEvents="box-none">
          {!ready ? (
            <ActivityIndicator color={colors.secondary} />
          ) : unavailable ? (
            <View style={styles.center}>
              <Text style={[styles.welcome, { color: colors.text }]}>{unavailable.title}</Text>
              {unavailable.message ? (
                <Text style={[styles.message, { color: colors.secondary }]}>
                  {unavailable.message}
                </Text>
              ) : null}
              <Pressable
                onPress={() => {
                  navigation.goBack();
                  navigation.navigate("Settings");
                }}
                style={[styles.suggestion, { backgroundColor: colors.card }]}
                testID="chat-open-settings"
              >
                <Text style={[styles.suggestionText, { color: colors.text }]}>Open Settings</Text>
              </Pressable>
              {unavailable.retry ? (
                <Pressable onPress={() => void core.invoke("agent:refreshProviders")}>
                  <Text style={[styles.suggestionText, { color: colors.focus }]}>Try again</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={[styles.welcome, { color: colors.text }]}>What can I help with?</Text>
              {context
                ? SUGGESTIONS.map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => send(s)}
                      style={[styles.suggestion, { backgroundColor: colors.card }]}
                    >
                      <Text style={[styles.suggestionText, { color: colors.text }]}>{s}</Text>
                    </Pressable>
                  ))
                : null}
            </View>
          )}
        </View>
      ) : null}
      {approval ? (
        <ApprovalCard
          key={approval.id}
          agent={name}
          approval={approval}
          colors={colors}
          onRespond={(decision) => void chats.respondApproval(approval.id, decision)}
        />
      ) : question ? (
        <QuestionCard
          key={question.id}
          agent={name}
          question={question}
          colors={colors}
          onAnswer={(answers) => void chats.answerQuestion(question.id, answers)}
        />
      ) : (
        <View>
          {context && !started ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {contextMeta(context).subjects.map((subject) => (
                <GlassPanel key={subject} style={styles.chip}>
                  <View style={styles.chipBody}>
                    <SymbolView name="envelope" size={14} tintColor={colors.text} />
                    <Text style={[styles.chipText, { color: colors.text }]} numberOfLines={1}>
                      {subject}
                    </Text>
                    <Pressable
                      onPress={() => setContext(undefined)}
                      hitSlop={8}
                      accessibilityLabel="Remove"
                    >
                      <SymbolView name="xmark" size={11} weight="bold" tintColor={colors.text} />
                    </Pressable>
                  </View>
                </GlassPanel>
              ))}
            </ScrollView>
          ) : null}
          <GlassPanel style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              editable={!(run && !steers) && Boolean(provider)}
              placeholder={run ? (steers ? `Steer ${name}…` : "Agent is working…") : `Ask ${name}`}
              placeholderTextColor={colors.secondary}
              multiline
              style={[styles.input, { color: colors.text }]}
              accessibilityLabel={`Message ${name}`}
              testID="chat-input"
            />
            {run && (!draft.trim() || !steers) ? (
              <Pressable
                onPress={() => convo && chats.stopRun(convo.id)}
                accessibilityLabel="Stop"
                testID="chat-stop"
                style={[styles.send, { backgroundColor: colors.accent }]}
              >
                <SymbolView name="stop.fill" size={13} tintColor={colors.actionText} />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => send(draft)}
                disabled={!draft.trim() || !provider}
                accessibilityLabel="Send"
                testID="chat-send"
                style={[
                  styles.send,
                  { backgroundColor: colors.accent, opacity: draft.trim() ? 1 : 0.35 },
                ]}
              >
                <SymbolView
                  name="arrow.up"
                  size={15}
                  weight="semibold"
                  tintColor={colors.actionText}
                />
              </Pressable>
            )}
          </GlassPanel>
        </View>
      )}
      <Drawer open={listOpen} onOpenChange={setListOpen} colors={colors}>
        <ChatList
          provider={provider}
          colors={colors}
          visible={listOpen}
          onClose={() => setListOpen(false)}
        />
      </Drawer>
    </View>
  );
}

const CONNECT =
  "Connect your agent in Settings. Its chats live on the server and follow you to every device.";

/** Why the agent can't chat yet, as the Swift app says it; nothing while it's checking or ready. */
function unavailableOf(
  provider: AgentProvider | undefined,
  count: number,
  name: string,
): { title: string; message: string; retry?: boolean } | null {
  if (count === 0) return { title: "No agent is set up on this iPhone.", message: "" };
  if (!provider?.enabled) return { title: `Connect ${name}`, message: CONNECT };
  if (provider.checkedAt === null || provider.status === "ready") return null;
  if (provider.status === "error")
    return { title: `${name} isn't answering`, message: provider.message ?? "", retry: true };
  return { title: `Connect ${name}`, message: provider.message ?? CONNECT };
}

/** A panel from the left edge: swiped in from it, out to it, or tapped away. */
function Drawer({
  open,
  onOpenChange,
  colors,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  colors: Palette;
  children: React.ReactNode;
}) {
  const { width: screen } = useWindowDimensions();
  const width = Math.min(340, screen * 0.86);
  const x = useRef(new Animated.Value(-width)).current;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    Animated.spring(x, {
      toValue: open ? 0 : -width,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  }, [open, width, x]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_, g) => {
          const base = openRef.current ? 0 : -width;
          x.setValue(Math.max(-width, Math.min(0, base + g.dx)));
        },
        onPanResponderRelease: (_, g) => {
          const base = openRef.current ? 0 : -width;
          const at = base + g.dx;
          const next = g.vx > 0.4 || (g.vx > -0.4 && at > -width / 2);
          onOpenChange(next);
          Animated.spring(x, {
            toValue: next ? 0 : -width,
            useNativeDriver: true,
            bounciness: 0,
            speed: 18,
          }).start();
        },
      }),
    [width, x, onOpenChange],
  );

  const shade = x.interpolate({ inputRange: [-width, 0], outputRange: [0, 0.3] });
  return (
    <>
      {!open ? <View style={styles.edge} {...pan.panHandlers} testID="chat-list-edge" /> : null}
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[StyleSheet.absoluteFill, { backgroundColor: "#000", opacity: shade }]}
      >
        <Pressable
          style={styles.fill}
          onPress={() => onOpenChange(false)}
          accessibilityLabel="Close chats"
        />
      </Animated.View>
      <Animated.View
        {...pan.panHandlers}
        style={[
          styles.drawer,
          {
            width,
            backgroundColor: colors.canvas,
            borderColor: colors.border,
            transform: [{ translateX: x }],
          },
        ]}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      >
        {children}
      </Animated.View>
    </>
  );
}

/** Consecutive tool steps fold into one "Used 3 tools" row, as the Swift app shows them. */
type Part =
  | { kind: "text"; key: string; text: string }
  | { kind: "steps"; key: string; steps: Extract<ChatTurnItem, { kind: "step" }>[] };

function parts(turn: ChatTurn): Part[] {
  const items: ChatTurnItem[] = turn.items ?? [{ kind: "text", text: turn.text }];
  const out: Part[] = [];
  items.forEach((item, i) => {
    const key = item.id ?? String(i);
    if (item.kind === "text") {
      if (item.text.trim()) out.push({ kind: "text", key, text: item.text });
      return;
    }
    const last = out[out.length - 1];
    if (last?.kind === "steps") last.steps.push(item);
    else out.push({ kind: "steps", key, steps: [item] });
  });
  return out;
}

function Turn({ turn, colors, running }: { turn: ChatTurn; colors: Palette; running: boolean }) {
  if (turn.role === "user") {
    const about = turn.context;
    return (
      <View style={styles.userTurn}>
        {about && about.count > 0 ? (
          <View style={styles.about}>
            <SymbolView name="envelope" size={12} tintColor={colors.secondary} />
            <Text style={[styles.aboutText, { color: colors.secondary }]} numberOfLines={1}>
              {about.count > 1 ? `${about.count} conversations` : about.subjects[0]}
            </Text>
          </View>
        ) : null}
        <View style={[styles.user, { backgroundColor: colors.card }]}>
          <Text style={[styles.text, { color: colors.text }]} selectable>
            {turn.text}
          </Text>
        </View>
        {turn.error ? (
          <Text style={[styles.note, { color: colors.secondary }]}>{turn.error}</Text>
        ) : null}
      </View>
    );
  }
  const shown = parts(turn);
  const waiting =
    running && !turn.finishedAt && !turn.error && !shown.some((p) => p.kind === "text");
  return (
    <View style={styles.assistant}>
      {shown.map((part) =>
        part.kind === "steps" ? (
          <Steps key={part.key} steps={part.steps} colors={colors} />
        ) : (
          <Markdown key={part.key} text={part.text} colors={colors} />
        ),
      )}
      {waiting ? (
        <ActivityIndicator size="small" color={colors.secondary} style={styles.start} />
      ) : null}
      {turn.error ? (
        <View style={styles.error}>
          <SymbolView name="exclamationmark.triangle" size={13} tintColor={colors.error} />
          <Text style={[styles.note, styles.errorText, { color: colors.error }]}>{turn.error}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Steps({
  steps,
  colors,
}: {
  steps: Extract<ChatTurnItem, { kind: "step" }>[];
  colors: Palette;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.steps}>
      <Pressable
        onPress={() => setOpen(!open)}
        style={styles.stepsHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID="chat-steps"
      >
        <SymbolView name="wrench.and.screwdriver" size={13} tintColor={colors.secondary} />
        <Text style={[styles.note, { color: colors.secondary }]}>
          {`Used ${steps.length} tool${steps.length === 1 ? "" : "s"}`}
        </Text>
        <SymbolView
          name={open ? "chevron.down" : "chevron.right"}
          size={10}
          tintColor={colors.secondary}
        />
      </Pressable>
      {open
        ? steps.map((s, i) => (
            <View key={s.id ?? i} style={styles.step}>
              <Text style={[styles.stepTitle, { color: colors.text }]}>{s.step.title}</Text>
              {s.step.detail ? (
                <Text style={[styles.stepOutput, { color: colors.secondary }]} numberOfLines={2}>
                  {s.step.detail}
                </Text>
              ) : null}
              {s.output ? (
                <Text style={[styles.stepOutput, { color: colors.secondary }]} numberOfLines={4}>
                  {s.output}
                </Text>
              ) : null}
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  transcript: { paddingHorizontal: 20, paddingTop: 12, gap: 18, paddingBottom: 24 },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  center: { alignItems: "center", gap: 10 },
  welcome: { fontSize: 22, fontWeight: "600", textAlign: "center", marginBottom: 8 },
  message: { fontSize: 15, textAlign: "center", lineHeight: 21, marginBottom: 8 },
  suggestion: { height: 38, borderRadius: 19, paddingHorizontal: 16, justifyContent: "center" },
  suggestionText: { fontSize: 15 },
  userTurn: { alignItems: "flex-end", gap: 6, paddingLeft: 48 },
  about: { flexDirection: "row", alignItems: "center", gap: 4 },
  aboutText: { fontSize: 12 },
  user: { borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 },
  assistant: { gap: 10 },
  text: { fontSize: 16, lineHeight: 23 },
  note: { fontSize: 13, lineHeight: 18 },
  start: { alignSelf: "flex-start" },
  error: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  errorText: { flex: 1 },
  steps: { gap: 6 },
  stepsHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  step: { gap: 2, paddingLeft: 19 },
  stepTitle: { fontFamily: "Menlo", fontSize: 12 },
  stepOutput: { fontFamily: "Menlo", fontSize: 11 },
  chips: { paddingHorizontal: 12, marginBottom: 8, flexGrow: 0 },
  chip: { height: 32, borderRadius: 16, marginRight: 6, maxWidth: 260 },
  chipBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
  },
  chipText: { fontSize: 15, flexShrink: 1 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 26,
    paddingLeft: 18,
    paddingRight: 8,
    paddingVertical: 6,
    minHeight: 52,
  },
  input: { flex: 1, fontSize: 16, maxHeight: 140, paddingTop: 10, paddingBottom: 10 },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 3,
  },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: EDGE },
  drawer: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
});
