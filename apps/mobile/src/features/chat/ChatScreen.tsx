import { clampTitle, type Conversation } from "@otter-mail/client-runtime/state/chats";
import type { ChatTurn, ChatTurnItem } from "@otter-mail/contracts/chats";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { GlassView } from "expo-glass-effect";
import { SymbolView } from "expo-symbols";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActionSheetIOS,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";

import type { RootStack } from "../../App";
import { chats, isProviderUsable, useAgentProviders, useChats } from "../../state/chats";
import { clientPlatform } from "../../state/client";
import { useKeyboardInset } from "../keyboard";
import { palette, type Palette } from "../theme";

type Props = NativeStackScreenProps<RootStack, "Chat">;

/**
 * The agent (apps/ios's sheet): one of the account's chats, synced through
 * core and the relay, on client-runtime's chats store, the web app's. Turns
 * stream in as core's agent events arrive.
 */
export function ChatScreen({ navigation }: Props) {
  const colors = palette(useColorScheme());
  const keyboard = useKeyboardInset();
  const providers = useAgentProviders();
  const usable = providers.filter(isProviderUsable);
  const conversations = useChats((s) => s.conversations);
  const activeId = useChats((s) => s.activeId);
  const runs = useChats((s) => s.runs);
  const ready = useChats((s) => s.ready);
  const convo = conversations.find((c) => c.id === activeId);
  const provider = convo?.provider ?? usable[0]?.kind ?? providers[0]?.kind;
  const running = convo ? Boolean(runs[convo.id]) : false;
  const scroll = useRef<{ scrollToEnd(options: { animated: boolean }): void }>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (convo && !convo.loaded) void chats.loadChat(convo.id);
  }, [convo]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: convo && convo.turns.length > 0 ? convo.title : "Agent",
      headerLeft: () => (
        <Pressable
          onPress={() => pickChat(conversations)}
          hitSlop={10}
          accessibilityLabel="Chats"
          testID="chat-list"
        >
          <SymbolView name="list.bullet" size={20} tintColor={colors.text} />
        </Pressable>
      ),
      headerRight: () =>
        provider ? (
          <Pressable
            onPress={() => chats.newChat(provider)}
            hitSlop={10}
            accessibilityLabel="New chat"
            testID="chat-new"
          >
            <SymbolView name="square.and.pencil" size={20} tintColor={colors.text} />
          </Pressable>
        ) : null,
    });
  });

  const send = () => {
    const question = draft.trim();
    if (!question || !provider) return;
    const id = convo?.id ?? chats.newChat(provider);
    setDraft("");
    chats.sendMessage(
      {
        id: clientPlatform.newId(),
        convoId: id,
        provider,
        question,
        input: question,
        title: clampTitle(question),
      },
      "queue",
    );
  };

  return (
    <View
      style={[styles.fill, { backgroundColor: colors.background }, { paddingBottom: keyboard }]}
    >
      <ScrollView
        ref={scroll as never}
        contentContainerStyle={styles.transcript}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardDismissMode="interactive"
        testID="chat-transcript"
      >
        {!convo || convo.turns.length === 0 ? (
          <Text style={[styles.empty, { color: colors.secondary }]}>
            {!ready
              ? "Loading chats…"
              : providers.length === 0
                ? "No agent is set up on this iPhone."
                : usable.length === 0
                  ? (providers[0]?.message ?? "Sign in to your Otter account to use the agent.")
                  : "Ask about your mail."}
          </Text>
        ) : null}
        {convo?.turns.map((turn) => (
          <Turn key={turn.id} turn={turn} colors={colors} />
        ))}
        {running ? (
          <Text style={[styles.thinking, { color: colors.secondary }]}>Thinking…</Text>
        ) : null}
      </ScrollView>
      <GlassView style={styles.composer} glassEffectStyle="regular" isInteractive>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={
            provider
              ? `Ask ${providers.find((p) => p.kind === provider)?.displayName ?? "the agent"}`
              : "Ask the agent"
          }
          placeholderTextColor={colors.secondary}
          multiline
          style={[styles.input, { color: colors.text }]}
          accessibilityLabel="Message to the agent"
          testID="chat-input"
        />
        <Pressable
          onPress={() => (running && !draft.trim() && convo ? chats.stopRun(convo.id) : send())}
          disabled={!provider}
          accessibilityLabel={running && !draft.trim() ? "Stop" : "Send"}
          testID="chat-send"
          style={styles.send}
        >
          <SymbolView
            name={running && !draft.trim() ? "stop.circle.fill" : "arrow.up.circle.fill"}
            size={32}
            tintColor={draft.trim() || running ? colors.accent : colors.secondary}
          />
        </Pressable>
      </GlassView>
    </View>
  );
}

