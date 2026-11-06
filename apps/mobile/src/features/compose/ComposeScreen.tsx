import { useAtomValue } from "@effect/atom-react";
import {
  ComposerEditor,
  type ComposerChange,
  type ComposerHandle,
} from "@otter-mail/mobile-composer";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";

import type { RootStack } from "../../App";
import { clientPlatform, mailboxes, threadLists } from "../../state/client";
import { core } from "../../state/core";
import type { MessageDetail } from "../../state/mail";
import { useKeyboardInset } from "../keyboard";
import { palette } from "../theme";

type Props = NativeStackScreenProps<RootStack, "Compose">;

type SaveResult =
  | { draftId: string; messageId?: string; threadId?: string }
  | { conflict: true; draftId: string; messageId: string }
  | { gone: true; draftId: string };

const AUTOSAVE_MS = 2000;

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function quoted(message: MessageDetail, intro: string): string {
  // Inline images stay with the original; the quote can't show them.
  const html = message.bodyHtml?.replace(/<img[^>]+src\s*=\s*["']?cid:[^>]*>/gi, "");
  const body =
    html ?? `<p>${escape(message.bodyText ?? message.snippet).replace(/\n/g, "<br>")}</p>`;
  return `<p><br></p><p>${escape(intro).replace(/\n/g, "<br>")}</p><blockquote>${body}</blockquote>`;
}

const prefixed = (prefix: string, subject: string) =>
  new RegExp(`^${prefix}:`, "i").test(subject) ? subject : `${prefix}: ${subject}`;

/**
 * Writing a message: the web composer's editor (TipTap, otter-composer) under
 * To, Cc and Subject. Saved as a draft as it's written (core's draft
 * session), sent through core's outgoing path.
 */
export function ComposeScreen({ navigation, route }: Props) {
  const colors = palette(useColorScheme());
  const keyboard = useKeyboardInset();
  const { accountId, mode = "new", messageId, threadId } = route.params;
  const account = useAtomValue(mailboxes.accountsAtom).value.find((m) => m.id === accountId);
  const editor = useRef<ComposerHandle>(null);
  const sessionKey = useRef(clientPlatform.newId()).current;
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState<ComposerChange>({ html: "", text: "", blank: true });
  const [draftId, setDraftId] = useState<string | undefined>();
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const replyTo = useRef<MessageDetail | null>(null);
  const edited = useRef(false);

  const onReady = async () => {
    if (mode === "new" || !messageId) return void editor.current?.focus("start");
    const message = await core.invoke<MessageDetail>("gmail:getMessage", { accountId, messageId });
    replyTo.current = message;
    const date = new Date(message.date).toLocaleString();
    const who = message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail;
    if (mode === "forward") {
      setSubject(prefixed("Fwd", message.subject));
      await editor.current?.setContent(
        quoted(
          message,
          `---------- Forwarded message ---------\nFrom: ${who}\nDate: ${date}\nSubject: ${message.subject}`,
        ),
      );
    } else {
      setSubject(prefixed("Re", message.subject));
      setTo(message.fromEmail);
      if (mode === "replyAll") {
        const me = account?.email.toLowerCase();
        const others = [message.to, message.cc ?? ""]
          .join(",")
          .split(",")
          .map((a) => a.trim())
          .filter((a) => a && !a.toLowerCase().includes(me ?? "\u0000"));
        setCc(others.join(", "));
      }
      await editor.current?.setContent(quoted(message, `On ${date}, ${who} wrote:`));
    }
    await editor.current?.focus("start");
  };

  const draft = () => ({
    accountId,
    sessionKey,
    draftId,
    to,
    cc: cc || undefined,
    subject,
    body: body.text,
    bodyHtml: body.html,
    threadId: mode === "forward" ? undefined : threadId,
  });

  useEffect(() => {
    if (!edited.current) return;
    const timer = setTimeout(() => {
      setStatus("Saving…");
      core
        .invoke<SaveResult>("gmail:saveDraft", draft())
        .then((result) => {
          setDraftId(result.draftId);
          setStatus("gone" in result ? "Sent or deleted elsewhere" : "Saved");
        })
        .catch((e: unknown) => setStatus(`Not saved: ${String(e)}`));
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react/exhaustive-effect-dependencies
  }, [to, cc, subject, body]);

  const send = async () => {
    if (!to.trim()) return Alert.alert("Add a recipient first.");
    setSending(true);
    try {
      await core.invoke("gmail:sendMessage", {
        ...draft(),
        replyToMessageId: mode === "reply" || mode === "replyAll" ? messageId : undefined,
      });
      threadLists.invalidate(accountId);
      navigation.goBack();
    } catch (e) {
      Alert.alert("Couldn't send", e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const close = () => {
    if (!edited.current) return navigation.goBack();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ["Delete Draft", "Save Draft", "Cancel"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 2,
      },
      (i) => {
        if (i === 0) {
          if (draftId)
            void core.invoke("gmail:deleteDraft", { accountId, draftId }).catch(() => {});
          navigation.goBack();
        } else if (i === 1) {
          void core.invoke("gmail:saveDraft", draft()).catch(() => {});
          navigation.goBack();
        }
      },
    );
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close" testID="compose-close">
          <SymbolView name="xmark" size={18} tintColor={colors.text} />
        </Pressable>
      ),
      headerRight: () => (
        <Pressable
          onPress={() => void send()}
          disabled={sending}
          hitSlop={10}
          accessibilityLabel="Send"
          testID="compose-send"
        >
          <SymbolView
            name="arrow.up.circle.fill"
            size={30}
            tintColor={sending ? colors.secondary : colors.accent}
          />
        </Pressable>
      ),
    });
  });

  const change =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      edited.current = true;
      set(value);
    };

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    testID: string,
    email = true,
  ) => (
    <View style={[styles.field, { borderColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.secondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={change(onChange)}
        style={[styles.input, { color: colors.text }]}
        autoCapitalize={email ? "none" : "sentences"}
        autoCorrect={!email}
        keyboardType={email ? "email-address" : "default"}
        accessibilityLabel={label}
        testID={testID}
      />
    </View>
  );

  const tool = (symbol: SFSymbol, label: string, command: string) => (
    <Pressable
      onPress={() => void editor.current?.command(command)}
      style={styles.tool}
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      <SymbolView name={symbol} size={18} tintColor={colors.text} />
    </Pressable>
  );

  return (
    <View
      style={[styles.fill, { backgroundColor: colors.background }, { paddingBottom: keyboard }]}
    >
      {account ? (
        <Text style={[styles.from, { color: colors.secondary }]}>From {account.email}</Text>
      ) : null}
      {field("To", to, setTo, "compose-to")}
      {field("Cc", cc, setCc, "compose-cc")}
      {field("Subject", subject, setSubject, "compose-subject", false)}
      <ComposerEditor
        ref={editor}
        style={styles.editor}
        onReady={() => void onReady()}
        onChange={change(setBody)}
      />
      <View style={[styles.toolbar, { borderColor: colors.border }]}>
        {tool("bold", "Bold", "bold")}
        {tool("italic", "Italic", "italic")}
        {tool("list.bullet", "Bulleted list", "bulletList")}
        {tool("list.number", "Numbered list", "orderedList")}
        {tool("text.quote", "Quote", "blockquote")}
        <Text style={[styles.status, { color: colors.secondary }]} numberOfLines={1}>
          {status ?? ""}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  from: { paddingHorizontal: 20, paddingTop: 8, fontSize: 13 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 20,
    minHeight: 46,
  },
  label: { fontSize: 15, width: 62 },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  editor: { flex: 1 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    height: 44,
  },
  tool: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  status: { flex: 1, textAlign: "right", fontSize: 12 },
});
