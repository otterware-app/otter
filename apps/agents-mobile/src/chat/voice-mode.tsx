import type { ProviderKind } from "@otter/client/agents/api";
import { isBlank, useChats } from "@otter/client/agents/chat-store";
import {
  callLasted,
  callLevels,
  endCall,
  muteCall,
  soundCall,
  startCall,
  useTalk,
} from "@otter/client/agents/talk";
import { useOtterAccount } from "@otter/client/otter-account";
import { phoneTalkAudio } from "@otter/mobile/talk-audio";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { router } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { create } from "zustand";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import { useChatAgent } from "./chat-agent.ts";
import { useGlow, VoiceGlow, YOUR_BLUE } from "./voice-glow.tsx";

const MIC = 68;
const CONTROL = 48;
/** Two lines of status. */
const STATUS_HEIGHT = 48;
const FOOT_PADDING = 8;
const MIC_GAP = 12;
const ENDED_SHOWN_MS = 4000;

/** How far voice mode's controls reach up from the safe area's foot: the transcript ends above them. */
export const VOICE_FOOT_HEIGHT = FOOT_PADDING + CONTROL + MIC_GAP + MIC + MIC_GAP + STATUS_HEIGHT;
export const VOICE_SWAP = { duration: 260, easing: Easing.out(Easing.cubic) };

/**
 * Voice mode in a chat: open from the tap that starts a call until it's hung up, or, after a call
 * that failed, until its problem is dismissed. The last call's length, for the card after it.
 */
export const useVoice = create<{
  open: { chatId: string; problem: string | null } | null;
  ended: { chatId: string; lasted: number } | null;
}>(() => ({ open: null, ended: null }));

export function startVoice(chatId: string, provider: ProviderKind, sessionId: string | null): void {
  if (!phoneTalkAudio) return;
  endCall();
  useVoice.setState({ open: { chatId, problem: null }, ended: null });
  void startCall(chatId, provider, sessionId, phoneTalkAudio, (problem, liveFor) => {
    const open = useVoice.getState().open;
    if (open?.chatId !== chatId) return;
    useVoice.setState(
      problem
        ? { open: { ...open, problem } }
        : { open: null, ended: liveFor > 0 ? { chatId, lasted: liveFor } : null },
    );
  });
}

/** Leaves voice mode without the card: the chat is going away. */
export function leaveVoice(chatId: string): void {
  if (useVoice.getState().open?.chatId !== chatId) return;
  endCall();
  useVoice.setState({ open: null, ended: null });
}

/** What a blank chat's middle says in a call: that it's connecting, then that it listens. */
export function useVoiceGreeting(chatId: string): string | null {
  const open = useVoice((s) => s.open?.chatId === chatId && !s.open.problem);
  const live = useTalk((s) => s.call?.chatId === chatId && s.call.liveAt !== null);
  const first = useOtterAccount()?.user?.name?.split(" ")[0];
  if (!open) return null;
  if (!live) return "Hold tight, connecting…";
  return first ? `Let's talk, ${first}` : "Let's talk";
}

/**
 * The microphone, as Claude's: a quiet disc that turns blue as you speak, struck through in red
 * while it's off.
 */