function pickChat(conversations: readonly Conversation[]) {
  const list = conversations.filter((c) => c.turns.length > 0 || !c.loaded).slice(0, 12);
  const options = [...list.map((c) => c.title), "Cancel"];
  ActionSheetIOS.showActionSheetWithOptions(
    { title: "Chats", options, cancelButtonIndex: options.length - 1 },
    (i) => {
      const chat = list[i];
      if (chat) chats.showChat(chat.id);
    },
  );
}

function Turn({ turn, colors }: { turn: ChatTurn; colors: Palette }) {
  if (turn.role === "user") {
    return (
      <View style={[styles.user, { backgroundColor: colors.card }]}>
        <Text style={[styles.text, { color: colors.text }]} selectable>
          {turn.text}
        </Text>
      </View>
    );
  }
  const items: ChatTurnItem[] = turn.items ?? [{ kind: "text", text: turn.text }];
  return (
    <View style={styles.assistant}>
      {items.map((item, i) =>
        item.kind === "step" ? (
          <View key={item.id ?? i} style={styles.step}>
            <SymbolView
              name={
                item.step.kind === "search"
                  ? "magnifyingglass"
                  : item.step.kind === "edit"
                    ? "pencil"
                    : "gearshape"
              }
              size={13}
              tintColor={colors.secondary}
            />
            <Text style={[styles.stepText, { color: colors.secondary }]} numberOfLines={1}>
              {item.step.title}
            </Text>
          </View>
        ) : (
          <Markdownish key={item.id ?? i} text={item.text} colors={colors} />
        ),
      )}
      {turn.error ? <Text style={{ color: colors.trash }}>{turn.error}</Text> : null}
    </View>
  );
}

/** Paragraphs, bullets and bold, as the web's markdown shows them; code stays monospaced. */
function Markdownish({ text, colors }: { text: string; colors: Palette }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        if (block.startsWith("```")) {
          return (
            <Text
              key={i}
              style={[styles.code, { color: colors.text, backgroundColor: colors.card }]}
              selectable
            >
              {block.replace(/^```\w*\n?|```$/g, "")}
            </Text>
          );
        }
        return (
          <Text key={i} style={[styles.text, { color: colors.text }]} selectable>
            {block.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <Text key={j} style={{ fontWeight: "700" }}>
                  {part.slice(2, -2)}
                </Text>
              ) : (
                part.replace(/^[-*] /gm, "• ")
              ),
            )}
          </Text>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  transcript: { padding: 16, gap: 14, paddingBottom: 24 },
  empty: { textAlign: "center", marginTop: 80, fontSize: 15 },
  user: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  assistant: { gap: 8 },
  text: { fontSize: 16, lineHeight: 23 },
  code: { fontFamily: "Menlo", fontSize: 13, padding: 10, borderRadius: 10 },
  step: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepText: { fontSize: 13, flex: 1 },
  thinking: { fontSize: 14, fontStyle: "italic" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 26,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 52,
  },
  input: { flex: 1, fontSize: 16, maxHeight: 140, paddingTop: 10, paddingBottom: 10 },
  send: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});
