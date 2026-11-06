import { useEffect, useState } from "react";
import { Dimensions, Keyboard, LayoutAnimation } from "react-native";

/**
 * How much of the screen's bottom the keyboard covers, following it as it
 * moves. KeyboardAvoidingView misjudges views in a sheet; a sheet reaches
 * the screen's bottom, so the keyboard's own frame is the answer.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const change = Keyboard.addListener("keyboardWillChangeFrame", (e) => {
      LayoutAnimation.configureNext({
        duration: e.duration || 250,
        update: { type: LayoutAnimation.Types.keyboard },
      });
      setInset(Math.max(0, Dimensions.get("screen").height - e.endCoordinates.screenY));
    });
    const hide = Keyboard.addListener("keyboardWillHide", () => setInset(0));
    return () => {
      change.remove();
      hide.remove();
    };
  }, []);
  return inset;
}
