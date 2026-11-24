import { Switch as NativeSwitch, type SwitchProps as NativeSwitchProps } from "react-native";

import { useTheme } from "../theme.ts";

export type SwitchProps = Omit<NativeSwitchProps, "trackColor" | "thumbColor"> & {
  /** What it turns on, for VoiceOver when nothing beside it says. */
  accessibilityLabel?: string;
};

/** The system's switch, on in the accent. */
export function Switch(props: SwitchProps) {
  const theme = useTheme();
  return <NativeSwitch trackColor={{ true: theme.colors.primary }} {...props} />;
}
