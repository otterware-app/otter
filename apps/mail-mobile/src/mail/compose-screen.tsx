import {
  formatAddressEntry,
  normalizeAddressList,
  parseAddressEntry,
  splitAddressList,
} from "@otter/client/mail/address";
import { signatureFor } from "@otter/client/mail/alias-mailboxes";
import { mailApi } from "@otter/client/mail/api";
import {
  useDebouncedValue,
  useMessage,
  useSendMessage,
  useSuggestContacts,
  useThread,
} from "@otter/client/mail/hooks";
import {
  computeReply,
  computeReplyAll,
  forwardBlock,
  prefixSubject,
  replyBlock,
} from "@otter/client/mail/reply";
import { addressesOf, chosenAddress, replyAddress } from "@otter/client/mail/send-from";
import type { ComposeAttachment, MailAccount, MessageDetail } from "@otter/client/mail/types";
import { draftStatus, useDraftAutosave } from "@otter/client/mail/use-draft-autosave";
import { toBase64 } from "@otter/core";
import { fileBytes } from "@otter/mobile/file-bytes";
import { showNotice } from "@otter/mobile/notices";
import { Button } from "@otter/ui-native/components/button";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Icon } from "@otter/ui-native/components/icon";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { typeStyle, useTheme } from "@otter/ui-native/theme";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { launchImageLibraryAsync } from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState, type ComponentRef } from "react";
import {
  ActionSheetIOS,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { htmlToPlain, plainToHtml } from "./compose-text.ts";
import {
  forgetDraft,
  loadRecovery,
  recoveriesKey,
  retainDraft,
  useRecoveryOwner,
  type RecoveryDraft,
  type DraftFields,
} from "./draft-recovery.ts";
import { fullMailDate } from "./format-date.ts";
import { mailFailure } from "./mail-actions.tsx";
import { useMailboxes, type Mailbox } from "./mailboxes.ts";
import { mailPointer, sendToAgent, useAgentsInstalled } from "./send-to-agent.ts";

type Fields = DraftFields;
type Mode = "reply" | "replyAll" | "forward";
type Route = Partial<Fields> & {
  account?: string;
  replyTo?: string;
  mode?: Mode;
  thread?: string;
  draft?: string;
  recovery?: string;
};

async function loadFiles(accountId: string, message: MessageDetail) {
  return Promise.all(
    message.attachments.map(async (file): Promise<ComposeAttachment> => {
      const { base64, size } = await mailApi.getAttachmentData({
        accountId,
        messageId: message.id,
        attachmentId: file.id,
      });
      return { key: file.id, name: file.filename, mimeType: file.mimeType, size, base64 };
    }),
  );
}

export function ComposeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Route>();
  const owner = useRecoveryOwner();
  const { mailboxes, isPending } = useMailboxes();
  const recovery = useQuery({
    queryKey: ["mail:recovery", owner, params.recovery],
    enabled: Boolean(owner && params.recovery),
    queryFn: () => loadRecovery(owner!, params.recovery!),
    staleTime: 0,
  });
  const recovered = recovery.data?.record;
  const mailbox = recovered
    ? (mailboxes.find(
        ({ account, look }) =>
          (account.id === recovered.sender.id ||
            account.email.toLowerCase() === recovered.sender.id) &&
          look.id === recovered.account,
      ) ??
      mailboxes.find(
        ({ account, alias }) =>
          !alias &&
          (account.id === recovered.sender.id ||
            account.email.toLowerCase() === recovered.sender.id),
      ))
    : (mailboxes.find(({ look }) => look.id === params.account) ??
      mailboxes.find(({ enabled }) => enabled));
  const accountId = mailbox?.account.id ?? null;
  const detail = useMessage(accountId, params.draft ?? params.replyTo ?? null);
  const thread = useThread(
    params.draft || recovery.data ? accountId : null,
    params.thread ?? recovery.data?.record.anchor.threadId ?? null,
  );
  const setup = useQuery({
    queryKey: ["mobile:compose", accountId, params.draft, params.mode, detail.data?.id],
    enabled: Boolean(accountId && detail.data && (params.draft || params.mode === "forward")),
    queryFn: async () => {
      const message = detail.data!;
      const [draft, files] = await Promise.all([
        params.draft ? mailApi.getDraftForMessage(accountId!, message.id, message.threadId) : null,
        loadFiles(accountId!, message),
      ]);
      return { draft, files };
    },
    retry: false,
    staleTime: Infinity,
  });
  if (
    isPending ||
    owner === null ||
    (params.recovery && recovery.isPending) ||
    ((params.draft || params.replyTo) && detail.isPending) ||
    (params.draft && params.thread && thread.isPending) ||
    (setup.fetchStatus === "fetching" && !setup.data)
  ) {
    return (
      <View style={styles.center}>
        <Spinner />
      </View>
    );
  }
  if (
    !mailbox ||
    ((params.draft || params.replyTo) && !detail.data) ||
    setup.isError ||
    (params.recovery && !recovery.data)
  ) {
    return (
      <EmptyState
        icon="square.and.pencil"
        title="Couldn't open the composer"
        description={recovery.error?.message ?? setup.error?.message ?? detail.error?.message}
        actions={<Button title="Close" onPress={() => router.back()} />}
      />
    );
  }
  const source = detail.data ?? null;
  const earlier =
    params.draft || recovery.data
      ? thread.data?.findLast((message) => !message.labelIds.includes("DRAFT"))
      : undefined;
  return (
    <Composer
      key={`${accountId}:${params.recovery ?? source?.id ?? "new"}`}
      {...{ params, mailbox, source, earlier }}
      setup={setup.data}
      owner={owner}
      recovery={recovery.data}
    />
  );
}

