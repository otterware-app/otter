import { browserActivity } from "@otter/client/agents/agent-browser";
import { agentApi } from "@otter/client/agents/api";
import { useChats } from "@otter/client/agents/chat-store";
import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { FAKE } from "../core.ts";
import { useChatAgent } from "./chat-agent.ts";

export function useBrowserSource(chatId: string) {
  const { convo, provider, id, label } = useChatAgent(chatId);
  const scripted = FAKE && provider?.kind === "openclaw" && !provider.liveBrowser;
  const activity = useChats((s) => {
    const turns = s.conversations.find((c) => c.id === chatId)?.turns ?? [];
    if (scripted) {
      return turns.reduce(
        (count, turn) =>
          count +
          (turn.items ?? []).filter((item) => item.kind === "step" && item.step.kind === "web")
            .length,
        0,
      );
    }
    const { steps, done } = browserActivity(turns);
    return steps + done;
  });
  return {
    provider: provider?.liveBrowser ? id : null,
    sessionId: activity > 0 ? convo?.sessionId : undefined,
    activity,
    demo: scripted && activity > 0,
    label,
  };
}

export function useBrowserVisible() {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(() => AppState.currentState !== "background");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setForeground(state !== "background");
    });
    return () => subscription.remove();
  }, []);
  return focused && foreground;
}

export function useHasBrowser(chatId: string) {
  const { provider, sessionId, activity, demo } = useBrowserSource(chatId);
  const visible = useBrowserVisible();
  const [tabFor, setTabFor] = useState<string | null>(null);
  const source =
    provider && sessionId && activity > 0 ? JSON.stringify([provider, sessionId]) : null;
  useEffect(() => {
    if (!visible || !source || !provider || !sessionId || activity === 0) return;
    let cancelled = false;
    void agentApi.browserView(provider, sessionId, { width: 320, height: 320 }).then(
      (view) => {
        if (!cancelled) setTabFor(view ? source : null);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [activity, provider, sessionId, source, visible]);
  return demo || (source !== null && tabFor === source);
}
