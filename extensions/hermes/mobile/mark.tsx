import type { AgentMarkProps } from "@otter/mobile/extension-kit";
import { Image } from "expo-image";

// The picture ../ui shows too, read from there rather than copied.
import picture from "../ui/hermes-agent-icon.png";

/** Hermes's picture, its corners rounded. */
export function HermesMark({ size }: AgentMarkProps) {
  return (
    <Image source={picture} style={{ width: size, height: size, borderRadius: size * 0.25 }} />
  );
}
