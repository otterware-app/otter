import type { Skill } from "@otter/client/agents/api";
import {
  attachmentDetail,
  useChatAttachments,
  type DraftAttachment,
} from "@otter/client/agents/chat-attachments";
import type { Citation } from "@otter/client/agents/chat-cite";
import { detachMail, useChatMail, type AttachedMail } from "@otter/client/agents/chat-mail";
import { useFollowUpBehavior, type FollowUpBehavior } from "@otter/client/agents/chat-queue";
import {
  cancelQueuedEdit,
  sendMessage,
  setCitations,
  setDraft,
  stopRun,
  updateQueued,
  useChats,
} from "@otter/client/agents/chat-store";
import {
  composeOutgoing,
  composerControls,
  composerHasContent,
  runCompacting,
  skillCommand,
  slashQuery,
  slashSkills,
  submitLabel,
  submitMode,
  useSkills,
} from "@otter/client/agents/composer";
import { host } from "@otter/client/host";
import { phoneTalkAudio } from "@otter/mobile/talk-audio";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { alpha, typeStyle, useTheme } from "@otter/ui-native/theme";
import { Button as MenuButton, Host, Menu, RNHostView } from "@expo/ui/swift-ui";
import { accessibilityLabel, disabled } from "@expo/ui/swift-ui/modifiers";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { router } from "expo-router";
import {
  use,
  useEffect,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
  type RefObject,
} from "react";
import { Keyboard, Pressable, ScrollView, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import {
  pastedImage,
  cameraAvailable,
  phoneFiles,
  pickDocuments,
  pickPhotos,
  takePhoto,
  type PhoneFile,
} from "./attachment-files.ts";
import { useChatAgent } from "./chat-agent.ts";
import { startVoice } from "./voice-mode.tsx";
import { ComposerPanelContext } from "./composer-panel.ts";

const NO_CITATIONS: Citation[] = [];
const LINE = 22;
const COMPOSER_GAP = 7;
const SIZE = 46;

/** Composer.swift: ＋ for what a message can carry (its panel takes the keyboard's place), the text in its pill with the agent beside it, and Send. */
export function Composer({
  chatId,
  input,
}: {
  chatId: string;
  input: RefObject<ComponentRef<typeof TextInput> | null>;
}) {
  const theme = useTheme();
  const agent = useChatAgent(chatId);
  const agentId = agent.id ?? "";
  const draft = useChats((s) => s.drafts[chatId] ?? "");
  const citations = useChats((s) => s.citations[chatId]) ?? NO_CITATIONS;
  const running = useChats((s) => Boolean(s.runs[chatId]));
  const compacting = useChats((s) => runCompacting(s, chatId));
  const editing = useChats((s) => (s.editingQueued?.convoId === chatId ? s.editingQueued : null));
  const mail = useChatMail(chatId);
  const followUp = useFollowUpBehavior();
  const files = useChatAttachments(phoneFiles);
  const skills = useSkills(agentId, agent.usable).data ?? [];
  const [skill, setSkill] = useState<Skill | null>(null);
  const { open: panel, setHeight: setPanelHeight, setOpen: setPanel } = use(ComposerPanelContext);
  const [canPaste, setCanPaste] = useState(false);
  const panelFocus = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A new chat opens ready to type; one with a conversation doesn't take the keyboard.
  const [opensBlank] = useState(agent.blank && agent.convo?.loaded);

  // A queued message left in the composer would stay held: give it back on leaving the chat.
  useEffect(() => () => cancelQueuedEdit(chatId), [chatId]);
  useEffect(() => {
    if (panel) return () => clearTimeout(panelFocus.current);
  }, [panel]);

  const controls = composerControls(agent.provider, agent.traits);
  const choosesModel =
    agent.blank ||
    (!agent.traits?.subAgents &&
      (controls.pickModels || controls.traitOptions.length > 0 || controls.runtimeMode !== null));
  const hasContent =
    composerHasContent({ draft, skill, files: files.count, citations: citations.length }) ||
    mail !== null;
  const steers = Boolean(agent.traits) && files.count === 0 && !compacting;
  const mode = submitMode({ running, compacting: !steers, followUp, alternate: false });
  const matching = skill ? [] : slashSkills(skills, slashQuery(draft));
  const carries = Boolean(skill || files.count > 0 || citations.length > 0 || mail || editing);
  const canTalk = phoneTalkAudio && agent.usable && agent.convo?.loaded && agent.provider?.talk;

  const type = (value: string) => {
    const command = skill ? null : skillCommand(value, skills);
    if (command) setSkill(command.skill);
    setDraft(chatId, command ? command.rest : value);
  };

  const send = (behavior: FollowUpBehavior) => {
    if (!hasContent) return;
    haptics.tap();
    if (editing) {
      const text = draft.trim();
      if (!text) return;
      updateQueued(editing.id, text);
      cancelQueuedEdit();
      return;
    }
    // A chat's turns load first: sending before would start it over.
    if (!agent.usable || !agent.convo?.loaded) return;
    if (files.staging) {
      host().notice({ tone: "info", title: "Attachments are still being added" });
      return;
    }
    const { staged, sent } = files.take();
    const msg = composeOutgoing({
      convoId: chatId,
      agentId,
      draft,
      skill,
      citations,
      staged,
      sent,
      attached: mail,
      mailReader: agent.traits?.mailReader,
    });
    setDraft(chatId, "");
    setSkill(null);
    setCitations(chatId, () => []);
    detachMail(chatId);
    setPanel(false);
    Keyboard.dismiss();
    sendMessage(msg, behavior);
  };

  const attach = (pick: () => Promise<PhoneFile[]>) => async () => {
    try {
      await files.add(await pick());
    } catch (error) {
      host().notice({
        tone: "error",
        title: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const togglePanel = () => {
    haptics.tap();
    // The keyboard comes up over the panel; the panel leaves once it's there.
    if (panel) return input.current?.focus();
    void Clipboard.hasImageAsync().then(setCanPaste, () => setCanPaste(false));
    setPanel(true);
  };

  const showModels = () => {
    setPanel(false);
    Keyboard.dismiss();
    router.push({ pathname: "/agents/[id]/model", params: { id: chatId } });
  };

  return (
    <View style={{ paddingHorizontal: 10, paddingTop: 6, paddingBottom: 6, gap: COMPOSER_GAP }}>
      {matching.length > 0 ? (
        <SkillMenu
          skills={matching}
          onPick={(picked) => {
            setSkill(picked);
            setDraft(chatId, "");
          }}
        />
      ) : null}
      {carries ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)}>
          <Glass shape={{ radius: 20 }} style={{ padding: 10, gap: 8 }}>
            {editing ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon name="pencil" size={13} color="mutedForeground" />
                <Text size="body" weight="medium" color="mutedForeground" style={{ flex: 1 }}>
                  Editing a queued message
                </Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={10}
                  onPress={() => cancelQueuedEdit()}
                >
                  <Text size="body" weight="semibold">
                    Cancel
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {citations.map((quote) => (
              <View key={quote.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <QuotedReply text={quote.text} from={quote.source ?? agent.label} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove reply"
                  onPress={() =>
                    setCitations(chatId, (list) => list.filter((c) => c.id !== quote.id))
                  }
                  style={{
                    width: 32,
                    height: 32,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name="xmark" size={15} weight="medium" color="mutedForeground" />
                </Pressable>
              </View>
            ))}
            {files.count > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 9 }}
              >
                {files.items.map((item) => (
                  <AttachmentTile
                    key={item.key}
                    item={item}
                    onRemove={() => files.remove(item.key)}
                  />
                ))}
              </ScrollView>
            ) : null}
            {mail || skill ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6 }}
              >
                {mail ? (
                  <Chip
                    icon={mailIcon(mail)}
                    text={mail.name}
                    onRemove={() => detachMail(chatId)}
                  />
                ) : null}
                {skill ? (
                  <Chip
                    icon="wrench.and.screwdriver"
                    text={`/${skill.name}`}
                    mono
                    onRemove={() => setSkill(null)}
                  />
                ) : null}
              </ScrollView>
            ) : null}
          </Glass>
        </Animated.View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={panel ? "Show keyboard" : "Attach and more"}
          onPress={togglePanel}
        >
          <Glass
            shape="circle"
            interactive
            style={{ width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name={panel ? "keyboard" : "plus"} size={panel ? 17 : 20} />
          </Glass>
        </Pressable>
        <Glass
          shape={{ radius: 23 }}
          interactive
          style={{ flex: 1, minHeight: SIZE, flexDirection: "row", alignItems: "flex-end" }}
        >
          <TextInput
            ref={input}
            autoFocus={opensBlank}
            value={draft}
            onChangeText={type}
            onFocus={() => {
              // No keyboard comes (a hardware one): the panel goes anyway.
              if (panel)
                panelFocus.current = setTimeout(() => {
                  if (input.current?.isFocused() && !Keyboard.isVisible()) setPanel(false);
                }, 600);
            }}
            onBlur={() => clearTimeout(panelFocus.current)}
            onKeyPress={(e) => {
              if (e.nativeEvent.key === "Backspace" && draft === "" && skill) setSkill(null);
            }}
            placeholder="Message"
            placeholderTextColor={theme.colors.mutedForeground}
            accessibilityLabel="Message"
            multiline
            selectionColor={theme.colors.ring}
            style={[
              typeStyle(theme, "base"),
              {
                flex: 1,
                color: theme.colors.foreground,
                lineHeight: LINE,
                maxHeight: LINE * 6 + 24,
                paddingLeft: 16,
                paddingTop: 12,
                paddingBottom: 12,
              },
            ]}
          />
          {choosesModel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={agent.blank ? "Agent and model" : "Model"}
              onPress={showModels}
              style={{
                minHeight: SIZE,
                paddingLeft: 6,
                paddingRight: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
              }}
            >
              <AgentAvatar agent={agent.id} gatewayAgent={agent.gatewayAgent} size={18} />
              <Icon
                name="chevron.up.chevron.down"
                size={9}
                weight="semibold"
                color="mutedForeground"
              />
            </Pressable>
          ) : (
            <View style={{ width: 12, height: SIZE }} />
          )}
        </Glass>
        {running && !hasContent && !editing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop agent"
            onPress={() => stopRun(chatId)}
          >
            <Circle icon="stop.fill" iconSize={14} fill={theme.colors.errorSurface} color="error" />
          </Pressable>
        ) : canTalk && !running && !hasContent && !editing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Talk with ${agent.label}`}
            onPress={() => {
              haptics.tap();
              setPanel(false);
              Keyboard.dismiss();
              if (agent.id) startVoice(chatId, agent.id, agent.convo?.sessionId ?? null);
            }}
          >
            <Circle icon="waveform" fill={theme.colors.primary} />
          </Pressable>
        ) : (
          <SendButton
            icon={
              editing
                ? "checkmark"
                : running
                  ? mode === "steer"
                    ? "arrow.turn.left.up"
                    : "list.number"
                  : "arrow.up"
            }
            label={submitLabel(mode, Boolean(editing))}
            enabled={hasContent}
            menu={running && !editing && steers}
            onSend={send}
            followUp={followUp}
          />
        )}
      </View>
      {panel ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          onLayout={(event) => setPanelHeight(event.nativeEvent.layout.height + COMPOSER_GAP)}
        >
          <Glass
            shape={{ radius: 32 }}
            style={{ position: "absolute", top: 1, left: 6, right: 6, bottom: 0 }}
          />
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              paddingHorizontal: 18,
              paddingVertical: 14,
              rowGap: 14,
            }}
          >
            {agent.usable ? (
              <>
                <Tile
                  title="Photos"
                  icon="photo.on.rectangle.angled"
                  tint={theme.colors.primary}
                  onPress={attach(() => pickPhotos(10 - files.count))}
                />
                {cameraAvailable ? (
                  <Tile
                    title="Camera"
                    icon="camera.fill"
                    tint={theme.colors.foreground}
                    onPress={attach(takePhoto)}
                  />
                ) : null}
                <Tile
                  title="Document"
                  icon="doc.fill"
                  tint={theme.colors.infoForeground}
                  onPress={attach(pickDocuments)}
                />
                {canPaste ? (
                  <Tile
                    title="Paste"
                    icon="doc.on.clipboard.fill"
                    tint={theme.colors.questionForeground}
                    onPress={attach(pastedImage)}
                  />
                ) : null}
              </>
            ) : null}
            {skills.length > 0 && draft === "" ? (
              <Tile
                title="Skills"
                icon="wand.and.sparkles"
                tint={theme.colors.warning}
                onPress={() => {
                  setDraft(chatId, "/");
                  input.current?.focus();
                }}
              />
            ) : null}
            {choosesModel ? (
              <Tile
                title={agent.blank ? "Agent" : "Model"}
                icon={agent.blank ? "person.crop.circle.fill" : "cpu"}
                tint={theme.colors.primary}
                onPress={showModels}
              />
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const mailIcon = (mail: AttachedMail): IconName =>
  mail.kind === "quote" ? "text.quote" : mail.kind === "draft" ? "square.and.pencil" : "envelope";

function Circle({
  icon,
  iconSize = 18,
  fill,
  color = "primaryForeground",
  dim = false,
}: {
  icon: IconName;
  iconSize?: number;
  fill: string;
  color?: "primaryForeground" | "error";
  dim?: boolean;
}) {
  return (
    <View
      style={{
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE / 2,
        backgroundColor: fill,
        alignItems: "center",
        justifyContent: "center",
        opacity: dim ? 0.45 : 1,
      }}
    >
      <Icon name={icon} size={iconSize} weight="semibold" color={color} />
    </View>
  );
}

/** Send; while the agent works, a hold offers queueing or steering this one message (the system's menu, from where the button is). */
function SendButton({
  icon,
  label,
  enabled,
  menu,
  followUp,
  onSend,
}: {
  icon: IconName;
  label: string;
  enabled: boolean;
  menu: boolean;
  followUp: FollowUpBehavior;
  onSend: (behavior: FollowUpBehavior) => void;
}) {
  const theme = useTheme();
  const circle = <Circle icon={icon} fill={theme.colors.primary} dim={!enabled} />;
  if (!menu)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !enabled }}
        disabled={!enabled}
        onPress={() => onSend(followUp)}
      >
        {circle}
      </Pressable>
    );
  return (
    <Host matchContents style={{ width: SIZE, height: SIZE }}>
      <Menu
        label={
          <RNHostView matchContents>
            <View>{circle}</View>
          </RNHostView>
        }
        onPrimaryAction={() => onSend(followUp)}
        modifiers={[accessibilityLabel(label), disabled(!enabled)]}
      >
        <MenuButton label="Queue" systemImage="list.number" onPress={() => onSend("queue")} />
        <MenuButton
          label="Steer now"
          systemImage="arrow.turn.left.up"
          onPress={() => onSend("steer")}
        />
      </Menu>
    </Host>
  );
}

function Tile({
  title,
  icon,
  tint,
  onPress,
}: {
  title: string;
  icon: IconName;
  tint: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={{ width: "25%", alignItems: "center", gap: 7 }}
    >
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 30,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: alpha(theme.colors.primary, theme.scheme === "dark" ? 0.38 : 0.16),
          borderWidth: 0.5,
          borderColor: alpha(theme.colors.border, 0.7),
        }}
      >
        <Icon name={icon} size={24} tint={tint} />
      </View>
      <Text size="body">{title}</Text>
    </Pressable>
  );
}

/** A message quoted in what you send: the accent's bar, who said it, and the start of it (Transcript.swift's `QuotedReply`). */
function QuotedReply({ text, from }: { text: string; from: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 8,
        overflow: "hidden",
        backgroundColor: alpha(theme.colors.foreground, 0.06),
        borderLeftWidth: 4,
        borderLeftColor: theme.colors.primary,
        paddingLeft: 10,
        paddingRight: 8,
        paddingVertical: 6,
        gap: 2,
      }}
    >
      <Text size="body" weight="semibold" color="primary">
        {from}
      </Text>
      <Text size="sm" color="mutedForeground" numberOfLines={2}>
        {text.replaceAll("\n", " ")}
      </Text>
    </View>
  );
}

function Chip({
  icon,
  text,
  mono = false,
  onRemove,
}: {
  icon: IconName;
  text: string;
  mono?: boolean;
  onRemove: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 30,
        maxWidth: 240,
        paddingLeft: 10,
        paddingRight: 4,
        gap: 6,
        flexDirection: "row",
        alignItems: "center",
        borderRadius: theme.radius.pill,
        backgroundColor: alpha(theme.colors.foreground, 0.07),
      }}
    >
      <Icon name={icon} size={12} color="mutedForeground" />
      <Text
        size="body"
        weight={mono ? "medium" : "regular"}
        numberOfLines={1}
        style={[{ flexShrink: 1 }, mono && { fontFamily: theme.fonts.mono }]}
      >
        {text.replaceAll("\n", " ")}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Remove"
        onPress={onRemove}
        hitSlop={8}
        style={{ width: 20, height: 24, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="xmark" size={9} weight="bold" color="mutedForeground" />
      </Pressable>
    </View>
  );
}

function AttachmentTile({ item, onRemove }: { item: DraftAttachment; onRemove: () => void }) {
  const theme = useTheme();
  const black = theme.scheme === "dark" ? theme.colors.canvas : theme.colors.foreground;
  const white = theme.scheme === "dark" ? theme.colors.foreground : theme.colors.canvas;
  let body: ReactNode;
  if (item.previewUrl) {
    body = <Image source={{ uri: item.previewUrl }} contentFit="cover" style={{ flex: 1 }} />;
  } else {
    body = (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          backgroundColor: alpha(theme.colors.foreground, 0.07),
        }}
      >
        <Icon name="doc" size={20} color="mutedForeground" />
        <Text size="2xs" numberOfLines={1} style={{ paddingHorizontal: 6 }}>
          {item.name}
        </Text>
      </View>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={`${item.name}, ${attachmentDetail(item)}`}
      style={{
        width: 72,
        height: 72,
        borderRadius: 16,
        overflow: "hidden",
        borderCurve: "continuous",
      }}
    >
      {body}
      {item.staged ? null : (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: alpha(black, 0.25),
          }}
        >
          <Spinner />
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.name}`}
        onPress={onRemove}
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          width: 22,
          height: 22,
          borderRadius: 11,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: alpha(black, 0.55),
        }}
      >
        <Icon name="xmark" size={9} weight="bold" tint={white} />
      </Pressable>
    </View>
  );
}

function SkillMenu({ skills, onPick }: { skills: Skill[]; onPick: (skill: Skill) => void }) {
  return (
    <Glass shape={{ radius: 16 }}>
      <Text
        size="2xs"
        weight="bold"
        color="mutedForeground"
        style={{ letterSpacing: 0.8, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 }}
      >
        SKILLS
      </Text>
      <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="always">
        {skills.map((s) => (
          <Pressable
            key={s.name}
            accessibilityRole="button"
            onPress={() => onPick(s)}
            style={{ paddingHorizontal: 14, paddingVertical: 9, gap: 1 }}
          >
            <Text size="base" weight="medium">
              /{s.name}
            </Text>
            {s.description ? (
              <Text size="body" color="mutedForeground" numberOfLines={1}>
                {s.description}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </Glass>
  );
}
