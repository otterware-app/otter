import { useChatProvider } from "@otter/client/agents/agent-providers";
import { chatDetails } from "@otter/client/agents/chat-details";
import { chatFileProblem, fileTabTitle, useChatFile } from "@otter/client/agents/chat-files";
import { fileLinkLine, isChatFileLink } from "@otter/client/agents/chat-links";
import { loadChat, useChats } from "@otter/client/agents/chat-store";
import { attachmentPreview, bytesOfBase64, decodeText } from "@otter/client/file-preview";
import { host } from "@otter/client/host";
import { formatBytes } from "@otter/client/mail/format";
import { userFiles } from "@otter/mobile/user-files";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Icon } from "@otter/ui-native/components/icon";
import { Markdown } from "@otter/ui-native/components/markdown";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { FlashList } from "@shopify/flash-list";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";

const WRAP_KEY = "file:wrap";

const readWrap = () => {
  try {
    return host().storage.get(WRAP_KEY) !== "false";
  } catch {
    return true;
  }
};

/** A file from where the agent runs (FileScreen.swift): text with line numbers, Markdown as it reads, anything else in Quick Look. */
export function FileScreen() {
  const theme = useTheme();
  const { id, path = "" } = useLocalSearchParams<{ id: string; path?: string }>();
  const convo = useChats((s) => s.conversations.find((c) => c.id === id));
  const chatAgent = useChatProvider(convo);
  const agentName = convo ? chatDetails(convo, chatAgent).agentName : null;
  const loaded = convo?.loaded ?? true;
  const file = useChatFile(convo, path);
  const [source, setSource] = useState(false);
  const [wrap, setWrap] = useState(readWrap);

  useEffect(() => {
    if (!loaded) void loadChat(id);
  }, [id, loaded]);

  const shown = useMemo(() => {
    if (!file.data) return null;
    const bytes = bytesOfBase64(file.data.data);
    const preview = attachmentPreview(file.data.name, file.data.mimeType);
    let text: { text: string; truncated: boolean } | null = null;
    if (preview && !["pdf", "image", "video", "audio"].includes(preview.kind)) {
      try {
        text = decodeText(bytes);
      } catch {
        text = null;
      }
    }
    return { name: file.data.name, bytes, kind: preview?.kind ?? null, text };
  }, [file.data]);

  const opened = useRef(false);
  useEffect(() => {
    if (!shown || shown.text || shown.kind === "image" || opened.current) return;
    opened.current = true;
    void userFiles.open(shown.name, shown.bytes);
  }, [shown]);

  const name = shown?.name ?? fileTabTitle(path).replace(/:\d+(?:-\d+)?$/, "");
  const markdown = shown?.kind === "markdown" && shown.text;

  const changeWrap = (next: boolean) => {
    setWrap(next);
    try {
      host().storage.set(WRAP_KEY, String(next));
    } catch {
      // Without storage it wraps each time.
    }
  };

  const openLink = (href: string) => {
    if (/^https?:/i.test(href)) void WebBrowser.openBrowserAsync(href);
    else if (isChatFileLink(href))
      router.push({ pathname: "/agents/[id]/file", params: { id, path: href } });
  };

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <Stack.Title asChild>
        <FileTitle name={name} agent={agentName} />
      </Stack.Title>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="File actions">
          {shown?.text && markdown ? (
            <Stack.Toolbar.Menu inline title="View">
              <Stack.Toolbar.MenuAction
                icon="doc.richtext"
                isOn={!source}
                onPress={() => setSource(false)}
              >
                Preview
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction
                icon="chevron.left.forwardslash.chevron.right"
                isOn={source}
                onPress={() => setSource(true)}
              >
                Source
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
          ) : null}
          {shown?.text && (!markdown || source) ? (
            <Stack.Toolbar.MenuAction
              icon="text.word.spacing"
              isOn={wrap}
              onPress={() => changeWrap(!wrap)}
            >
              Word wrap
            </Stack.Toolbar.MenuAction>
          ) : null}
          {shown?.text ? (
            <Stack.Toolbar.MenuAction
              icon="doc.on.doc"
              onPress={() => void Clipboard.setStringAsync(shown.text?.text ?? "")}
            >
              {shown.text.truncated ? "Copy preview" : "Copy contents"}
            </Stack.Toolbar.MenuAction>
          ) : null}
          <Stack.Toolbar.MenuAction icon="link" onPress={() => void Clipboard.setStringAsync(path)}>
            Copy path
          </Stack.Toolbar.MenuAction>
          {shown ? (
            <Stack.Toolbar.MenuAction
              icon="square.and.arrow.up"
              onPress={() => void userFiles.save(shown.name, shown.bytes)}
            >
              Save or share
            </Stack.Toolbar.MenuAction>
          ) : null}
          <Stack.Toolbar.Menu inline>
            <Stack.Toolbar.MenuAction icon="arrow.clockwise" onPress={() => void file.refetch()}>
              Refresh
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      {shown ? (
        shown.text ? (
          <View style={{ flex: 1 }}>
            {shown.text.truncated ? (
              <View
                style={{
                  backgroundColor: theme.colors.card,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                }}
              >
                <Text size="body" color="mutedForeground">
                  Partial file. Preview limited to the first 1 MB.
                </Text>
              </View>
            ) : null}
            {markdown && !source ? (
              <ScrollView
                contentInsetAdjustmentBehavior="automatic"
                contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
              >
                <Markdown markdown={shown.text.text} onLink={openLink} />
              </ScrollView>
            ) : (
              <SourceText text={shown.text.text} wrap={wrap} line={fileLinkLine(path)} />
            )}
          </View>
        ) : shown.kind === "image" ? (
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            maximumZoomScale={4}
            centerContent
            contentContainerStyle={{ flexGrow: 1 }}
          >
            <Image
              source={{ uri: `data:${file.data?.mimeType};base64,${file.data?.data}` }}
              contentFit="contain"
              accessibilityLabel={shown.name}
              style={{ flex: 1, minHeight: 300 }}
            />
          </ScrollView>
        ) : (
          <Document
            name={shown.name}
            size={shown.bytes.length}
            onOpen={() => void userFiles.open(shown.name, shown.bytes)}
          />
        )
      ) : file.error ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
        >
          <EmptyState
            icon="doc.questionmark"
            title="Couldn't open this file"
            description={chatFileProblem(file.error, convo)}
          />
        </ScrollView>
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Spinner />
        </View>
      )}
    </>
  );
}

