import { requireNativeView } from "expo";
import type { Ref } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

type Point = { x: number; y: number };
export type BrowserPointer = Point & { clicks: number; seen: number };
export type BrowserTyping = Point & { width: number; height: number; seen: number };
export type BrowserWheel = Point & { type: "wheel"; deltaX: number; deltaY: number };
export type PageInput =
  | (Point & { type: "tap"; clickCount: number })
  | BrowserWheel
  | { type: "key"; key: string }
  | { type: "text"; text: string };

export type BrowserPageHandle = {
  drawFrame: (jpeg: Uint8Array, cssWidth: number, cssHeight: number) => Promise<boolean>;
};

export const BrowserPage = requireNativeView<
  ViewProps & {
    ref: Ref<BrowserPageHandle>;
    controlling: boolean;
    keyboard: boolean;
    accent: string;
    demo: boolean;
    pointer: BrowserPointer | null;
    typing: BrowserTyping | null;
    onPageInput: (event: NativeSyntheticEvent<PageInput>) => void;
    onPageTouch: () => void;
  }
>("OtterAgentBrowser");
