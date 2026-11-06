import type { ApprovalDecision, ApprovalRequest, ChatQuestion } from "@otter-mail/contracts/chats";
import { SymbolView } from "expo-symbols";
import { useState, type ReactNode } from "react";
import {
  ActionSheetIOS,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { GlassPanel } from "../GlassPanel";
import type { Palette } from "../theme";
import {
  answersOf,
  approvalIsCode,
  approvalNote,
  approvalQuestion,
  asksSecret,
  choose,
  emptyDraft,
  isComplete,
  typeOwn,
} from "./chat-logic";

const MORE: Partial<Record<ApprovalDecision, string>> = {
  session: "Allow for this chat",
  always: "Always allow",
};

/**
 * An agent asking before it acts, in the composer's place (apps/ios's
 * ApprovalCard): what will happen, Deny or Allow once; for the rest of the
 * chat behind "…".
 */
export function ApprovalCard({
  agent,
  approval,
  colors,
  onRespond,
}: {
  agent: string;
  approval: ApprovalRequest;
  colors: Palette;
  onRespond: (decision: ApprovalDecision) => void;
}) {
  const [busy, setBusy] = useState(false);
  const respond = (decision: ApprovalDecision) => {
    setBusy(true);
    onRespond(decision);
  };
  const extra = approval.choices.filter((c) => MORE[c]);
  const note = approvalNote(approval);
  const more = () => {
    const options = [...extra.map((c) => MORE[c]!), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1 },
      (i) => {
        const choice = extra[i];
        if (choice) respond(choice);
      },
    );
  };

  return (
    <Card
      colors={colors}
      icon="hand.raised"
      label="Permissions"
      testID="chat-approval"
      actions={
        <>
          {extra.length > 0 ? (
            <Pressable
              onPress={more}
              hitSlop={8}
              accessibilityLabel="More options"
              testID="chat-approval-more"
              style={styles.more}
            >
              <SymbolView name="ellipsis" size={18} tintColor={colors.secondary} />
            </Pressable>
          ) : null}
          <Pill colors={colors} label="Deny" onPress={() => respond("deny")} disabled={busy} />
          <Pill
            colors={colors}
            label="Allow once"
            prominent
            onPress={() => respond("once")}
            disabled={busy}
          />
        </>
      }
    >
      <Text style={[styles.body, { color: colors.text }]}>{approvalQuestion(agent, approval)}</Text>
      {approval.detail && approvalIsCode(approval) ? (
        <Text
          style={[styles.code, { color: colors.text, backgroundColor: colors.card }]}
          selectable
        >
          {approval.detail}
        </Text>
      ) : null}
      {note ? <Text style={[styles.note, { color: colors.secondary }]}>{note}</Text> : null}
    </Card>
  );
}

