import { Button, Divider, Host, Menu, RNHostView } from "@expo/ui/swift-ui";
import { accessibilityLabel as label, disabled, tint } from "@expo/ui/swift-ui/modifiers";
import type { IconName } from "@otter/ui-native/components/icon";
import { useTheme } from "@otter/ui-native/theme";
import { Fragment, type ReactElement } from "react";

export type MenuAction = {
  title: string;
  icon?: IconName;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

/** What's drawn (a button, a capsule) opening the system's menu of `sections`, a divider between each. */
export function MenuButton({
  sections,
  accessibilityLabel,
  children,
}: {
  sections: MenuAction[][];
  accessibilityLabel: string;
  children: ReactElement;
}) {
  const theme = useTheme();
  return (
    <Host matchContents colorScheme={theme.scheme}>
      <Menu
        label={<RNHostView matchContents>{children}</RNHostView>}
        modifiers={[tint(theme.colors.primary), label(accessibilityLabel)]}
      >
        {sections
          .filter((section) => section.length > 0)
          .map((section, index) => (
            <Fragment key={section[0]?.title}>
              {index > 0 ? <Divider /> : null}
              {section.map((action) => (
                <Button
                  key={action.title}
                  label={action.title}
                  systemImage={action.icon}
                  role={action.destructive ? "destructive" : "default"}
                  modifiers={[disabled(Boolean(action.disabled))]}
                  onPress={action.onPress}
                />
              ))}
            </Fragment>
          ))}
      </Menu>
    </Host>
  );
}
