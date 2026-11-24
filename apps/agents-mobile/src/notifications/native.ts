import type { PutPushDeviceRequest } from "@otter/contracts/relay";
import { requireNativeModule } from "expo";

export type PushConfig = Pick<PutPushDeviceRequest, "environment" | "topic">;

export const notificationsNative = requireNativeModule<{
  pushConfig(): PushConfig | null;
  setUser(id: string | null): Promise<void>;
  clearSession(session: string): Promise<void>;
  saveFaces(userId: string, faces: NotificationFace[]): Promise<void>;
}>("OtterAgentNotifications");

export type NotificationFace = {
  key: string;
  mark: "AgentOpenClaw" | "AgentVarys" | "AgentHermes";
  avatar: string | null;
  emoji: string | null;
};