/** apps/ios's QuestionCard: the agent's questions, picked from or answered in one's own words. */
export function QuestionCard({
  agent,
  question,
  colors,
  onAnswer,
}: {
  agent: string;
  question: ChatQuestion;
  colors: Palette;
  onAnswer: (answers: Record<string, string[]> | null) => void;
}) {
  const [draft, setDraft] = useState(emptyDraft);
  const secret = asksSecret(question);

  return (
    <Card
      colors={colors}
      icon="questionmark.bubble"
      label={`${agent} asks`}
      testID="chat-question"
      actions={
        <>
          <Pill colors={colors} label="Skip" onPress={() => onAnswer(null)} />
          {!secret ? (
            <Pill
              colors={colors}
              label="Answer"
              prominent
              disabled={!isComplete(question, draft)}
              onPress={() => onAnswer(answersOf(question, draft))}
            />
          ) : null}
        </>
      }
    >
      <ScrollView style={styles.questions} contentContainerStyle={styles.questionsContent}>
        {question.questions.map((item) => (
          <View key={item.id} style={styles.item}>
            <Text style={[styles.body, { color: colors.text }]}>{item.question}</Text>
            {item.secret ? (
              <Text style={[styles.note, { color: colors.secondary }]}>
                This asks for a secret, which only goes through OpenClaw's own app.
              </Text>
            ) : (
              <>
                {item.multiSelect ? (
                  <Text style={[styles.caption, { color: colors.secondary }]}>
                    Choose any that apply.
                  </Text>
                ) : null}
                {item.options.map((option) => {
                  const on = draft.chosen[item.id]?.includes(option.label) === true;
                  const symbol = item.multiSelect
                    ? on
                      ? "checkmark.square.fill"
                      : "square"
                    : on
                      ? "largecircle.fill.circle"
                      : "circle";
                  return (
                    <Pressable
                      key={option.label}
                      onPress={() => {
                        const next = choose(question, draft, item, option.label);
                        if (next.answer) onAnswer(next.answer);
                        else setDraft(next.draft);
                      }}
                      accessibilityRole={item.multiSelect ? "checkbox" : "radio"}
                      accessibilityState={{ checked: on }}
                      style={[styles.option, { backgroundColor: colors.card }]}
                    >
                      <SymbolView
                        name={symbol}
                        size={18}
                        tintColor={on ? colors.accent : colors.secondary}
                      />
                      <View style={styles.optionText}>
                        <Text style={[styles.body, { color: colors.text }]}>{option.label}</Text>
                        {option.description ? (
                          <Text style={[styles.note, { color: colors.secondary }]}>
                            {option.description}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
                <TextInput
                  value={draft.own[item.id] ?? ""}
                  onChangeText={(text) => setDraft((d) => typeOwn(d, item, text))}
                  placeholder="Or answer in your own words"
                  placeholderTextColor={colors.secondary}
                  style={[styles.own, { color: colors.text, backgroundColor: colors.card }]}
                />
              </>
            )}
          </View>
        ))}
      </ScrollView>
    </Card>
  );
}

function Card({
  colors,
  icon,
  label,
  actions,
  children,
  testID,
}: {
  colors: Palette;
  icon: "hand.raised" | "questionmark.bubble";
  label: string;
  actions: ReactNode;
  children: ReactNode;
  testID: string;
}) {
  return (
    <GlassPanel style={styles.card}>
      <View testID={testID} style={styles.cardBody}>
        <View style={styles.label}>
          <SymbolView name={icon} size={13} tintColor={colors.secondary} />
          <Text style={[styles.caption, { color: colors.secondary }]}>{label}</Text>
        </View>
        <View style={styles.content}>{children}</View>
        <View style={styles.actions}>{actions}</View>
      </View>
    </GlassPanel>
  );
}

function Pill({
  colors,
  label,
  prominent,
  disabled,
  onPress,
}: {
  colors: Palette;
  label: string;
  prominent?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`chat-${label.toLowerCase().replace(/\s+/g, "-")}`}
      style={[
        styles.pill,
        { backgroundColor: prominent ? colors.accent : colors.card, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <Text style={[styles.pillText, { color: prominent ? colors.actionText : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 12, marginBottom: 12, borderRadius: 26 },
  cardBody: { padding: 16, gap: 12 },
  label: { flexDirection: "row", alignItems: "center", gap: 6 },
  content: { gap: 6 },
  body: { fontSize: 16, lineHeight: 22 },
  caption: { fontSize: 12 },
  note: { fontSize: 13, lineHeight: 18 },
  code: { fontFamily: "Menlo", fontSize: 13, padding: 8, borderRadius: 10, overflow: "hidden" },
  actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8 },
  more: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  pill: { height: 36, paddingHorizontal: 16, borderRadius: 18, justifyContent: "center" },
  pillText: { fontSize: 15, fontWeight: "600" },
  questions: { maxHeight: 360 },
  questionsContent: { gap: 14 },
  item: { gap: 6 },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  optionText: { flex: 1, gap: 2 },
  own: { fontSize: 15, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
});
