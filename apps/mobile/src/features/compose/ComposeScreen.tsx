import { useAtomValue } from "@effect/atom-react";
import {
  ComposerEditor,
  type ComposerChange,
  type ComposerHandle,
} from "@otter-mail/mobile-composer";
import { files, type PickedFile } from "@otter-mail/mobile-files";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { RootStack } from "../../App";
import { clientPlatform, mailboxes, threadLists } from "../../state/client";
import { core } from "../../state/core";
import { localCopies } from "../../state/local-drafts";
import type { MessageDetail } from "../../state/mail";
import { useKeyboardInset } from "../keyboard";
import { usePalette } from "../theme";
import { AttachmentChip, listedAttachments } from "../thread/MessageView";
import { splitAddresses } from "../thread/reader";
import {
  ATTACHMENT_LIMIT,
  emailOf,
  prefixed,
  plainHtml,
  quoted,
  replyRecipients,
  senders as sendersOf,
  signatureFor,
  totalSize,
  validRecipient,
  type Sender,
} from "./compose";
import { RecipientField } from "./RecipientField";

type Props = NativeStackScreenProps<RootStack, "Compose">;

type SaveResult =
  | { draftId: string; messageId?: string; threadId?: string }
  | { conflict: true; draftId: string; messageId: string }
  | { gone: true; draftId: string };

/** A file on the draft; a forwarded or resumed one fills in its bytes as they arrive. */
type Attachment = {
  key: string;
  name: string;
  mimeType: string;
  size: number;
  base64?: string;
  /** A file of another message (a forward, a resumed draft), fetched by id. */
  source?: { messageId: string; attachmentId: string };
  failed?: boolean;
};

const AUTOSAVE_MS = 2000;

/**
 * Writing a message (the Swift app's ComposeView): From (the mailbox and its
 * aliases), To, Cc and Bcc as chips with contacts, the subject, and the web
 * composer's editor (TipTap, otter-composer) with the From's signature; files
 * from Files and Photos (25 MB in all), a forward's own carried along. Saved
 * as a draft as it's written (core's draft session), sent through core's
 * outgoing path. Closing asks where it goes: Drafts, this iPhone, or away.
 */
