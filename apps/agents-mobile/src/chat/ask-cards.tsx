import type { ApprovalRequest, ChatQuestion } from "@otter/client/agents/api";
import {
  approvalFiles,
  approvalMore,
  approvalQuestion,
  approvalShowsCode,
} from "@otter/client/agents/approvals";
import { answerQuestion, respondApproval, stopRun } from "@otter/client/agents/chat-store";
import { useQuestionAnswers } from "@otter/client/agents/question";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon } from "@otter/ui-native/components/icon";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { alpha, typeStyle, useTheme } from "@otter/ui-native/theme";
import type { ReactNode } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";

type Tone = "primary" | "secondary" | "danger";

/** AskCards.swift's `Pill`: a capsule answer. */
function Pill({
  label,
  tone = "secondary",
  wide = false,
  disabled = false,
  onPress,
}: {
  label: string;
  tone?: Tone;
  wide?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { fill, text } = {
    primary: { fill: theme.colors.primary, text: "primaryForeground" as const },
    secondary: { fill: alpha(theme.colors.foreground, 0.08), text: "foreground" as const },
    danger: { fill: theme.colors.errorSurface, text: "error" as const },
  }[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 42,
        paddingHorizontal: 20,
        borderRadius: theme.radius.pill,
        backgroundColor: fill,
        alignItems: "center",
        justifyContent: "center",
        alignSelf: wide ? "stretch" : "flex-start",
        opacity: pressed ? 0.7 : disabled ? 0.4 : 1,
      })}
    >
      <Text size="md" weight="semibold" color={text}>
        {label}
      </Text>
    </Pressable>
  );
}

