import { Image } from "expo-image";
import type { ReactNode } from "react";
import { View } from "react-native";

import { useTheme } from "../theme.ts";
import { Badge, BadgeDot } from "./badge.tsx";
import { Text } from "./text.tsx";

export type AvatarProps = {
  size?: number;
  /** A picture: a data URL or an https one. */
  source?: string | null;
  /** An emoji, as an OpenClaw agent's face. */
  emoji?: string | null;
  /** A mark drawn at the avatar's size: an agent kind's, Otter's. */
  mark?: ReactNode;
  /** Letters on the accent, as the account's. */
  initials?: string;
  shape?: "circle" | "rounded";
  /** The unread dot, at the top trailing corner. */
  dot?: boolean;
  /** A count, at the top trailing corner. */
  badge?: string | number;
  accessibilityLabel?: string;
};

/**
 * Whose something is: a picture, else an emoji, else a mark, else initials, in that order
 * (Design.swift's `AgentAvatar`). Decorative unless it has a label.
 */
export function Avatar({
  size = 28,
  source,
  emoji,
  mark,
  initials,
  shape = "circle",
  dot,
  badge,
  accessibilityLabel,
}: AvatarProps) {
  const theme = useTheme();
  const radius = shape === "circle" ? size / 2 : size * 0.25;
  let face: ReactNode;
  if (source) {
    face = (
      <Image
        source={source}
        contentFit="cover"
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  } else if (emoji) {
    face = (
      <Text allowFontScaling={false} style={{ fontSize: size * 0.82, lineHeight: size }}>
        {emoji}
      </Text>
    );
  } else if (mark) {
    face = mark;
  } else {
    face = (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: theme.colors.primary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          allowFontScaling={false}
          weight="semibold"
          color="primaryForeground"
          style={{ fontSize: size * 0.45 }}
        >
          {initials?.slice(0, 2).toUpperCase()}
        </Text>
      </View>
    );
  }
  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? "image" : undefined}
      accessibilityElementsHidden={!accessibilityLabel}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      {face}
      {badge !== undefined || dot ? (
        <View style={{ position: "absolute", top: -3, right: -3 }}>
          {badge !== undefined ? <Badge>{badge}</Badge> : <BadgeDot />}
        </View>
      ) : null}
    </View>
  );
}