export function ComposeScreen({ navigation, route }: Props) {
  const colors = usePalette();
  const keyboard = useKeyboardInset();
  const { mode = "new", messageId, copyId: openedCopy } = route.params;
  const accounts = useAtomValue(mailboxes.accountsAtom).value;
  const editor = useRef<ComposerHandle>(null);
  const sessionKey = useRef(clientPlatform.newId()).current;
  const [accountId, setAccountId] = useState(route.params.accountId);
  const [address, setAddress] = useState<string | null>(null);
  const [to, setTo] = useState(route.params.to ?? "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState<ComposerChange>({ html: "", text: "", blank: true });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [threadId, setThreadId] = useState(
    mode === "forward" || mode === "new" ? undefined : route.params.threadId,
  );
  const [draftId, setDraftId] = useState<string | undefined>();
  const [copyId, setCopyId] = useState(openedCopy);
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [importing, setImporting] = useState(false);
  const edited = useRef(false);
  /** Changes the editor reports for what the app did (content, signature), not the user. */
  const ownChanges = useRef(0);

  const account = accounts.find((m) => m.id === accountId);
  const from = address ?? account?.email.toLowerCase() ?? "";
  const senders = useMemo(
    () => sendersOf(accounts, accountId, mode === "new" || mode === "copy"),
    [accounts, accountId, mode],
  );
  const recipients = useMemo(
    () =>
      new Set(
        [to, cc, bcc].flatMap(splitAddresses).map((e) => emailOf(e).toLowerCase()),
      ) as ReadonlySet<string>,
    [to, cc, bcc],
  );
  const mine = useMemo(
    () =>
      new Set(
        [account?.email ?? accountId, ...(account?.sendAs ?? [])].map((a) => a.toLowerCase()),
      ),
    [account, accountId],
  );
  const loading = attachments.some((a) => a.base64 === undefined);

  const quietly = async (run: () => Promise<void> | undefined) => {
    ownChanges.current++;
    await run();
  };

  /**
   * Fetches a carried file's bytes. One that fails stays, marked, and holds
   * back saving and sending until it's retried or removed: a draft never loses
   * a file to a network error.
   */
  const fetchAttachment = (key: string, source: NonNullable<Attachment["source"]>) => {
    const update = (patch: Partial<Attachment>) =>
      setAttachments((all) => all.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    update({ failed: false });
    void core.invoke<{ base64: string }>("gmail:getAttachmentData", { accountId, ...source }).then(
      ({ base64 }) => update({ base64 }),
      () => update({ failed: true }),
    );
  };

  /** The bytes of a message's files, for a forward or a resumed draft. */
  const carry = (message: MessageDetail) => {
    const list = listedAttachments(message).map((a) => ({
      key: a.id,
      name: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      source: { messageId: message.id, attachmentId: a.id },
    }));
    setAttachments(list);
    for (const a of list) fetchAttachment(a.key, a.source);
  };

  const onReady = async () => {
    const signature = account ? signatureFor(account, from) : null;
    if (mode === "copy" && openedCopy) {
      const copy = await localCopies.get(accountId, openedCopy);
      if (!copy) return;
      if (copy.from) setAddress(copy.from.toLowerCase());
      setTo(copy.to);
      setCc(copy.cc ?? "");
      setBcc(copy.bcc ?? "");
      setShowCc(Boolean(copy.cc));
      setShowBcc(Boolean(copy.bcc));
      setSubject(copy.subject);
      setThreadId(copy.threadId);
      setAttachments((copy.attachments ?? []).map((a, i) => ({ ...a, key: `copy:${i}` })));
      await quietly(() => editor.current?.setContent(copy.bodyHtml ?? plainHtml(copy.body)));
      return;
    }
    if (mode === "new") {
      if (signature) await quietly(() => editor.current?.setSignature(signature));
      return;
    }
    if (!messageId) return;
    const message = await core.invoke<MessageDetail>("gmail:getMessage", { accountId, messageId });
    if (mode === "draft") {
      const found = await core
        .invoke<{ draftId?: string }>("gmail:getDraftForMessage", {
          accountId,
          messageId,
          threadId: message.threadId,
        })
        .catch(() => ({ draftId: undefined }));
      setDraftId(found.draftId ?? undefined);
      const sender = message.fromEmail.toLowerCase();
      if (sender && sender !== account?.email.toLowerCase()) setAddress(sender);
      setTo(message.to);
      setCc(message.cc ?? "");
      setBcc(message.bcc ?? "");
      setShowCc(Boolean(message.cc));
      setShowBcc(Boolean(message.bcc));
      setSubject(message.subject);
      carry(message);
      await quietly(() =>
        editor.current?.setContent(message.bodyHtml ?? plainHtml(message.bodyText ?? "")),
      );
      return;
    }
    // A reply goes from the address it was sent to.
    const to_ = [message.to, message.cc ?? ""].flatMap(splitAddresses).map(emailOf);
    const own = [...mine].find((a) => to_.some((t) => t.toLowerCase() === a));
    if (own && own !== account?.email.toLowerCase()) setAddress(own);
    const date = new Date(message.date).toLocaleString();
    const who = message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail;
    if (mode === "forward") {
      setSubject(prefixed("Fwd", message.subject));
      carry(message);
      await quietly(() =>
        editor.current?.setContent(
          quoted(
            message,
            `---------- Forwarded message ---------\nFrom: ${who}\nDate: ${date}\nSubject: ${message.subject}`,
          ),
        ),
      );
    } else {
      setSubject(prefixed("Re", message.subject));
      const reply = replyRecipients(message, mine, mode === "replyAll");
      setTo(reply.to.join(", "));
      setCc(reply.cc.join(", "));
      setShowCc(reply.cc.length > 0);
      await quietly(() => editor.current?.setContent(quoted(message, `On ${date}, ${who} wrote:`)));
      await editor.current?.focus("start");
    }
    const replySignature = account ? signatureFor(account, own ?? undefined) : null;
    if (replySignature) await quietly(() => editor.current?.setSignature(replySignature));
  };

  const draft = (written: ComposerChange = body) => ({
    accountId,
    sessionKey,
    draftId,
    ...(address && address !== account?.email.toLowerCase() ? { from: address } : {}),
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    subject,
    body: written.text,
    bodyHtml: written.html,
    threadId,
    attachments: attachments.flatMap((a) =>
      a.base64 ? [{ name: a.name, mimeType: a.mimeType, size: a.size, base64: a.base64 }] : [],
    ),
  });

  /** The editor reports changes 150 ms late; Send and Save Draft take what's written now. */
  const latestDraft = async () => draft((await editor.current?.snapshot()) ?? body);

  /** Once it's a draft in the mailbox, the copy kept on this iPhone would only repeat it. */
  const dropCopy = () => {
    if (!copyId) return;
    void localCopies.remove(copyId).catch(() => {});
    setCopyId(undefined);
  };

  useEffect(() => {
    if (!edited.current || loading) return;
    const timer = setTimeout(() => {
      setStatus("Saving…");
      core
        // draft() reads the fields listed below.
        // eslint-disable-next-line react/exhaustive-effect-dependencies
        .invoke<SaveResult>("gmail:saveDraft", draft())
        .then((result) => {
          setDraftId(result.draftId);
          setStatus("gone" in result ? "Sent or deleted elsewhere" : "Saved");
          dropCopy();
        })
        .catch((e: unknown) => setStatus(`Not saved: ${String(e)}`));
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [to, cc, bcc, subject, body, attachments, address, accountId, loading]);

  const allRecipients = [to, cc, bcc].flatMap(splitAddresses);
  const canSend =
    allRecipients.length > 0 && allRecipients.every(validRecipient) && !loading && !importing;

  const send = async () => {
    if (!allRecipients.length) return Alert.alert("Add a recipient first.");
    if (!allRecipients.every(validRecipient))
      return Alert.alert("Check the recipients before sending.");
    setSending(true);
    try {
      await core.invoke("gmail:sendMessage", {
        ...(await latestDraft()),
        replyToMessageId: mode === "reply" || mode === "replyAll" ? messageId : undefined,
      });
      dropCopy();
      threadLists.invalidate(accountId);
      navigation.goBack();
    } catch (e) {
      Alert.alert("Couldn't send", e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  /** Saving now would leave out a file that hasn't loaded. */
  const attachmentsPending = () => {
    if (!loading) return false;
    Alert.alert(
      "An attachment hasn't loaded",
      "Wait for it, tap it to try again, or remove it before saving.",
    );
    return true;
  };

  /** Closes only once the draft is saved; a failed save keeps the composition open. */
  const saveAndClose = async () => {
    if (attachmentsPending()) return;
    setStatus("Saving…");
    try {
      const result = await core.invoke<SaveResult>("gmail:saveDraft", await latestDraft());
      setDraftId(result.draftId);
      dropCopy();
      navigation.goBack();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus(`Not saved: ${message}`);
      Alert.alert("Couldn't finish", message);
    }
  };

  /** the Swift app's recovery copy: on this iPhone, out of the mailbox's drafts (unless it was one already). */
  const keepHere = async () => {
    if (attachmentsPending()) return;
    const written = await latestDraft();
    try {
      await localCopies.keep({
        id: copyId ?? sessionKey,
        accountId,
        from: written.from,
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject,
        body: written.body,
        bodyHtml: written.bodyHtml,
        threadId,
        attachments: written.attachments,
      });
      if (mode !== "draft") {
        void core.invoke("gmail:deleteDraft", { accountId, draftId, sessionKey }).catch(() => {});
      }
      navigation.goBack();
    } catch (e) {
      Alert.alert("Couldn't finish", e instanceof Error ? e.message : String(e));
    }
  };

  const discard = () => {
    void core.invoke("gmail:deleteDraft", { accountId, draftId, sessionKey }).catch(() => {});
    if (copyId) void localCopies.remove(copyId).catch(() => {});
    navigation.goBack();
  };

  const close = () => {
    if (!edited.current) return navigation.goBack();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Keep this message?",
        options: ["Save to Drafts", "Keep on This iPhone", "Delete Draft", "Cancel"],
        destructiveButtonIndex: 2,
        cancelButtonIndex: 3,
      },
      (i) => {
        if (i === 0) void saveAndClose();
        else if (i === 1) void keepHere();
        else if (i === 2) discard();
      },
    );
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      gestureEnabled: !edited.current,
      headerLeft: () => (
        <Pressable
          onPress={close}
          disabled={sending || importing}
          hitSlop={10}
          accessibilityLabel="Close"
          testID="compose-close"
        >
          <SymbolView name="xmark" size={18} tintColor={colors.text} />
        </Pressable>
      ),
      headerRight: () => (
        <Pressable
          onPress={() => void send()}
          disabled={sending || !canSend}
          hitSlop={10}
          accessibilityLabel="Send"
          testID="compose-send"
        >
          {sending ? (
            <ActivityIndicator />
          ) : (
            <SymbolView
              name="arrow.up.circle.fill"
              size={30}
              tintColor={canSend ? colors.accent : colors.secondary}
            />
          )}
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

  const pickFrom = () => {
    const several = new Set(senders.map((s) => s.accountId)).size > 1;
    const label = (s: Sender) =>
      several && s.address !== s.mailbox ? `${s.address} (${s.mailbox})` : s.address;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "From",
        options: [...senders.map(label), "Cancel"],
        cancelButtonIndex: senders.length,
      },
      (i) => {
        const sender = senders[i];
        if (!sender) return;
        const mailbox = accounts.find((m) => m.id === sender.accountId);
        edited.current = true;
        setAccountId(sender.accountId);
        setAddress(sender.address === mailbox?.email.toLowerCase() ? null : sender.address);
        const signature = mailbox ? signatureFor(mailbox, sender.address) : null;
        void quietly(() => editor.current?.setSignature(signature));
      },
    );
  };

  const attach = async (pick: (remaining: number) => Promise<PickedFile[]>) => {
    setImporting(true);
    try {
      const picked = await pick(ATTACHMENT_LIMIT - totalSize(attachments));
      if (picked.length) {
        edited.current = true;
        setAttachments((all) => [
          ...all,
          ...picked.map((f) => ({ ...f, key: clientPlatform.newId() })),
        ]);
      }
    } catch (e) {
      Alert.alert("Couldn't finish", e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const tool = (symbol: SFSymbol, label: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      disabled={importing}
      style={styles.tool}
      accessibilityLabel={label}
      accessibilityRole="button"
      testID={`compose-tool-${label}`}
    >
      <SymbolView name={symbol} size={18} tintColor={colors.text} />
    </Pressable>
  );
  const recipientField = (
    label: string,
    value: string,
    set: (v: string) => void,
    focus = false,
  ) => (
    <RecipientField
      label={label}
      value={value}
      onChange={change(set)}
      accountId={accountId}
      excluded={recipients}
      colors={colors}
      autoFocus={focus}
    />
  );

  return (
    <View style={[styles.fill, { backgroundColor: colors.canvas }, { paddingBottom: keyboard }]}>
      <Pressable
        onPress={senders.length > 1 ? pickFrom : undefined}
        style={[styles.field, { borderColor: colors.border }]}
        accessibilityRole={senders.length > 1 ? "button" : "text"}
        accessibilityLabel={`From ${from}`}
        testID="compose-from"
      >
        <Text style={[styles.label, { color: colors.secondary }]}>From</Text>
        <Text style={[styles.from, { color: colors.text }]} numberOfLines={1}>
          {from}
        </Text>
        {senders.length > 1 ? (
          <SymbolView name="chevron.up.chevron.down" size={12} tintColor={colors.secondary} />
        ) : null}
      </Pressable>
      {recipientField("To", to, setTo, mode === "new" || mode === "forward")}
      {showCc || cc ? recipientField("Cc", cc, setCc) : null}
      {showBcc || bcc ? recipientField("Bcc", bcc, setBcc) : null}
      <View style={[styles.field, { borderColor: colors.border }]}>
        <TextInput
          value={subject}
          onChangeText={change(setSubject)}
          placeholder="Subject"
          placeholderTextColor={colors.secondary}
          style={[styles.subject, { color: colors.text }]}
          accessibilityLabel="Subject"
          testID="compose-subject"
        />
        {!showCc && !cc ? (
          <Pressable onPress={() => setShowCc(true)} hitSlop={6} testID="compose-show-cc">
            <Text style={[styles.more, { color: colors.secondary }]}>Cc</Text>
          </Pressable>
        ) : null}
        {!showBcc && !bcc ? (
          <Pressable onPress={() => setShowBcc(true)} hitSlop={6} testID="compose-show-bcc">
            <Text style={[styles.more, { color: colors.secondary }]}>Bcc</Text>
          </Pressable>
        ) : null}
      </View>
      <ComposerEditor
        ref={editor}
        style={styles.editor}
        onReady={() => void onReady()}
        onChange={(next) => {
          if (ownChanges.current > 0) ownChanges.current--;
          else edited.current = true;
          setBody(next);
        }}
      />
      {attachments.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.attachmentRow}
          contentContainerStyle={styles.attachments}
          keyboardShouldPersistTaps="handled"
        >
          {attachments.map((a) => (
            <AttachmentChip
              key={a.key}
              attachment={{ filename: a.name, mimeType: a.mimeType, size: a.size }}
              colors={colors}
              loading={a.base64 === undefined && !a.failed}
              failed={a.failed}
              onPress={
                a.base64
                  ? () => void files.preview(a.name, a.base64!)
                  : a.failed && a.source
                    ? () => fetchAttachment(a.key, a.source!)
                    : undefined
              }
              onRemove={() => {
                edited.current = true;
                setAttachments((all) => all.filter((x) => x.key !== a.key));
              }}
            />
          ))}
        </ScrollView>
      ) : null}
      <View style={[styles.toolbar, { borderColor: colors.border }]}>
        {tool("bold", "Bold", () => void editor.current?.command("bold"))}
        {tool("italic", "Italic", () => void editor.current?.command("italic"))}
        {tool("list.bullet", "Bulleted list", () => void editor.current?.command("bulletList"))}
        {tool("list.number", "Numbered list", () => void editor.current?.command("orderedList"))}
        {tool("text.quote", "Quote", () => void editor.current?.command("blockquote"))}
        {tool("paperclip", "Files", () => void attach(files.pickDocuments))}
        {tool("photo", "Photos", () => void attach(files.pickPhotos))}
        {importing ? <ActivityIndicator /> : null}
        <Text style={[styles.status, { color: colors.secondary }]} numberOfLines={1}>
          {status ?? ""}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 20,
    minHeight: 46,
  },
  label: { fontSize: 15, width: 44 },
  from: { flex: 1, fontSize: 16 },
  subject: { flex: 1, fontSize: 17, fontWeight: "600", paddingVertical: 10 },
  more: { fontSize: 15, paddingHorizontal: 4 },
  editor: { flex: 1 },
  attachmentRow: { flexGrow: 0 },
  attachments: { gap: 8, paddingHorizontal: 20, paddingVertical: 8 },
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
