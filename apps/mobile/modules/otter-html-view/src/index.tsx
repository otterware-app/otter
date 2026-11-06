import { requireNativeView } from "expo";
import { useRef, useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";

type NativeProps = {
  ref?: unknown;
  html: string;
  remoteImages: boolean;
  style?: StyleProp<ViewStyle>;
  onHeight?: (event: { nativeEvent: { height: number } }) => void;
  onLink?: (event: { nativeEvent: { url: string } }) => void;
  onInlineImage?: (event: { nativeEvent: { cid: string; requestId: string } }) => void;
};

type NativeRef = {
  resolveImage(requestId: string, base64: string | null, mimeType: string): Promise<void>;
};

const NativeHtmlView = requireNativeView<NativeProps>("OtterHtmlView");

export type InlineImage = { base64: string; mimeType: string } | null;

/**
 * A message's HTML, as tall as its content. `loadImage` answers its `cid:`
 * images (base64); `remoteImages` lets images from the web load.
 */
export function HtmlView({
  html,
  remoteImages,
  onLink,
  loadImage,
  style,
}: {
  html: string;
  remoteImages: boolean;
  onLink: (url: string) => void;
  loadImage: (cid: string) => Promise<InlineImage>;
  style?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<NativeRef>(null);
  const [height, setHeight] = useState(60);
  return (
    <NativeHtmlView
      ref={ref as never}
      html={html}
      remoteImages={remoteImages}
      style={[{ height }, style]}
      onHeight={(e) => setHeight(e.nativeEvent.height)}
      onLink={(e) => onLink(e.nativeEvent.url)}
      onInlineImage={(e) => {
        const { cid, requestId } = e.nativeEvent;
        void loadImage(cid)
          .catch(() => null)
          .then((image) =>
            ref.current?.resolveImage(
              requestId,
              image?.base64 ?? null,
              image?.mimeType ?? "image/png",
            ),
          );
      }}
    />
  );
}
