import { Button, LabeledContent, Link, SecureField, Text } from "@expo/ui/swift-ui";
import { disabled, foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";

import { useAgentProviders, type AgentProvider } from "../../state/chats";
import { agentServerUrl, core } from "../../state/core";
import type { Palette } from "../theme";
import { Group, SettingsForm } from "./SettingsScreen";

const status = (p: AgentProvider) =>
  !p.enabled
    ? "Off"
    : p.auth.status === "authenticated"
      ? "Connected"
      : p.status === "error"
        ? "Not answering"
        : "Not connected";

/**
 * The Swift app's AgentSettings: the agents core runs on the phone, and
 * OpenRouter's key (kept on Otter Mail's server, so it needs the Otter account).
 */
export function AgentSettings({ colors, signedIn }: { colors: Palette; signedIn: boolean }) {
  const providers = useAgentProviders();
  const openrouter = providers.find((p) => p.kind === "openrouter");
  const others = providers.filter((p) => p.kind !== "openrouter");
  const canConnect = signedIn || Boolean(agentServerUrl);
  const [apiKey, setApiKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await core.invoke("agent:connectOpenRouter", { apiKey });
      setApiKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <SettingsForm colors={colors} title="Agents">
      {openrouter ? (
        <Group
          colors={colors}
          title="OpenRouter"
          footer={
            <Text>
              {canConnect
                ? "The API key stays on Otter Mail's server. When you use this agent, your prompts and mail returned by its tools are sent to Otter Mail's server, OpenRouter and the selected model provider. Usage is billed to your OpenRouter account."
                : "Sign in to your Otter account to connect OpenRouter."}
            </Text>
          }
        >
          <LabeledContent label="Status">
            <Text modifiers={[foregroundStyle(colors.secondary)]}>{status(openrouter)}</Text>
          </LabeledContent>
          {openrouter.auth.status === "authenticated" ? (
            <Button
              label="Disconnect"
              role="destructive"
              onPress={() => void core.invoke("agent:disconnectOpenRouter")}
            />
          ) : (
            <>
              <SecureField placeholder="OpenRouter API key" onTextChange={setApiKey} />
              <Button
                label={connecting ? "Connecting…" : "Connect"}
                onPress={() => void connect()}
                modifiers={[disabled(!apiKey || connecting || !canConnect)]}
              />
            </>
          )}
          {error ? <Text modifiers={[foregroundStyle(colors.error)]}>{error}</Text> : null}
          <Link label="Get an API key" destination="https://openrouter.ai/settings/keys" />
        </Group>
      ) : null}
      {others.length > 0 ? (
        <Group
          colors={colors}
          title="Your agents"
          footer={
            <Text>
              Hermes and OpenClaw are set up on the Mac or the web; their chats follow your Otter
              account here.
            </Text>
          }
        >
          {others.map((p) => (
            <LabeledContent key={p.kind} label={p.displayName}>
              <Text modifiers={[foregroundStyle(colors.secondary)]}>{status(p)}</Text>
            </LabeledContent>
          ))}
        </Group>
      ) : null}
    </SettingsForm>
  );
}
