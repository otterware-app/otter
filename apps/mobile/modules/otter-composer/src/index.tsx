import { requireNativeView } from "expo";
import { forwardRef, useImperativeHandle, useRef } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export type ComposerChange = { html: string; text: string; blank: boolean };

type NativeProps = {
  ref?: unknown;
  placeholder: string;
  style?: StyleProp<ViewStyle>;
  onReady?: () => void;
  onChange?: (event: { nativeEvent: ComposerChange }) => void;
  onFocusChange?: (event: { nativeEvent: { focused: boolean } }) => void;
};

type NativeRef = {
  setContent(html: string): Promise<void>;
  focus(position: "start" | "end"): Promise<void>;
  command(name: string): Promise<void>;
  /** The snapshot as JSON (Swift can't send a dictionary across actors); null before the editor is ready. */
  snapshot(): Promise<string | null>;
};

export type ComposerHandle = Omit<NativeRef, "snapshot"> & {
  /** What's written now, without waiting for the next change event; null before the editor is ready. */
  snapshot(): Promise<ComposerChange | null>;
};

const NativeComposer = requireNativeView<NativeProps>("OtterComposer");

/** The web composer's TipTap editor, in WebKit; formatting through `ref.command`. */
export const ComposerEditor = forwardRef<
  ComposerHandle,
  {
    placeholder?: string;
    style?: StyleProp<ViewStyle>;
    onReady?: () => void;
    onChange: (change: ComposerChange) => void;
    onFocusChange?: (focused: boolean) => void;
  }
>(function ComposerEditor(
  { placeholder = "Message", style, onReady, onChange, onFocusChange },
  ref,
) {
  const native = useRef<NativeRef>(null);
  useImperativeHandle(ref, () => ({
    setContent: (html) => native.current?.setContent(html) ?? Promise.resolve(),
    focus: (position) => native.current?.focus(position) ?? Promise.resolve(),
    command: (name) => native.current?.command(name) ?? Promise.resolve(),
    snapshot: async () => {
      const json = await native.current?.snapshot();
      return json ? (JSON.parse(json) as ComposerChange) : null;
    },
  }));
  return (
    <NativeComposer
      ref={native as never}
      placeholder={placeholder}
      style={style}
      onReady={onReady}
      onChange={(e) => onChange(e.nativeEvent)}
      onFocusChange={(e) => onFocusChange?.(e.nativeEvent.focused)}
    />
  );
});
