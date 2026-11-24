import { keyInput, tapInput, type PageDialog } from "@otter/client/agents/agent-browser";
import { loadChat, useChats, watchChat } from "@otter/client/agents/chat-store";
import { hostOf } from "@otter/client/web-address";
import { browserFile } from "@otter/mobile/browser-files";
import { Button, IconButton } from "@otter/ui-native/components/button";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { typeStyle, useTheme } from "@otter/ui-native/theme";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Alert, KeyboardAvoidingView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrowserPage, type BrowserPageHandle, type PageInput } from "./browser-page.tsx";
import { useBrowserSession } from "./browser-session.ts";
import { useBrowserSource, useBrowserVisible } from "./browser-source.ts";

function pageUrl(input: string) {
  const text = input.trim();
  if (!text) return null;
  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::|\/|$)/i.test(text);
  const candidate = /^[a-z][\w+.-]*:\/\//i.test(text)
    ? text
    : `${local ? "http" : "https"}://${text}`;
  const url = URL.parse(candidate);
  return url && (url.protocol === "https:" || url.protocol === "http:") ? url.href : null;
}

/** Watch the agent's tab, take control of it, and hand it back. */
export function BrowserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { provider, sessionId, activity, demo, label } = useBrowserSource(id);
  const visible = useBrowserVisible();
  const [address, setAddress] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<{ dialog: PageDialog; text: string } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const addressInput = useRef<ComponentRef<typeof TextInput>>(null);
  const canvas = useRef<BrowserPageHandle>(null);
  const session = useBrowserSession(provider, sessionId, activity, visible, demo, canvas);
  const working = useChats((s) => Boolean(s.runs[id]));
  const loaded = useChats((s) => s.conversations.find((c) => c.id === id)?.loaded);
  const controlling = session.control === "held" && visible;
  const live = session.status === "live";
  const ready = live && controlling;
  const dialog = session.dialog;
  const response = (prompt?.dialog === dialog ? prompt.text : dialog?.defaultPrompt) ?? "";

  useEffect(() => {
    if (loaded === false) void loadChat(id);
  }, [id, loaded]);
  useFocusEffect(
    useCallback(() => {
      watchChat(id);
      return () => watchChat(null);
    }, [id]),
  );
  useEffect(() => {
    if (!ready) addressInput.current?.blur();
  }, [ready]);

  const open = () => {
    const url = pageUrl(address ?? session.page ?? "");
    if (!url) {
      Alert.alert("Could not open this address", "Enter an http or https URL.");
      return;
    }
    session.go({ type: "navigate", url });
    addressInput.current?.blur();
  };

  const input = (event: PageInput) => {
    if (!ready) return;
    switch (event.type) {
      case "tap":
        session.send(tapInput({ x: event.x, y: event.y }, event.clickCount));
        break;
      case "wheel":
        session.wheel(event);
        break;
      case "key":
        session.send(keyInput(event.key));
        break;
      case "text":
        session.send([event]);
        break;
    }
  };

  const choose = async (multiple: boolean) => {
    if (choosing) return;
    setChoosing(true);
    try {
      await session.choose(async () => {
        const result = await DocumentPicker.getDocumentAsync({
          multiple,
          copyToCacheDirectory: true,
        });
        return result.canceled ? [] : result.assets.map(browserFile);
      });
    } finally {
      setChoosing(false);
    }
  };

  const paste = async () => {
    const text = await Clipboard.getStringAsync().catch(() => "");
    if (text) session.send([{ type: "text", text }]);
  };

  const title = session.page ? hostOf(session.page) : "Browser";
  const controlLabel = controlling
    ? "You have control"
    : session.control === "taking"
      ? "Taking control…"
      : !live
        ? "Connecting…"
        : working
          ? "Agent has control"
          : "Watching";
  const fieldStyle = [
    typeStyle(theme, "base"),
    {
      backgroundColor: theme.colors.input,
      borderColor: theme.colors.border,
      borderWidth: 1,
      color: theme.colors.foreground,
      paddingHorizontal: 12,
    },
  ];

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={{
        flex: 1,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        backgroundColor: theme.colors.canvas,
      }}
    >
      <View style={styles.header}>
        <IconButton
          icon="xmark"
          label="Close browser"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace({ pathname: "/agents/[id]", params: { id } });
          }}
        />
        <Text
          size="lg"
          weight="semibold"
          accessibilityRole="header"
          numberOfLines={1}
          style={styles.title}
        >
          {title}
        </Text>
        <View style={{ width: 44 }} />
      </View>
      {session.tab ? (
        <>
          <View style={styles.address}>
            <IconButton
              icon="chevron.left"
              label="Back"
              variant="secondary"
              disabled={!ready}
              onPress={() => session.go({ type: "history", delta: -1 })}
            />
            <IconButton
              icon="chevron.right"
              label="Forward"
              variant="secondary"
              disabled={!ready}
              onPress={() => session.go({ type: "history", delta: 1 })}
            />
            <TextInput
              ref={addressInput}
              value={address ?? session.page ?? ""}
              onChangeText={setAddress}
              onFocus={() => setAddress(session.page ?? "")}
              onBlur={() => setAddress(null)}
              onSubmitEditing={open}
              accessibilityLabel="Address"
              placeholder="Enter a URL"
              placeholderTextColor={theme.colors.mutedForeground}
              editable={ready}
              selectTextOnFocus
              keyboardType="url"
              returnKeyType="go"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              style={[fieldStyle, { flex: 1, height: 40, borderRadius: 20 }]}
            />
            <IconButton
              icon="arrow.clockwise"
              label="Reload page"
              variant="secondary"
              disabled={!ready}
              onPress={() => session.go({ type: "reload" })}
            />
            <IconButton
              icon="doc.on.clipboard"
              label="Paste into page"
              variant="secondary"
              disabled={!ready}
              onPress={() => void paste()}
            />
          </View>
          <View style={[styles.control, { borderBottomColor: theme.colors.border }]}>
            <Text size="sm" color="mutedForeground">
              {controlLabel}
            </Text>
            <Button
              title={controlling ? "Release control" : "Take control"}
              size="sm"
              variant="secondary"
              disabled={session.control === "taking"}
              onPress={() => {
                haptics.tap();
                if (controlling) session.release();
                else void session.take();
              }}
            />
          </View>
        </>
      ) : null}
      <View style={{ flex: 1 }}>
        <BrowserPage
          ref={canvas}
          style={{ flex: 1 }}
          controlling={ready}
          keyboard={ready && session.field && address === null && !dialog && !choosing}
          demo={demo}
          accent={theme.colors.primary}
          pointer={session.pointer}
          typing={session.typing}
          onPageTouch={() => addressInput.current?.blur()}
          onPageInput={(event) => input(event.nativeEvent)}
          accessibilityElementsHidden={!live}
        />
        {!live ? (
          <View style={[styles.waiting, { backgroundColor: theme.colors.canvas }]}>
            {session.status === "connecting" ? <Spinner /> : null}
            <Text size="base" color="mutedForeground" style={{ textAlign: "center" }}>
              {session.status === "connecting"
                ? "Connecting to browser…"
                : session.status === "closed"
                  ? `${label}'s browser is closed. It shows here when ${label} browses again.`
                  : session.problem}
            </Text>
            {session.status === "closed" || session.status === "failed" ? (
              <Button
                title={session.status === "closed" ? "Reconnect" : "Try again"}
                variant="secondary"
                onPress={session.reconnect}
              />
            ) : null}
          </View>
        ) : null}
        <View style={styles.cards} pointerEvents="box-none">
          {controlling && session.chooser !== null ? (
            <BrowserCard>
              <Text size="base">
                {session.chooser ? "The page asks for files." : "The page asks for a file."}
              </Text>
              <View style={styles.actions}>
                <Button
                  title="Cancel"
                  size="sm"
                  variant="ghost"
                  onPress={() => void session.choose(async () => [])}
                />
                <Button
                  title={session.chooser ? "Choose files" : "Choose file"}
                  size="sm"
                  variant="secondary"
                  onPress={() => void choose(session.chooser === true)}
                />
              </View>
            </BrowserCard>
          ) : null}
          {dialog ? (
            <BrowserCard>
              <Text size="base">{dialog.message || "The page is asking."}</Text>
              {controlling ? (
                <>
                  {dialog.dialogType === "prompt" ? (
                    <TextInput
                      accessibilityLabel="Dialog response"
                      value={response}
                      onChangeText={(text) => setPrompt({ dialog, text })}
                      style={[fieldStyle, { minHeight: 40, borderRadius: theme.radius.md }]}
                    />
                  ) : null}
                  <View style={styles.actions}>
                    <Button
                      title="Dismiss"
                      size="sm"
                      variant="ghost"
                      onPress={() => session.answer(false)}
                    />
                    <Button
                      title="Accept"
                      size="sm"
                      variant="secondary"
                      onPress={() =>
                        session.answer(true, dialog.dialogType === "prompt" ? response : undefined)
                      }
                    />
                  </View>
                </>
              ) : (
                <Text size="sm" color="mutedForeground">
                  Take control to respond.
                </Text>
              )}
            </BrowserCard>
          ) : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function BrowserCard({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: 12,
        padding: 16,
        backgroundColor: theme.colors.card,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: theme.radius.lg,
      }}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  title: { textAlign: "center", flex: 1 },
  address: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  control: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  waiting: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 24,
  },
  cards: { position: "absolute", left: 12, right: 12, top: 64, gap: 8 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
});
