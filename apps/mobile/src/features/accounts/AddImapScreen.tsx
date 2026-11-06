import type { ImapSettings } from "@otter-mail/contracts";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";

import type { ScrollViewInstance } from "react-native";

import type { RootStack } from "../../App";
import { mailboxes } from "../../state/client";
import { core } from "../../state/core";
import { useKeyboardInset } from "../keyboard";
import { palette } from "../theme";

type Props = NativeStackScreenProps<RootStack, "AddImap">;

type Server = { host: string; port: string; security: "tls" | "starttls" };

/**
 * An IMAP mailbox (apps/ios's AddImapMailbox): the address and password, the
 * servers found by core's discovery (`gmail:discoverImap`) or typed.
 */
export function AddImapScreen({ navigation }: Props) {
  const colors = palette(useColorScheme());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [imap, setImap] = useState<Server>({ host: "", port: "993", security: "tls" });
  const [smtp, setSmtp] = useState<Server>({ host: "", port: "465", security: "tls" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discover = async () => {
    if (!email.includes("@")) return;
    try {
      const found = await core.invoke<ImapSettings | null>("gmail:discoverImap", { email });
      if (!found) return;
      setUsername(found.username);
      setImap({
        host: found.imap.host,
        port: String(found.imap.port),
        security: found.imap.security,
      });
      setSmtp({
        host: found.smtp.host,
        port: String(found.smtp.port),
        security: found.smtp.security,
      });
    } catch {
      // nothing known about the domain: type the servers
    }
  };

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await core.invoke("gmail:addImapAccount", {
        email,
        password,
        imap: {
          username: username || email,
          imap: { host: imap.host, port: Number(imap.port), security: imap.security },
          smtp: { host: smtp.host, port: Number(smtp.port), security: smtp.security },
        },
      });
      await mailboxes.refreshAccounts();
      navigation.popToTop();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // The sheet's own keyboard inset: UIKit's misjudges it, and a focused field is scrolled to.
  const keyboard = useKeyboardInset();
  const scroll = useRef<ScrollViewInstance>(null);
  const top = useRef(new Map<string, number>()).current;

  const field = (
    label: string,
    value: string,
    onChange: (text: string) => void,
    options: Partial<React.ComponentProps<typeof TextInput>> = {},
  ) => (
    <View
      style={[styles.field, { borderColor: colors.border }]}
      onLayout={(e) => top.set(options.testID ?? label, e.nativeEvent.layout.y)}
    >
      <Text style={[styles.label, { color: colors.secondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() =>
          scroll.current?.scrollTo({
            y: Math.max(0, (top.get(options.testID ?? label) ?? 0) - 120),
          })
        }
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: colors.text }]}
        placeholderTextColor={colors.secondary}
        accessibilityLabel={label}
        {...options}
      />
    </View>
  );

  const security = (server: Server, set: (s: Server) => void) => (
    <View style={styles.segments}>
      {(["tls", "starttls"] as const).map((s) => (
        <Pressable
          key={s}
          onPress={() => set({ ...server, security: s })}
          style={[
            styles.segment,
            { backgroundColor: server.security === s ? colors.accent : colors.card },
          ]}
        >
          <Text style={{ color: server.security === s ? "#FFFFFF" : colors.text }}>
            {s === "tls" ? "TLS" : "STARTTLS"}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <ScrollView
      ref={scroll}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: 60 + keyboard }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {field("Email", email, setEmail, {
        keyboardType: "email-address",
        onBlur: () => void discover(),
        testID: "imap-email",
      })}
      {field("Password", password, setPassword, { secureTextEntry: true, testID: "imap-password" })}
      {field("Username", username, setUsername, { placeholder: email })}
      <Text style={[styles.section, { color: colors.secondary }]}>IMAP</Text>
      {field("Server", imap.host, (host) => setImap({ ...imap, host }), { testID: "imap-host" })}
      {field("Port", imap.port, (port) => setImap({ ...imap, port }), {
        keyboardType: "number-pad",
        testID: "imap-port",
      })}
      {security(imap, setImap)}
      <Text style={[styles.section, { color: colors.secondary }]}>SMTP</Text>
      {field("Server", smtp.host, (host) => setSmtp({ ...smtp, host }), { testID: "smtp-host" })}
      {field("Port", smtp.port, (port) => setSmtp({ ...smtp, port }), {
        keyboardType: "number-pad",
        testID: "smtp-port",
      })}
      {security(smtp, setSmtp)}
      {error ? <Text style={{ color: colors.trash, marginTop: 12 }}>{error}</Text> : null}
      <Pressable
        onPress={() => void add()}
        disabled={busy || !email || !password || !imap.host || !smtp.host}
        style={[styles.add, { backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 }]}
        testID="imap-add"
      >
        {busy ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.addTitle}>Add mailbox</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 60 },
  field: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  label: { fontSize: 12 },
  input: { fontSize: 17, paddingVertical: 4 },
  section: { marginTop: 22, fontSize: 13, fontWeight: "600", textTransform: "uppercase" },
  segments: { flexDirection: "row", gap: 8, marginTop: 10 },
  segment: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  add: {
    marginTop: 28,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  addTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
});