/** The file's name, and the agent whose file it is under it, as `.navigationSubtitle`. */
function FileTitle({ name, agent }: { name: string; agent: string | null }) {
  return (
    <View style={{ alignItems: "center" }} accessible accessibilityRole="header">
      <Text size="md" weight="semibold" numberOfLines={1}>
        {name}
      </Text>
      {agent ? (
        <Text size="xs" color="mutedForeground" numberOfLines={1}>
          {agent}
        </Text>
      ) : null}
    </View>
  );
}

/** A file that isn't text: a card that opens it in Quick Look. */
function Document({ name, size, onOpen }: { name: string; size: number; onOpen: () => void }) {
  const theme = useTheme();
  const extension = name.includes(".") ? (name.split(".").pop() ?? "").toUpperCase() : "";
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={name}
        style={({ pressed }) => ({
          width: 280,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          padding: 12,
          backgroundColor: theme.colors.card,
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.5 : 1,
        })}
      >
        <View
          style={{
            width: 40,
            height: 48,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: theme.radius.lg,
            backgroundColor: alpha(theme.colors.foreground, 0.07),
          }}
        >
          <Icon name="doc" size={20} color="mutedForeground" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text size="md" weight="medium" numberOfLines={1}>
            {name}
          </Text>
          <Text size="body" color="mutedForeground">
            {[extension, formatBytes(size)].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <Icon name="chevron.right" size={13} weight="semibold" color="faintForeground" />
      </Pressable>
    </View>
  );
}

/** A character's width in the mono face at 12, with room to spare, for lines that don't wrap. */
const MONO_WIDTH = 7.6;

/** A text file as it is: a line each, numbered, the one a link named marked. */
function SourceText({ text, wrap, line }: { text: string; wrap: boolean; line: number | null }) {
  const theme = useTheme();
  const screen = useWindowDimensions();
  const lines = useMemo(() => text.split("\n"), [text]);
  const gutter = String(lines.length).length * 7.5 + 12;
  const longest = useMemo(() => lines.reduce((most, l) => Math.max(most, l.length), 0), [lines]);
  const mono = { fontFamily: theme.fonts.mono };
  const list = (
    <FlashList
      data={lines}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingVertical: 10 }}
      initialScrollIndex={line ? Math.min(lines.length - 1, Math.max(0, line - 8)) : undefined}
      renderItem={({ item, index }) => (
        <View
          style={{
            flexDirection: "row",
            gap: 10,
            paddingVertical: 1.5,
            paddingRight: 14,
            backgroundColor: index + 1 === line ? alpha(theme.colors.ring, 0.1) : undefined,
          }}
        >
          <Text
            size="2xs"
            color="faintForeground"
            style={[mono, { width: gutter, textAlign: "right", paddingTop: 1 }]}
          >
            {index + 1}
          </Text>
          <Text
            size="xs"
            selectable
            numberOfLines={wrap ? undefined : 1}
            style={[mono, { flex: 1 }]}
          >
            {item || " "}
          </Text>
        </View>
      )}
    />
  );
  if (wrap) return list;
  return (
    <ScrollView horizontal contentInsetAdjustmentBehavior="automatic">
      <View
        style={{
          width: Math.max(screen.width, gutter + 10 + longest * MONO_WIDTH * screen.fontScale + 14),
        }}
      >
        {list}
      </View>
    </ScrollView>
  );
}
