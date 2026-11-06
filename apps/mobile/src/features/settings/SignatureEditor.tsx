import { Button, HStack, RNHostView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { buttonStyle, font, foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import { ComposerEditor, type ComposerHandle } from "@otter-mail/mobile-composer";
import { useRef, useState } from "react";
import { View } from "react-native";

import { mailboxes, type Mailbox } from "../../state/client";
import { core } from "../../state/core";
import { cancelled, signInAgain } from "../../state/mailbox-sign-in";
import type { Palette } from "../theme";

/**
 * The Swift app's SignatureEditor: the mailbox's signature in the composer's
 * editor, saved in Gmail (when the sign-in may) or with the Otter account.
 * Compose adds it to new messages, replies and forwards.
 */
export function SignatureEditor({ colors, mailbox }: { colors: Palette; mailbox: Mailbox }) {
  const editor = useRef<ComposerHandle>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const savedIn = mailbox.capabilities?.serverSignatures ? "Gmail" : "your Otter account";

  const save = async () => {
    const written = await editor.current?.snapshot();
    if (!written) return;
    setStatus("Saving…");
    try {
      await core.invoke("gmail:updateAccount", {
        accountId: mailbox.id,
        signature: written.blank ? "" : written.html,
      });
      await mailboxes.refreshAccounts();
      const saved = (await core.invoke<Mailbox[]>("gmail:listAccounts")).find(
        (m) => m.id === mailbox.id,
      );
      const notInGmail = mailbox.provider !== "imap" && saved?.signatureInGmail === false;
      setNeedsSignIn(notInGmail && mailbox.provider !== "outlook");
      setStatus(
        notInGmail
          ? "Sign in to this account again to allow saving signatures in Gmail."
          : `Saved in ${savedIn}`,
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const allow = async () => {
    try {
      if (await signInAgain(mailbox)) {
        setNeedsSignIn(false);
        await save();
      }
    } catch (e) {
      if (!cancelled(e)) setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <VStack alignment="leading" spacing={10}>
      <RNHostView matchContents={{ vertical: true }}>
        <View style={{ height: 120 }}>
          <ComposerEditor
            ref={editor}
            placeholder="Signature"
            style={{ flex: 1 }}
            onReady={() => void editor.current?.setContent(mailbox.signature ?? "")}
            onChange={() => setStatus(null)}
          />
        </View>
      </RNHostView>
      <HStack>
        {status ? (
          <Text modifiers={[font({ textStyle: "footnote" }), foregroundStyle(colors.secondary)]}>
            {status}
          </Text>
        ) : null}
        <Spacer />
        {needsSignIn ? (
          <Button
            label="Sign in again"
            onPress={() => void allow()}
            modifiers={[buttonStyle("glass")]}
          />
        ) : null}
        <Button
          label="Save signature"
          onPress={() => void save()}
          modifiers={[buttonStyle("glass")]}
        />
      </HStack>
    </VStack>
  );
}