/** What the agent asks, in the composer's place: a caption, and "1 of 3" when more wait. */
function AskCard({
  caption,
  count,
  children,
}: {
  caption: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Glass
      shape={{ radius: 20 }}
      style={{ padding: 16, gap: 10, marginHorizontal: 12, marginVertical: 6 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text
          size="xs"
          weight="bold"
          color="mutedForeground"
          style={{ flex: 1, letterSpacing: 1.1 }}
        >
          {caption.toUpperCase()}
        </Text>
        {count > 1 ? (
          <Text size="xs" weight="medium" color="mutedForeground" tabular>
            1 of {count}
          </Text>
        ) : null}
      </View>
      {children}
    </Glass>
  );
}

/** An agent asking before it acts (AskCards.swift's `ApprovalCard`): what it wants to do, exactly, and the answers it takes. */
export function ApprovalCard({
  chatId,
  agent,
  approval,
  count,
}: {
  chatId: string;
  agent: string;
  approval: ApprovalRequest;
  count: number;
}) {
  const theme = useTheme();
  const files = approvalFiles(approval);
  const more = approvalMore(approval).flatMap(({ label, decision }) =>
    decision === "stop" ? [] : [{ label, decision }],
  );
  const respond = (decision: Parameters<typeof respondApproval>[1]) => {
    haptics.tap();
    void respondApproval(approval.id, decision);
  };
  const box = {
    padding: 10,
    borderRadius: 10,
    backgroundColor: alpha(theme.colors.foreground, 0.06),
  };
  return (
    <AskCard caption="Approval needed" count={count}>
      <Text size="lg" weight="semibold" accessibilityRole="header">
        {approvalQuestion(agent, approval)}
      </Text>
      {approvalShowsCode(approval) ? (
        <ScrollView style={[box, { maxHeight: 140 }]} contentContainerStyle={{ flexGrow: 0 }}>
          <Text
            selectable
            size="body"
            style={{ fontFamily: theme.fonts.mono }}
            accessibilityLabel={approval.detail}
          >
            {approval.detail}
          </Text>
        </ScrollView>
      ) : null}
      {files.length > 0 ? (
        <ScrollView style={[box, { maxHeight: 140 }]}>
          {files.map((path) => (
            <View
              key={path}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 }}
            >
              <Icon name="doc" size={13} color="infoForeground" />
              <Text size="body" color="infoForeground" numberOfLines={1} style={{ flex: 1 }}>
                {path}
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {approval.kind === "tool" && approval.detail ? (
        <Text size="sm" color="mutedForeground" numberOfLines={6}>
          {approval.detail}
        </Text>
      ) : null}
      {approval.reason ? (
        <Text size="sm" color="warning">
          {approval.reason}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 }}>
        <Pill label="Allow once" tone="primary" onPress={() => respond("once")} />
        {more.map((m) => (
          <Pill key={m.decision} label={m.label} onPress={() => respond(m.decision)} />
        ))}
        <Pill label="Deny" tone="danger" onPress={() => respond("deny")} />
        <Pill label="Stop the agent" onPress={() => stopRun(chatId)} />
      </View>
    </AskCard>
  );
}

/** One or several questions, their choices and words of your own (AskCards.swift's `QuestionCard`). */
export function QuestionCard({
  agent,
  question,
  count,
}: {
  agent: string;
  question: ChatQuestion;
  count: number;
}) {
  const theme = useTheme();
  const answer = (answers: Record<string, string[]> | null) =>
    void answerQuestion(question.id, answers);
  const form = useQuestionAnswers(question, answer);
  return (
    <AskCard caption={`${agent} asks`} count={count}>
      <ScrollView
        style={{ maxHeight: 340 }}
        contentContainerStyle={{ gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {question.questions.map((item) => (
          <View key={item.id} style={{ gap: 8 }}>
            {item.header ? (
              <Text size="body" weight="bold" color="mutedForeground">
                {item.header.toUpperCase()}
              </Text>
            ) : null}
            <Text size="base">{item.question}</Text>
            {item.secret ? (
              <Text size="sm" color="mutedForeground">
                This asks for a secret, which only goes through {agent}'s own app.
              </Text>
            ) : (
              <>
                {item.multiSelect ? (
                  <Text size="body" color="mutedForeground">
                    Choose any that apply.
                  </Text>
                ) : null}
                {item.options.map((option) => {
                  const on = form.isChosen(item.id, option.label);
                  return (
                    <Pressable
                      key={option.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      onPress={() => {
                        haptics.tap();
                        form.choose(item.id, option.label, item.multiSelect);
                      }}
                      style={{
                        minHeight: 44,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        gap: 2,
                        justifyContent: "center",
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: on ? theme.colors.ring : theme.colors.border,
                        backgroundColor: on
                          ? alpha(theme.colors.ring, 0.12)
                          : alpha(theme.colors.foreground, 0.04),
                      }}
                    >
                      <Text size="sm" weight="semibold">
                        {option.label}
                      </Text>
                      {option.description ? (
                        <Text size="sm" color="mutedForeground">
                          {option.description}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
                <TextInput
                  value={form.own[item.id] ?? ""}
                  onChangeText={(text) => form.type(item.id, text, item.multiSelect)}
                  placeholder="Or answer in your own words"
                  placeholderTextColor={theme.colors.mutedForeground}
                  accessibilityLabel="Or answer in your own words"
                  multiline
                  selectionColor={theme.colors.ring}
                  style={[
                    typeStyle(theme, "md"),
                    {
                      color: theme.colors.foreground,
                      maxHeight: 92,
                      paddingHorizontal: 14,
                      paddingTop: 11,
                      paddingBottom: 11,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: alpha(theme.colors.foreground, 0.04),
                    },
                  ]}
                />
              </>
            )}
          </View>
        ))}
      </ScrollView>
      {form.secret ? null : (
        <Pill
          label="Answer"
          tone={form.complete ? "primary" : "secondary"}
          wide
          disabled={!form.complete}
          onPress={() => answer(form.answers)}
        />
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => answer(null)}
        style={{ minHeight: 30, alignItems: "center", justifyContent: "center" }}
      >
        <Text size="sm" weight="medium" color="mutedForeground">
          Skip
        </Text>
      </Pressable>
    </AskCard>
  );
}
