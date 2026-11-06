import { requireNativeView } from "expo";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

const NativeZoomSource = requireNativeView<{
  zoomId: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}>("OtterTransitions");

const NativeScreenTransition = requireNativeView<{
  zoomId?: string;
  minimizeBar: boolean;
  style?: StyleProp<ViewStyle>;
}>("OtterScreenTransition");

/** What a screen opened with `zoomId` zooms out of (a list's row). */
export function ZoomSource({ zoomId, children }: { zoomId: string; children: ReactNode }) {
  return <NativeZoomSource zoomId={zoomId}>{children}</NativeZoomSource>;
}

/**
 * Its screen zooms in from the ZoomSource with `zoomId` (and back into it),
 * and its navigation bar minimizes as it scrolls down.
 */
export function ScreenTransition({
  zoomId,
  minimizeBar = false,
}: {
  zoomId?: string;
  minimizeBar?: boolean;
}) {
  return (
    <NativeScreenTransition
      zoomId={zoomId}
      minimizeBar={minimizeBar}
      style={{ position: "absolute", width: 0, height: 0 }}
    />
  );
}