function MicButton({
  muted,
  ready,
  you,
  onPress,
}: {
  muted: boolean;
  ready: boolean;
  you: SharedValue<number>;
  onPress: () => void;
}) {
  const theme = useTheme();
  const idle = theme.scheme === "dark" ? "#2f2f2f" : "#ececec";
  const lit = YOUR_BLUE[theme.scheme];
  const fill = useAnimatedStyle(() => ({
    backgroundColor: muted ? idle : interpolateColor(you.get(), [0, 1], [idle, lit]),
  }));
  const white = useAnimatedStyle(() => ({ opacity: muted ? 0 : you.get() }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={muted ? "Unmute" : "Mute"}
      accessibilityState={{ disabled: !ready }}
      disabled={!ready}
      hitSlop={8}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => ({
        opacity: ready ? 1 : 0.45,
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <Animated.View
        style={[styles.mic, { borderColor: alpha(theme.colors.foreground, 0.12) }, fill]}
      >
        {muted ? (
          <Icon name="mic.slash.fill" size={26} weight="medium" color="error" />
        ) : (
          <>
            <Icon name="mic.fill" size={26} weight="medium" />
            <Animated.View style={[styles.lit, white]}>
              <Icon name="mic.fill" size={26} weight="medium" tint="#ffffff" />
            </Animated.View>
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

function RoundButton({
  icon,
  label,
  solid = false,
  disabled = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  solid?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.7 : 1 })}
    >
      {solid ? (
        <View style={[styles.control, { backgroundColor: theme.colors.foreground }]}>
          <Icon name={icon} size={19} weight="semibold" color="canvas" />
        </View>
      ) : (
        <Glass shape="circle" interactive style={styles.control}>
          <Icon name={icon} size={19} weight="medium" />
        </Glass>
      )}
    </Pressable>
  );
}

/**
 * Voice mode, Claude's: the chat stays on screen and the call takes the composer's place, with
 * the microphone above the sound and end buttons. Light shows who is talking (the agent's orange
 * along the display's edge, your blue rising from the foot). What's said streams into the
 * transcript above, so the foot doesn't repeat it: it only says when the call is connecting or failed.
 */
export function VoiceMode({ chatId }: { chatId: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const open = useVoice((s) => (s.open?.chatId === chatId ? s.open : null));
  const call = useTalk((s) => (s.call?.chatId === chatId ? s.call : null));
  const working = useChats((s) => Boolean(s.runs[chatId]));
  const convo = useChats((s) => s.conversations.find((c) => c.id === chatId));
  const live = call?.liveAt != null;
  const active = call !== null;

  const you = useSharedValue(0);
  const agent = useSharedValue(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const levels = callLevels();
      you.set(levels.you);
      agent.set(levels.agent);
    }, 90);
    return () => {
      clearInterval(timer);
      you.set(0);
      agent.set(0);
    };
  }, [active, you, agent]);
  const agentGlow = useGlow(agent);
  const youGlow = useGlow(you);

  useEffect(() => {
    if (live) haptics.impact();
  }, [live]);
  useEffect(() => {
    if (live && working) haptics.tap();
  }, [live, working]);

  const problem = open?.problem ?? null;
  const muted = call?.muted ?? false;
  const sound = call?.sound ?? true;
  const status = problem ? problem : !live && convo && !isBlank(convo) ? "Connecting…" : null;

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(180)}
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
    >
      <FootFade height={insets.bottom + VOICE_FOOT_HEIGHT + FADE} color={theme.colors.canvas} />
      <VoiceGlow agent={agentGlow} you={youGlow} working={working} />
      {muted && !problem ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(160)}
          pointerEvents="none"
          style={[styles.notice, { top: headerHeight + 12 }]}
        >
          <Text size="body" color="error">
            Microphone off
          </Text>
        </Animated.View>
      ) : null}
      <View
        pointerEvents="box-none"
        style={[styles.foot, { paddingBottom: insets.bottom + FOOT_PADDING }]}
      >
        <View style={styles.status} pointerEvents="none">
          {status ? (
            <Animated.View key="status" entering={FadeIn.duration(180)}>
              <Text
                size="base"
                color={problem ? "error" : "mutedForeground"}
                accessibilityRole={problem ? "alert" : undefined}
                numberOfLines={2}
                style={styles.statusText}
              >
                {status}
              </Text>
            </Animated.View>
          ) : null}
        </View>
        <View style={styles.micRow}>
          <MicButton muted={muted} ready={live} you={youGlow} onPress={() => muteCall(!muted)} />
        </View>
        <View style={styles.controls}>
          <ModelChip chatId={chatId} />
          <View style={{ flex: 1 }} />
          <RoundButton
            icon={sound ? "speaker.wave.2.fill" : "speaker.slash.fill"}
            label={sound ? "Turn the sound off" : "Turn the sound on"}
            disabled={!live}
            onPress={() => soundCall(!sound)}
          />
          <RoundButton
            icon="xmark"
            solid
            label={problem ? "Close" : "End call"}
            onPress={() => {
              if (call) endCall();
              else useVoice.setState({ open: null });
            }}
          />
        </View>
      </View>
    </Animated.View>
  );
}

/** Who answers and on what model, as Claude's call keeps it at hand: tap to choose another. */
function ModelChip({ chatId }: { chatId: string }) {
  const agent = useChatAgent(chatId);
  if (!agent.usable) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Model"
      hitSlop={6}
      onPress={() => {
        haptics.tap();
        router.push({ pathname: "/agents/[id]/model", params: { id: chatId } });
      }}
    >
      <Glass interactive style={styles.chip}>
        <AgentAvatar agent={agent.id} gatewayAgent={agent.gatewayAgent} size={20} />
        <Icon name="chevron.up.chevron.down" size={9} weight="semibold" color="mutedForeground" />
      </Glass>
    </Pressable>
  );
}

/** How far above the controls the transcript fades out: the status is on a solid ground. */
const FADE = 64;

/** The transcript fades out under the controls. */
function FootFade({ height, color }: { height: number; color: string }) {
  return (
    <View pointerEvents="none" style={[styles.fade, { height }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset={FADE / height} stopColor={color} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#fade)" />
      </Svg>
    </View>
  );
}

/** After a call, as Claude's: that it ended, and how long it lasted. */
export function VoiceEnded({ chatId }: { chatId: string }) {
  const theme = useTheme();
  const ended = useVoice((s) => (s.ended?.chatId === chatId ? s.ended : null));
  const agent = useChatAgent(chatId);
  useEffect(() => {
    if (!ended) return;
    const timer = setTimeout(() => useVoice.setState({ ended: null }), ENDED_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [ended]);
  if (!ended) return null;
  return (
    <Animated.View
      entering={FadeInDown.duration(240).easing(Easing.out(Easing.cubic))}
      exiting={FadeOut.duration(200)}
      pointerEvents="none"
      style={styles.ended}
    >
      <Glass
        shape={{ radius: 18 }}
        style={[styles.endedCard, { shadowColor: theme.colors.foreground }]}
      >
        <AgentAvatar agent={agent.id} gatewayAgent={agent.gatewayAgent} size={18} />
        <View>
          <Text size="md" weight="medium">
            Call ended
          </Text>
          <Text size="body" color="mutedForeground">
            {callLasted(ended.lasted)}
          </Text>
        </View>
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fade: { position: "absolute", left: 0, right: 0, bottom: 0 },
  notice: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  foot: { position: "absolute", left: 0, right: 0, bottom: 0 },
  status: {
    height: STATUS_HEIGHT,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  statusText: { textAlign: "center" },
  micRow: { alignItems: "center", paddingVertical: MIC_GAP },
  mic: {
    width: MIC,
    height: MIC,
    borderRadius: MIC / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  lit: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" },
  controls: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  control: {
    width: CONTROL,
    height: CONTROL,
    borderRadius: CONTROL / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    height: CONTROL,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 14,
    paddingRight: 16,
  },
  ended: { alignItems: "center", paddingBottom: 10 },
  endedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
});
