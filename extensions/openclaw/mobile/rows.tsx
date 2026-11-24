import { agentFace, disabledAgents } from "@otter/client/agents/agent-providers";
import type { AgentRowsProps } from "@otter/mobile/extension-kit";
import { Avatar } from "@otter/ui-native/components/avatar";
import { SettingsDivider, SettingsSwitchRow } from "@otter/ui-native/components/settings";
import { useTheme } from "@otter/ui-native/theme";
import { Fragment } from "react";
import { View } from "react-native";

import { gatewayAgentPatch } from "../shared/connect";
import { OpenClawMark } from "./mark";

/** The gateway's agents under it in your agents list, a switch each (off: none of their chats run). */
export function OpenClawRows({ provider, update }: AgentRowsProps) {
  const theme = useTheme();
  return provider.models.map((m) => {
    const face = agentFace(provider, m.slug);
    return (
      <Fragment key={m.slug}>
        <SettingsDivider />
        <View style={{ paddingLeft: 35 }}>
          <SettingsSwitchRow
            title={m.name}
            icon={
              <Avatar
                size={22}
                source={face.picture}
                emoji={face.emoji}
                mark={<OpenClawMark size={22} color={theme.colors.foreground} />}
              />
            }
            value={!disabledAgents(provider).includes(m.slug)}
            onValueChange={(on) => update(gatewayAgentPatch(provider, m.slug, on))}
            disabled={!provider.enabled}
          />
        </View>
      </Fragment>
    );
  });
}
