import { TabStack } from "../../../frame/tab-stack.tsx";

export const unstable_settings = { anchor: "settings/index" };

export default function SettingsStack() {
  return <TabStack tab="settings" root="settings/index" />;
}
