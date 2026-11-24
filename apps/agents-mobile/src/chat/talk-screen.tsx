import { useChats } from "@otter/client/agents/chat-store";
import {
  callLevel,
  callStatus,
  callTime,
  endCall,
  muteCall,
  startCall,
  useTalk,
  useWorkingCue,
} from "@otter/client/agents/talk";
import { phoneTalkAudio } from "@otter/mobile/talk-audio";
import { useReduceMotion } from "@otter/ui-native/accessibility";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon } from "@otter/ui-native/components/icon";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { useChatAgent } from "./chat-agent.ts";

export function TalkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TalkConversation key={id} chatId={id} />;
}

function dismiss(chatId: string): void {
  if (router.canGoBack()) router.back();
  else router.replace({ pathname: "/agents/[id]", params: { id: chatId } });
}

function TalkConversation({ chatId }: { chatId: string }) {
  const theme = useTheme();
  const agent = useChatAgent(chatId);
  const call = useTalk((s) => (s.call?.chatId === chatId ? s.call : null));
  const working = useChats((s) => Boolean(s.runs[chatId]));
  const [target] = useState(() =>
    phoneTalkAudio && agent.usable && agent.id && agent.convo?.loaded && agent.provider?.talk
      ? { provider: agent.id, sessionId: agent.convo.sessionId ?? null }
      : null,
  );
  const [enteredAt] = useState(Date.now);
  const [error, setError] = useState(target ? null : "Talk is unavailable for this agent.");
  const [speaking, setSpeaking] = useState(false);
  const liveAt = call?.liveAt;
  const muted = call?.muted ?? false;
  useWorkingCue(working, liveAt != null);

  useEffect(() => {
    if (!target || !phoneTalkAudio) return;
    let shown = true;
    void startCall(chatId, target.provider, target.sessionId, phoneTalkAudio, (message) => {
      if (!shown) return;
      if (message) setError(message);
      else dismiss(chatId);
    });
    const id = useTalk.getState().call?.id;
    return () => {
      shown = false;
      if (id && useTalk.getState().call?.id === id) endCall();
    };
  }, [chatId, target]);

  useEffect(() => {
    if (liveAt != null) haptics.tap();
  }, [liveAt]);

  const status = error
    ? "Ended"
    : call
      ? callStatus(call, { name: agent.label, speaking, working })
      : "Connecting…";
  const said = agent.convo?.turns.findLast(
    (turn) => turn.spoken && (turn.startedAt ?? 0) >= enteredAt,
  );
  const caption =
    said?.role === "user"
      ? said.text
      : said?.items?.map((item) => (item.kind === "text" ? item.text : "")).join("");
  const title = (agent.blank ? agent.label : agent.convo?.title) || "Talk";

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.colors.canvas }]}>
      <View style={styles.header}>
        <Text size="lg" weight="semibold" accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {liveAt != null ? <CallTime since={liveAt} /> : null}
      </View>
      <View style={styles.center}>
        <TalkOrb
          active={Boolean(call)}
          live={liveAt != null}
          muted={muted}
          speaking={speaking}
          working={working}
          onSpeaking={setSpeaking}
        />
        <View style={styles.caption}>
          {error || caption ? (
            <Text
              size="lg"
              color={error ? "error" : said?.role === "user" ? "mutedForeground" : "foreground"}
              accessibilityRole={error ? "alert" : undefined}
              numberOfLines={4}
              style={{ textAlign: "center" }}
            >
              {error || caption?.trim()}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.controls}>
        <Glass style={styles.status}>
          <Icon name="waveform" size={15} weight="semibold" color="primary" />
          <Text style={{ flexShrink: 1 }} numberOfLines={1}>
            {status}
          </Text>
        </Glass>
        {call ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={muted ? "Unmute" : "Mute"}
            onPress={() => {
              haptics.tap();
              muteCall(!muted);
            }}
          >
            <Glass shape="circle" interactive style={styles.button}>
              <Icon
                name={muted ? "mic.slash.fill" : "mic.fill"}
                size={20}
                weight="medium"
                color={muted ? "error" : "foreground"}
              />
            </Glass>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={error ? "Close Talk" : "End call"}
          onPress={() => {
            haptics.tap();
            if (call) endCall();
            else dismiss(chatId);
          }}
          style={[styles.button, { backgroundColor: theme.colors.foreground }]}
        >
          <Icon name="xmark" size={20} weight="semibold" color="canvas" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function CallTime({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Text size="body" color="mutedForeground" style={{ fontVariant: ["tabular-nums"] }}>
      {callTime(since, now)}
    </Text>
  );
}

function TalkOrb({
  active,
  live,
  muted,
  speaking,
  working,
  onSpeaking,
}: {
  active: boolean;
  live: boolean;
  muted: boolean;
  speaking: boolean;
  working: boolean;
  onSpeaking: (speaking: boolean) => void;
}) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const size = Math.min(236, width * 0.62, height * 0.4);
  const reduceMotion = useReduceMotion();
  const lastSpeaking = useRef(false);
  const scale = useSharedValue(1);
  const orb = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  useEffect(() => {
    if (!active) return;
    let shown = 0;
    const timer = setInterval(() => {
      const voice = callLevel();
      if (voice.speaking !== lastSpeaking.current) {
        lastSpeaking.current = voice.speaking;
        onSpeaking(voice.speaking);
      }
      if (reduceMotion) return;
      shown = shown * 0.6 + Math.min(1, voice.level * 8) * 0.4;
      const t = performance.now() / 1000;
      const breathing = live ? (working && !voice.speaking ? 0.04 : 0.015) : 0.03;
      const resting = live ? 1 : 0.92;
      scale.value = withTiming(resting + shown * 0.18 + breathing * Math.sin(t * 2.4), {
        duration: 65,
      });
    }, 50);
    return () => {
      clearInterval(timer);
      scale.value = 1;
    };
  }, [active, live, onSpeaking, reduceMotion, scale, working]);

  const accent = muted ? theme.colors.mutedForeground : theme.colors.primary;
  const surface = theme.colors.canvas;
  const bright = theme.scheme === "dark" ? theme.colors.foreground : surface;
  return (
    <Animated.View
      accessibilityElementsHidden
      style={[
        orb,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          boxShadow: `0 0 30px ${alpha(accent, speaking ? 0.34 : 0.16)}`,
        },
      ]}
    >
      <Svg width={size} height={size} viewBox="0 0 236 236">
        <Defs>
          <RadialGradient id="depth" cx="62%" cy="74%" r="76%">
            <Stop offset="0%" stopColor={accent} stopOpacity={live ? 0.95 : 0.7} />
            <Stop offset="100%" stopColor={accent} stopOpacity={0.26} />
          </RadialGradient>
          <RadialGradient id="light" cx="34%" cy="25%" r="63%">
            <Stop offset="0%" stopColor={bright} stopOpacity={speaking ? 0.68 : 0.88} />
            <Stop offset="100%" stopColor={bright} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={118} cy={118} r={117} fill={surface} />
        <Circle cx={118} cy={118} r={117} fill="url(#depth)" />
        <Circle
          cx={118}
          cy={118}
          r={117}
          fill="url(#light)"
          stroke={alpha(theme.colors.foreground, 0.08)}
        />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20 },
  header: { minHeight: 54, alignItems: "center", gap: 4, paddingTop: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 36 },
  caption: { width: "100%", minHeight: 96 },
  controls: { flexDirection: "row", gap: 12, paddingBottom: 8 },
  status: {
    flex: 1,
    minWidth: 0,
    height: 58,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    gap: 8,
  },
  button: {
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: "center",
    alignItems: "center",
  },
});
