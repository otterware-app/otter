import { useAtomValue } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { memo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { core } from "../../state/core";

/** Core's sender picture (Contacts, Gravatar, the domain's logo; cached by core), once per sender. */
const photoAtom = Atom.family((key: string) => {
  const [accountId, email] = key.split("\u0000") as [string, string];
  return Atom.make(
    Effect.promise(() =>
      core.invoke<{ dataUrl: string | null }>("gmail:getSenderAvatar", { accountId, email }).then(
        (r) => r.dataUrl,
        () => null,
      ),
    ),
  ).pipe(Atom.keepAlive);
});

/** apps/ios's SenderAvatar: the sender's hue from their address, as the desktop draws it. */
function hue(email: string): number {
  let hash = 0;
  for (const unit of email.trim().toLowerCase())
    hash = (Math.imul(hash, 31) + unit.charCodeAt(0)) | 0;
  return ((hash % 360) + 360) % 360;
}

export const SenderAvatar = memo(function SenderAvatar({
  accountId,
  email,
  name,
  size = 36,
}: {
  accountId: string;
  email: string;
  name: string;
  size?: number;
}) {
  const photo = useAtomValue(photoAtom(`${accountId}\u0000${email.toLowerCase()}`));
  const uri = AsyncResult.getOrElse(photo, () => null);
  const radius = size * 0.22;
  return (
    <View
      style={[styles.box, { width: size, height: size, borderRadius: radius }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: radius, backgroundColor: "#FFFFFF" }}
        />
      ) : (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.initial,
            { backgroundColor: `hsl(${hue(email)}, 48%, 52%)`, borderRadius: radius },
          ]}
        >
          <Text
            allowFontScaling={false}
            style={{ color: "#FFFFFF", fontSize: size * 0.42, fontWeight: "500" }}
          >
            {(name || email).slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  box: { overflow: "hidden" },
  initial: { alignItems: "center", justifyContent: "center" },
});
