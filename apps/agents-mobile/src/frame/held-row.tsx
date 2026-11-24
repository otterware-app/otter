import type { ReactNode } from "react";
import { View } from "react-native";

/** Something VoiceOver offers on a row, as its swipe and menu entries. */
export type RowAction = { name: string; run: () => void };
const noActions: RowAction[] = [];

/**
 * A row in a `<Link>` with `Link.Trigger`, `Link.Preview` and `Link.Menu`, as one button to
 * VoiceOver and UI tests. Link's native view is `display: contents`, a view with no size, and iOS
 * leaves everything inside one out of the accessibility tree; so the row is announced from here,
 * outside it: its words joined (React Native reads a button's texts when it has no label, as
 * SwiftUI's `.combine`), opened by activating it, and what its swipes and menu do as actions.
 */
export function HeldRow({
  open,
  actions = noActions,
  selected,
  value,
  children,
}: {
  open: () => void;
  actions?: RowAction[];
  selected?: boolean;
  value?: string;
  children: ReactNode;
}) {
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityValue={value ? { text: value } : undefined}
      accessibilityActions={[
        { name: "activate" },
        ...actions.map((a) => ({ name: a.name, label: a.name })),
      ]}
      onAccessibilityAction={(event) => {
        const name = event.nativeEvent.actionName;
        if (name === "activate") open();
        else actions.find((a) => a.name === name)?.run();
      }}
    >
      {children}
    </View>
  );
}