function Composer({
  params,
  mailbox,
  source,
  earlier,
  setup,
  owner: activeOwner,
  recovery,
}: {
  params: Route;
  mailbox: Mailbox;
  source: MessageDetail | null;
  earlier?: { id: string; threadId: string };
  setup?: { draft: { draftId: string | null; gone?: true } | null; files: ComposeAttachment[] };
  owner: string | null;
  recovery?: { record: RecoveryDraft; files: ComposeAttachment[] } | null;
}) {
  const router = useRouter();
  const theme = useTheme();
  const queries = useQueryClient();
  const [draftOwner] = useState(activeOwner);
  const owner = draftOwner === activeOwner ? activeOwner : null;
  const agents = useAgentsInstalled();
  const { mailboxes } = useMailboxes();
  const send = useSendMessage();
  const original = mailbox.account;
  const restored = recovery?.record;
  const editing = Boolean((params.draft && source) || restored);
  const replying = Boolean(params.replyTo && source && params.mode !== "forward");
  const forwarding = params.mode === "forward" && source;
  const initialFrom =
    restored?.sender.address ??
    (editing
      ? source!.fromEmail
      : replying
        ? replyAddress(original, source!, mailbox.alias)
        : (mailbox.alias ?? original.email));
  const signature = (account: MailAccount, address: string) => {
    const text = htmlToPlain(signatureFor(account, address) ?? "");
    return text ? `\n\n${text}` : "";
  };
  const [sender, setSender] = useState({ id: original.id, address: initialFrom });
  const fromAccount =
    mailboxes.find(({ account }) => account.id === sender.id)?.account ?? original;
  const from = chosenAddress(fromAccount, sender.address, fromAccount.email);
  const [fields, setFields] = useState<Fields>(() => {
    if (restored) return restored.fields;
    if (editing) return fieldsOf(source!);
    const reply = replying
      ? (params.mode === "replyAll" ? computeReplyAll : computeReply)(
          source!,
          addressesOf(original),
        )
      : undefined;
    return {
      to: reply?.to ?? params.to ?? "",
      cc: reply?.cc ?? params.cc ?? "",
      bcc: params.bcc ?? "",
      subject: replying
        ? prefixSubject("Re", source!.subject)
        : forwarding
          ? prefixSubject("Fwd", source.subject)
          : (params.subject ?? ""),
      body:
        (params.body ?? "") +
        signature(original, initialFrom) +
        (forwarding
          ? forwardBlock(source, htmlToPlain, fullMailDate)
          : replying
            ? replyBlock(source!, htmlToPlain, fullMailDate)
            : ""),
    };
  });
  const [remoteHtml, setRemoteHtml] = useState(() => ({
    text: restored?.fields.body ?? (editing ? fieldsOf(source!).body : ""),
    html: restored?.bodyHtml ?? (editing ? source?.bodyHtml : null),
  }));
  const [files, setFiles] = useState(recovery?.files ?? setup?.files ?? []);
  const [showCc, setShowCc] = useState(Boolean(fields.cc));
  const [showBcc, setShowBcc] = useState(Boolean(fields.bcc));
  const [picking, setPicking] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string>();
  const [recoveryId] = useState(() => restored?.id ?? crypto.randomUUID());
  const [localSaved, setLocalSaved] = useState(Boolean(restored));
  const storedCopy = useRef(Boolean(restored));
  const threadId =
    restored?.anchor.threadId ??
    (replying || editing ? (params.thread ?? source?.threadId) : undefined);
  const reply =
    restored?.reply ??
    (replying && source ? { id: source.id, threadId: source.threadId } : earlier);
  const bodyHtml =
    remoteHtml.html && fields.body === remoteHtml.text ? remoteHtml.html : plainToHtml(fields.body);
  const payload = {
    from: from.address,
    to: normalizeAddressList(fields.to),
    cc: normalizeAddressList(fields.cc) || undefined,
    bcc: normalizeAddressList(fields.bcc) || undefined,
    subject: fields.subject,
    body: fields.body,
    bodyHtml,
    attachments: files,
  };
  const signal = JSON.stringify([
    sender,
    fields,
    files.map(({ key, name, size }) => [key, name, size]),
  ]);
  const [initialSignal] = useState(signal);
  const dirty = Boolean(restored) || initialSignal !== signal;
  const previous = restored?.anchor;
  const legacyMessageId = previous?.draftId ? null : previous?.messageId;
  const legacyDraft = useQuery({
    queryKey: ["mobile:legacy-draft", original.id, legacyMessageId],
    enabled: Boolean(legacyMessageId && !original.signedOut),
    queryFn: () => mailApi.getDraftForMessage(original.id, legacyMessageId!, previous?.threadId),
  });
  const needsLegacyDraft = Boolean(legacyMessageId && !legacyDraft.data);
  const draft = useDraftAutosave({
    accountId: sender.id,
    threadId,
    signal,
    getPayload: () => payload,
    seeded: true,
    initialDraftId: previous?.draftId ?? legacyDraft.data?.draftId ?? setup?.draft?.draftId,
    initialGone: legacyDraft.data?.gone ?? setup?.draft?.gone,
    initialMessageId: previous?.messageId ?? (editing ? source?.id : undefined),
    initialRevision: previous?.revision ?? (editing ? source?.draftRevision : undefined),
    initialSessionKey: restored?.anchor.sessionKey,
    initialDirty: Boolean(restored),
    autosave: false,
    onRemoteChange: async (next) => {
      const nextFiles = await loadFiles(sender.id, next);
      const nextFields = fieldsOf(next);
      setSender({ id: sender.id, address: next.fromEmail });
      setFields(nextFields);
      setRemoteHtml({ text: nextFields.body, html: next.bodyHtml });
      setShowCc(Boolean(next.cc));
      setShowBcc(Boolean(next.bcc));
      setFiles(nextFiles);
    },
  });
  const bodyInput = useRef<ComponentRef<typeof TextInput>>(null);
  const positioned = useRef(false);
  const [focusBody] = useState(Boolean(fields.to));

  useEffect(() => {
    if (!focusBody) return;
    positioned.current = true;
    bodyInput.current?.setSelection(0, 0);
    bodyInput.current?.focus();
  }, [focusBody]);

  async function saveRecovery() {
    if (!owner) throw new Error("Draft recovery is still loading. Keep this message open.");
    storedCopy.current = true;
    await retainDraft(
      owner,
      {
        id: recoveryId,
        account: sender.id === mailbox.account.id ? mailbox.look.id : sender.id,
        sender,
        fields,
        bodyHtml,
        anchor: needsLegacyDraft && previous ? previous : draft.anchor(sender.id),
        reply,
        mode: restored?.mode ?? params.mode,
        updated: Date.now(),
      },
      files,
    );
    setLocalSaved(true);
    void queries.invalidateQueries({ queryKey: recoveriesKey(owner) });
  }

  async function clearRecovery() {
    if (!owner || !storedCopy.current) return;
    storedCopy.current = false;
    await forgetDraft(owner, recoveryId);
    setLocalSaved(false);
    void queries.invalidateQueries({ queryKey: recoveriesKey(owner) });
  }

  const recordEdits = useEffectEvent(() => {
    if (!owner || finishing || picking) return;
    void (dirty ? saveRecovery() : clearRecovery()).catch(mailFailure);
  });

  useEffect(() => {
    if (!owner || finishing || picking || (!dirty && !storedCopy.current)) return;
    const timer = setTimeout(recordEdits, 200);
    return () => clearTimeout(timer);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The payload and its server checkpoint drive writes. The event reads both from the latest render.
  }, [dirty, owner, signal, draft.saveState, finishing, picking]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") recordEdits();
    });
    return () => subscription.remove();
  }, []);
  const status = localSaved && !draft.isSaved() ? "Saved on this iPhone" : draftStatus(draft);
  const busy = finishing || picking;
  const validRecipients = (value: string) =>
    splitAddressList(value).every((entry) =>
      /^[^\s@<>]+@[^\s@<>]+$/.test(parseAddressEntry(entry).email),
    );
  const canSend =
    !busy &&
    !from.unavailable &&
    !fromAccount.signedOut &&
    !draft.remote &&
    !needsLegacyDraft &&
    Boolean(payload.to || payload.cc || payload.bcc) &&
    [payload.to, payload.cc ?? "", payload.bcc ?? ""].every(validRecipients) &&
    Boolean(fields.subject.trim() || fields.body.trim() || files.length);
  const senderChoices = (
    editing || replying
      ? [original]
      : [
          ...new Map(
            mailboxes
              .filter(({ enabled, account }) => enabled && !account.signedOut)
              .map(({ account }) => [account.id, account]),
          ).values(),
        ]
  ).flatMap((account) => addressesOf(account).map((address) => ({ account, address })));

  function chooseSender() {
    const options = senderChoices.map(({ address }) => address);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: "Send from", options: [...options, "Cancel"], cancelButtonIndex: options.length },
      (index) => {
        const chosen = senderChoices[index];
        if (!chosen) return;
        const prior = signature(fromAccount, from.address);
        const next = signature(chosen.account, chosen.address);
        if (!editing && !forwarding) {
          setFields((current) => ({
            ...current,
            body:
              prior && current.body.endsWith(prior)
                ? current.body.slice(0, -prior.length) + next
                : !prior
                  ? current.body + next
                  : current.body,
          }));
        }
        setSender({ id: chosen.account.id, address: chosen.address });
      },
    );
  }

  async function sendNow() {
    if (!canSend) return;
    setFinishing(true);
    setError(undefined);
    try {
      await draft.finalize();
      const result = await send.mutateAsync({
        ...payload,
        ...draft.sending(sender.id),
        accountId: sender.id,
        threadId: reply?.threadId ?? (restored?.mode === "reply" ? threadId : undefined),
        replyToMessageId: reply?.id,
      });
      if (result.uncertain)
        showNotice({ title: "Check Sent before trying again", tone: "warning" });
      else if (!result.ok && !result.pending) throw new Error("Couldn't send this message.");
      await clearRecovery().catch(mailFailure);
      router.back();
    } catch (cause) {
      draft.reopen();
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setFinishing(false);
    }
  }

  async function addFiles(source: "files" | "photos") {
    setPicking(true);
    setError(undefined);
    try {
      let size = files.reduce((total, file) => total + file.size, 0);
      if (source === "photos") {
        const result = await launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsMultipleSelection: true,
          selectionLimit: 10,
        });
        if (result.canceled) return;
        for (const asset of result.assets) {
          const limit = 25 * 1024 * 1024;
          const oversized = "Attachments can't exceed 25 MB in total.";
          if (asset.fileSize && size + asset.fileSize > limit) throw new Error(oversized);
          const bytes = await fileBytes(asset.uri);
          size += bytes.byteLength;
          if (size > limit) throw new Error(oversized);
          const key = crypto.randomUUID();
          const extension = /\.([\da-z]+)$/i.exec(asset.uri)?.[1] ?? "jpg";
          const name = asset.fileName || `Photo-${key.slice(0, 8)}.${extension}`;
          const file = {
            key,
            name,
            mimeType: asset.mimeType ?? "image/jpeg",
            size: bytes.byteLength,
            base64: toBase64(bytes),
          };
          setFiles((current) => [...current, file]);
        }
        return;
      }
      const result = await mailApi.pickAttachments(size);
      setFiles((current) => [
        ...current,
        ...result.attachments.map((file) => ({ ...file, key: file.key ?? crypto.randomUUID() })),
      ]);
      if (result.error) setError(result.error);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPicking(false);
    }
  }

  function close() {
    if (!dirty) return router.back();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Keep this message?",
        options: ["Save to Drafts", "Keep on This iPhone", "Delete Draft", "Cancel"],
        destructiveButtonIndex: 2,
        cancelButtonIndex: 3,
      },
      (choice) => {
        if (choice === 0 || choice === 1 || choice === 2) void finishClose(choice);
      },
    );
  }

  async function finishClose(choice: 0 | 1 | 2) {
    setFinishing(true);
    try {
      if (choice !== 1 && needsLegacyDraft) {
        void legacyDraft.refetch();
        throw new Error(
          "Couldn't check this draft on the mail server. Keep it on this iPhone or try again.",
        );
      }
      if (choice === 0) {
        if (!(await draft.flush()))
          throw new Error("Couldn't save this draft. Try again or keep it on this iPhone.");
        await clearRecovery().catch(mailFailure);
      } else if (choice === 1) {
        await draft.finalize();
        await saveRecovery();
      } else {
        await draft.finalize({ deleteDraft: true });
        await clearRecovery().catch(mailFailure);
      }
      router.back();
    } catch (cause) {
      draft.reopen();
      setFinishing(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function handoff() {
    if (!(await draft.flush())) return;
    const saved = await draft.savedDraft();
    if (!saved) return;
    try {
      const detail = await mailApi.getMessage(saved.accountId, saved.messageId);
      if (detail) sendToAgent([mailPointer(fromAccount.email, detail)]);
    } catch (cause) {
      mailFailure(cause);
    }
  }

  const inputStyle = [typeStyle(theme, "lg"), { color: theme.colors.foreground }];
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.content}
    >
      <Stack.Screen
        options={{
          title: editing ? "Draft" : replying ? "Reply" : forwarding ? "Forward" : "New message",
          gestureEnabled: !dirty && !busy,
          headerBackVisible: false,
          headerShadowVisible: false,
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon="xmark"
          tintColor={theme.colors.primary}
          accessibilityLabel="Close"
          disabled={busy}
          onPress={close}
        />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        {agents && (editing || draft.saveState === "saved") ? (
          <Stack.Toolbar.Button
            icon="sparkles"
            accessibilityLabel="Send to agent"
            disabled={busy || needsLegacyDraft}
            onPress={() => void handoff()}
          />
        ) : null}
        <Stack.Toolbar.Button
          icon="arrow.up"
          accessibilityLabel="Send"
          variant={canSend ? "prominent" : "plain"}
          tintColor={canSend ? theme.colors.primary : theme.colors.canvas}
          disabled={busy}
          onPress={() => void sendNow()}
        />
      </Stack.Toolbar>
      <View style={[styles.field, { borderColor: theme.colors.border }]}>
        <Text size="lg" color="mutedForeground" style={[styles.fieldLabel, styles.fromLabel]}>
          From
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`From, ${from.address}`}
          onPress={chooseSender}
          disabled={senderChoices.length < 2 || busy}
          style={styles.sender}
        >
          <Text
            size="lg"
            style={{ flexShrink: 1 }}
            numberOfLines={1}
            color={from.unavailable ? "error" : "foreground"}
          >
            {from.address}
          </Text>
          {senderChoices.length > 1 && (
            <Icon name="chevron.up.chevron.down" size={10} color="mutedForeground" />
          )}
        </Pressable>
      </View>
      <RecipientField
        title="To"
        value={fields.to}
        change={(to) => setFields((current) => ({ ...current, to }))}
        disabled={busy}
      />
      {showCc && (
        <RecipientField
          title="Cc"
          value={fields.cc}
          change={(cc) => setFields((current) => ({ ...current, cc }))}
          disabled={busy}
        />
      )}
      {showBcc && (
        <RecipientField
          title="Bcc"
          value={fields.bcc}
          change={(bcc) => setFields((current) => ({ ...current, bcc }))}
          disabled={busy}
        />
      )}
      {(!showCc || !showBcc) && (
        <View style={styles.accessories}>
          {!showCc && (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setShowCc(true)}>
              <Text size="md" color="mutedForeground">
                Cc
              </Text>
            </Pressable>
          )}
          {!showBcc && (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setShowBcc(true)}>
              <Text size="md" color="mutedForeground">
                Bcc
              </Text>
            </Pressable>
          )}
        </View>
      )}
      <TextInput
        accessibilityLabel="Subject"
        placeholder="Subject"
        placeholderTextColor={theme.colors.mutedForeground}
        value={fields.subject}
        onChangeText={(subject) => setFields((current) => ({ ...current, subject }))}
        editable={!busy}
        multiline
        scrollEnabled={false}
        style={[
          typeStyle(theme, "2xl", "semibold"),
          { color: theme.colors.foreground, paddingTop: 12, paddingBottom: 10 },
        ]}
      />
      <TextInput
        ref={bodyInput}
        onFocus={() => {
          if (positioned.current) return;
          positioned.current = true;
          bodyInput.current?.setSelection(0, 0);
        }}
        accessibilityLabel="Message"
        placeholder="Message"
        placeholderTextColor={theme.colors.mutedForeground}
        value={fields.body}
        onChangeText={(body) => setFields((current) => ({ ...current, body }))}
        selectionColor={theme.colors.primary}
        editable={!busy}
        multiline
        scrollEnabled={false}
        style={[inputStyle, styles.body]}
      />
      {files.length > 0 && (
        <View style={styles.attachments}>
          {files.map((file, index) => (
            <View
              key={file.key ?? index}
              style={[styles.file, { backgroundColor: theme.colors.card }]}
            >
              <Pressable
                accessibilityRole="button"
                style={styles.fileName}
                onPress={() => void mailApi.openComposeAttachment(file).catch(mailFailure)}
              >
                <Icon name="paperclip" size={14} />
                <Text size="sm" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {file.name}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${file.name}`}
                disabled={busy}
                onPress={() => setFiles((current) => current.filter((_, at) => at !== index))}
                style={styles.remove}
              >
                <Icon name="xmark" size={12} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <View style={styles.attachmentActions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={styles.attachmentAction}
          onPress={() => void addFiles("files")}
        >
          <Icon name="paperclip" size={17} />
          <Text size="md">Files</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={styles.attachmentAction}
          onPress={() => void addFiles("photos")}
        >
          <Icon name="photo" size={15} />
          <Text size="md">Photos</Text>
        </Pressable>
        {picking && <Spinner />}
      </View>
      {status && (
        <Text size="body" color="mutedForeground" accessibilityLiveRegion="polite">
          {status}
        </Text>
      )}
      {draft.remote?.kind === "conflict" && (
        <View style={{ gap: 8 }}>
          <Text size="sm">This draft was edited on another device.</Text>
          <View style={styles.footer}>
            <Button title="Use their version" size="sm" onPress={draft.takeTheirs} />
            <Button title="Keep mine" size="sm" onPress={draft.keepMine} />
          </View>
        </View>
      )}
      {draft.remote?.kind === "gone" && (
        <Button title="Save as a new draft" variant="outline" onPress={draft.saveAsNew} />
      )}
      {error && (
        <Text color="error" size="sm" accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
    </ScrollView>
  );
}

function fieldsOf(detail: MessageDetail): Fields {
  return {
    to: detail.to,
    cc: detail.cc ?? "",
    bcc: detail.bcc ?? "",
    subject: detail.subject,
    body: detail.bodyText ?? htmlToPlain(detail.bodyHtml ?? ""),
  };
}

function RecipientField({
  title,
  value,
  change,
  disabled,
}: {
  title: string;
  value: string;
  change: (value: string) => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [input, setInput] = useState("");
  const entry = input && (value === input || value.endsWith(`, ${input}`)) ? input : "";
  const recipients = [
    ...new Map(
      splitAddressList(entry ? value.slice(0, -entry.length) : value).map((address) => [
        parseAddressEntry(address).email.toLowerCase(),
        address,
      ]),
    ).values(),
  ];
  const needle = useDebouncedValue(entry.trim(), 220);
  const contacts = useSuggestContacts(
    needle,
    focused && needle.length > 1 && !needle.includes("<"),
  );

  function changeEntry(next: string) {
    const complete =
      /,\s*$/.test(next) &&
      !splitAddressList(next).some((token) => !parseAddressEntry(token).email.includes("@"));
    setInput(complete ? "" : next);
    change([...recipients, next].filter(Boolean).join(", "));
  }

  return (
    <View>
      <View style={[styles.field, styles.recipientField, { borderColor: theme.colors.border }]}>
        <Text size="lg" color="mutedForeground" style={[styles.fieldLabel, { marginTop: 10 }]}>
          {title}
        </Text>
        <View style={{ flex: 1 }}>
          {recipients.length > 0 && (
            <View style={styles.recipientChips}>
              {recipients.map((recipient, index) => {
                const { name, email } = parseAddressEntry(recipient);
                return (
                  <Pressable
                    key={email.toLowerCase()}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${name || email}`}
                    disabled={disabled}
                    onPress={() =>
                      change(
                        [...recipients.filter((_, at) => at !== index), entry]
                          .filter(Boolean)
                          .join(", "),
                      )
                    }
                    style={[styles.recipientChip, { borderColor: theme.colors.border }]}
                  >
                    <Text size="md" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {name || email}
                    </Text>
                    <Icon name="xmark" size={10} weight="bold" />
                  </Pressable>
                );
              })}
            </View>
          )}
          <TextInput
            accessibilityLabel={title}
            placeholder="Add recipient"
            placeholderTextColor={theme.colors.mutedForeground}
            value={entry}
            onChangeText={changeEntry}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              if (parseAddressEntry(entry).email.includes("@")) setInput("");
            }}
            onSubmitEditing={() => {
              if (parseAddressEntry(entry).email.includes("@")) setInput("");
            }}
            submitBehavior="submit"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="done"
            autoFocus={title === "To" && !value}
            editable={!disabled}
            style={[
              typeStyle(theme, "lg"),
              { color: theme.colors.foreground, minHeight: 40, paddingVertical: 9 },
            ]}
          />
        </View>
      </View>
      {focused &&
        needle === entry.trim() &&
        needle.length > 1 &&
        contacts.data?.slice(0, 4).map((contact) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${contact.name}, ${contact.email}`}
            key={contact.email}
            style={[styles.contact, { borderColor: theme.colors.border }]}
            onPress={() => {
              change([...recipients, formatAddressEntry(contact.name, contact.email)].join(", "));
              setInput("");
            }}
          >
            <Text size="base">{contact.name || contact.email}</Text>
            {contact.name && (
              <Text color="mutedForeground" size="sm">
                {contact.email}
              </Text>
            )}
          </Pressable>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingBottom: 38, gap: 8 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fieldLabel: { width: 54 },
  fromLabel: { marginBottom: 8 },
  recipientField: { alignItems: "flex-start", minHeight: 48, paddingBottom: 6 },
  recipientChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 },
  recipientChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: "100%",
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  sender: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
  },
  accessories: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  body: { minHeight: 220, lineHeight: 24, textAlignVertical: "top", padding: 0, marginTop: -11 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 9 },
  attachmentActions: { flexDirection: "row", alignItems: "center", gap: 20, marginTop: -4 },
  attachmentAction: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 10 },
  attachments: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  file: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 10,
    borderRadius: 9,
  },
  fileName: { flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 7, minHeight: 44 },
  remove: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  contact: {
    marginLeft: 53,
    paddingVertical: 7,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
