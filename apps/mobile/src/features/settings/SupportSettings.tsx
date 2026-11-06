import { Text, Toggle, VStack } from "@expo/ui/swift-ui";
import { font, textSelection } from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";

import {
  errorReportsAvailable,
  errorReportsOn,
  reportId,
  setErrorReportsOn,
} from "../../error-reports";
import type { Palette } from "../theme";
import { Group } from "./SettingsScreen";

/** Support: sending error reports (on unless turned off), and the ID they're sent under. */
export function SupportSettings({ colors }: { colors: Palette }) {
  const [on, setOn] = useState(errorReportsOn);
  if (!errorReportsAvailable) return null;
  return (
    <Group
      colors={colors}
      title="Support"
      footer={
        <VStack alignment="leading" spacing={6}>
          <Text modifiers={[font({ textStyle: "footnote" })]}>
            When something fails, tell Otterware what broke and where. Never your mail, addresses or
            passwords.
          </Text>
          <Text modifiers={[font({ textStyle: "footnote" }), textSelection(true)]}>
            {`Report ID ${reportId()}`}
          </Text>
        </VStack>
      }
    >
      <Toggle
        label="Send error reports"
        systemImage="ant"
        isOn={on}
        onIsOnChange={(value) => {
          setErrorReportsOn(value);
          setOn(value);
        }}
      />
    </Group>
  );
}
