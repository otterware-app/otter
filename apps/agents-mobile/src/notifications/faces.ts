import { agentApi, type ProviderSnapshot, type ProvidersState } from "@otter/client/agents/api";
import { listen } from "@otter/client/bridge";

import { notificationsNative, type NotificationFace } from "./native.ts";

function notificationFaces(providers: ProviderSnapshot[]): NotificationFace[] {
  const faces = new Map<string, NotificationFace>();
  function add(face: NotificationFace) {
    const previous = faces.get(face.key);
    // A push names the gateway's agent. If two gateways name it alike, use the kind's mark.
    if (previous && (previous.avatar !== face.avatar || previous.emoji !== face.emoji)) {
      faces.set(face.key, { ...face, avatar: null, emoji: null });
    } else {
      faces.set(face.key, face);
    }
  }
  for (const provider of providers) {
    if (provider.kind === "openclaw") {
      for (const { slug, avatar, emoji } of provider.models) {
        add({
          key: `openclaw-${slug}`,
          avatar: avatar ?? (emoji ? null : provider.avatar),
          emoji: emoji ?? null,
          mark: "AgentOpenClaw",
        });
      }
    } else if (provider.kind === "varys") {
      const agentId = provider.settings.agentId;
      if (typeof agentId === "string" && agentId) {
        add({ key: `varys-${agentId}`, avatar: provider.avatar, emoji: null, mark: "AgentVarys" });
      }
    } else if (provider.kind === "hermes") {
      add({ key: "hermes", avatar: provider.avatar, emoji: null, mark: "AgentHermes" });
    }
  }
  return [...faces.values()];
}

const report = (error: unknown) => console.warn("Could not save notification pictures", error);
let changingUser = Promise.resolve();

export function followNotificationFaces(userId: string | null): (() => void) | undefined {
  const ready = changingUser.then(() => notificationsNative.setUser(userId));
  changingUser = ready.catch(report);
  if (!userId) return;

  let saving = ready;
  let active = true;
  let heard = false;
  const save = ({ providers }: ProvidersState) => {
    saving = saving
      .then(async () => {
        if (active) await notificationsNative.saveFaces(userId, notificationFaces(providers));
      })
      .catch(report);
  };
  const off = listen("agent:providersChanged", (state) => {
    heard = true;
    save(state as ProvidersState);
  });
  void agentApi
    .providers()
    .then((state) => {
      if (active && !heard) save(state);
    })
    .catch(report);
  return () => {
    active = false;
    off();
  };
}
