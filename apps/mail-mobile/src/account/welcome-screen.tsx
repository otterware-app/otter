import { mailApi } from "@otter/client/mail/api";
import { useAddAccount, useMailProviders } from "@otter/client/mail/hooks";
import { otterApi, useOtterAccount } from "@otter/client/otter-account";
import { setDemo } from "@otter/mobile/demo";
import { native } from "@otter/mobile/native";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon } from "@otter/ui-native/components/icon";
import { SettingsPage } from "@otter/ui-native/components/settings";
import { Text } from "@otter/ui-native/components/text";
import { useTheme, type ColorToken } from "@otter/ui-native/theme";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { ActionSheetIOS, Alert, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ImapForm } from "./imap-form.tsx";
import mark from "./otter-mark.png";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** No mailbox yet (WelcomeView.swift): what the app is, Sign in with Google, or a mailbox without an account. */
export function WelcomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const user = useOtterAccount()?.user;
  const providers = useMailProviders().data;
  const gmail = useAddAccount();
  const outlook = useAddAccount("outlook");
  const [signingIn, setSigningIn] = useState<"otter" | "mailbox">();
  const [addingImap, setAddingImap] = useState(false);
  const [offersDemo, setOffersDemo] = useState(false);
  const busy = Boolean(signingIn) || gmail.isPending || outlook.isPending;

  useEffect(() => {
    void native.isAppStoreInstall().then((appStore) => setOffersDemo(!appStore));
  }, []);

  // As the web's Sign in with Google: the Otter account, then its own Gmail on this iPhone.
  const signIn = async () => {
    setSigningIn("otter");
    try {
      const email = (user ?? (await otterApi.signIn())?.user)?.email.toLowerCase();
      if (!email) return;
      const accounts = await mailApi.listAccounts();
      if (accounts.some((a) => a.email.toLowerCase() === email && !a.signedOut)) return;
      setSigningIn("mailbox");
      await gmail.mutateAsync(email);
    } catch (error) {
      Alert.alert("Couldn't sign in", errorMessage(error));
    } finally {
      setSigningIn(undefined);
    }
  };

  const addMailbox = () => {
    const choices = [
      { title: "Gmail", run: () => gmail.mutate(undefined, { onError: signInFailed }) },
      ...(providers?.outlook
        ? [{ title: "Outlook", run: () => outlook.mutate(undefined, { onError: signInFailed }) }]
        : []),
      { title: "IMAP", run: () => setAddingImap(true) },
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Add a mailbox",
        message: "Without an Otter account, it stays on this iPhone.",
        options: [...choices.map(({ title }) => title), "Cancel"],
        cancelButtonIndex: choices.length,
      },
      (index) => choices[index]?.run(),
    );
  };

  if (addingImap)
    return (
      <SettingsPage keyboardShouldPersistTaps="handled">
        <ImapForm onDone={() => setAddingImap(false)} />
      </SettingsPage>
    );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.canvas,
        paddingTop: insets.top,
        paddingBottom: insets.bottom + 24,
      }}
    >
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Image
          source={mark}
          accessible={false}
          style={{
            width: 112,
            height: 112,
            borderRadius: 26,
            borderCurve: "continuous",
            marginBottom: 28,
          }}
        />
        <Text
          size="3xl"
          weight="semibold"
          accessibilityRole="header"
          style={{ letterSpacing: -0.8 }}
        >
          Otter Mail
        </Text>
        <Text size="xl" color="mutedForeground" style={{ marginTop: 6 }}>
          A calm, fast mail client.
        </Text>
      </View>
      <View style={{ paddingHorizontal: 28, gap: 12 }}>
        <WelcomeButton
          title={signingIn ? "Signing in…" : "Sign in with Google"}
          icon="person.crop.circle"
          prominent
          disabled={busy}
          onPress={() => void signIn()}
        />
        {busy ? (
          <WelcomeButton
            title="Cancel"
            onPress={() =>
              void (signingIn === "otter" ? otterApi.cancelSignIn() : mailApi.cancelAddAccount())
            }
          />
        ) : (
          <>
            <WelcomeButton title="Add a mailbox without an account" onPress={addMailbox} />
            {offersDemo ? (
              <WelcomeButton title="Try the demo mailbox" onPress={() => void setDemo(true)} />
            ) : null}
          </>
        )}
        <Text size="body" color="mutedForeground" style={{ textAlign: "center", marginTop: 8 }}>
          Your mail goes straight between this iPhone and your mail provider. With an Otter account,
          your mailboxes and settings follow you to the Mac and the web.
        </Text>
      </View>
    </View>
  );
}

function signInFailed(error: unknown) {
  Alert.alert("Couldn't sign in", errorMessage(error));
}

/** A wide glass button, as the Swift welcome's `.glassProminent` and `.glass` ones. */
function WelcomeButton({
  title,
  icon,
  prominent = false,
  disabled,
  onPress,
}: {
  title: string;
  icon?: "person.crop.circle";
  prominent?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color: ColorToken = prominent ? "primaryForeground" : "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      style={{ opacity: disabled ? 0.6 : 1 }}
    >
      <Glass
        interactive
        tint={prominent ? theme.colors.primary : undefined}
        style={{
          minHeight: 50,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {icon ? <Icon name={icon} size={17} weight="semibold" color={color} /> : null}
        <Text size="lg" weight="semibold" color={color}>
          {title}
        </Text>
      </Glass>
    </Pressable>
  );
}
