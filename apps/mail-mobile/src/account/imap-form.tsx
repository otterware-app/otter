import { mailApi } from "@otter/client/mail/api";
import { useAddImapAccount } from "@otter/client/mail/hooks";
import type { MailServer } from "@otter/contracts/mail";
import { SettingsField } from "@otter/ui-native/components/settings-field";
import {
  SettingsButton,
  SettingsSection,
  SettingsSwitchRow,
} from "@otter/ui-native/components/settings";
import { useState } from "react";
import { Alert } from "react-native";

type Server = Omit<MailServer, "port"> & { port: string };

export function ImapForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [imap, setImap] = useState<Server>({ host: "", port: "993", security: "tls" });
  const [smtp, setSmtp] = useState<Server>({ host: "", port: "465", security: "tls" });
  const [discovering, setDiscovering] = useState(false);
  const add = useAddImapAccount();
  const busy = discovering || add.isPending;
  const address = email.trim().toLowerCase();
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address);

  const discover = async () => {
    setDiscovering(true);
    try {
      const settings = await mailApi.discoverImap(address);
      if (!settings) {
        Alert.alert(
          "Couldn't find the mail servers",
          "Enter the settings from your mail provider.",
        );
        return;
      }
      setUsername(settings.username);
      setImap({ ...settings.imap, port: String(settings.imap.port) });
      setSmtp({ ...settings.smtp, port: String(settings.smtp.port) });
    } catch {
      Alert.alert("Couldn't find the mail servers", "Enter the settings from your mail provider.");
    } finally {
      setDiscovering(false);
    }
  };

  const save = () =>
    add.mutate(
      {
        email: address,
        password,
        imap: {
          username: username.trim() || address,
          imap: { ...imap, port: Number(imap.port) },
          smtp: { ...smtp, port: Number(smtp.port) },
        },
      },
      {
        onSuccess: onDone,
        onSettled: () => add.reset(),
        onError: (error) => Alert.alert("Couldn't add mailbox", error.message),
      },
    );

  return (
    <>
      <SettingsSection title="IMAP mailbox" headline>
        <SettingsField placeholder="Email" value={email} onChangeText={setEmail} />
        <SettingsField
          placeholder="Username (defaults to email)"
          value={username}
          onChangeText={setUsername}
        />
        <SettingsField placeholder="Password" value={password} onChangeText={setPassword} secret />
        <SettingsButton
          title={discovering ? "Looking up servers…" : "Find mail servers"}
          disabled={!validEmail || busy}
          onPress={() => void discover()}
        />
      </SettingsSection>
      <ServerFields name="Incoming mail" server={imap} onChange={setImap} />
      <ServerFields name="Outgoing mail" server={smtp} onChange={setSmtp} />
      <SettingsSection>
        <SettingsButton
          title={add.isPending ? "Checking servers…" : "Add mailbox"}
          disabled={busy || !validEmail || !password || !validServer(imap) || !validServer(smtp)}
          onPress={save}
        />
        <SettingsButton title="Cancel" disabled={busy} onPress={onDone} />
      </SettingsSection>
    </>
  );
}

function validServer(server: Server) {
  const port = Number(server.port);
  return server.host.trim() && Number.isInteger(port) && port > 0 && port <= 65535;
}

function ServerFields({
  name,
  server,
  onChange,
}: {
  name: string;
  server: Server;
  onChange: (server: Server) => void;
}) {
  return (
    <SettingsSection title={name} headline>
      <SettingsField
        placeholder="Server hostname"
        value={server.host}
        onChangeText={(host) => onChange({ ...server, host })}
      />
      <SettingsField
        placeholder="Port"
        value={server.port}
        onChangeText={(port) => onChange({ ...server, port })}
      />
      <SettingsSwitchRow
        title="Use STARTTLS"
        value={server.security === "starttls"}
        onValueChange={(startTls) =>
          onChange({ ...server, security: startTls ? "starttls" : "tls" })
        }
      />
    </SettingsSection>
  );
}
