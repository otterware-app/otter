import { SymbolView } from "expo-symbols";
import { Image, View } from "react-native";

import type { Mailbox } from "../../state/client";

const MICROSOFT = ["#f25022", "#7fba00", "#00a4ef", "#ffb900"];

export const isICloud = (m: Pick<Mailbox, "imap">) =>
  m.imap?.imap.host.toLowerCase() === "imap.mail.me.com";

export const providerName = (m: Pick<Mailbox, "provider" | "imap">) =>
  m.provider === "outlook"
    ? "Outlook"
    : m.provider === "imap"
      ? isICloud(m)
        ? "iCloud"
        : "IMAP"
      : "Gmail";

/** apps/ios's ProviderMark: Gmail's and Microsoft's marks, iCloud's cloud, a server for other IMAP. */
export function ProviderMark({
  mailbox,
  size = 14,
  color,
}: {
  mailbox: Pick<Mailbox, "provider" | "imap">;
  size?: number;
  color: string;
}) {
  const label = providerName(mailbox);
  if (mailbox.provider === "outlook") {
    const square = size * 0.46;
    return (
      <View
        accessible
        accessibilityLabel={label}
        style={{
          width: size,
          height: size,
          flexDirection: "row",
          flexWrap: "wrap",
          gap: size * 0.08,
        }}
      >
        {MICROSOFT.map((fill) => (
          <View key={fill} style={{ width: square, height: square, backgroundColor: fill }} />
        ))}
      </View>
    );
  }
  if (mailbox.provider === "imap") {
    return (
      <SymbolView
        name={isICloud(mailbox) ? "icloud.fill" : "server.rack"}
        size={size}
        tintColor={color}
        accessibilityLabel={label}
      />
    );
  }
  return (
    <Image
      source={require("../../../assets/gmail-mark.png")}
      style={{ width: size, height: size, resizeMode: "contain" }}
      accessibilityLabel={label}
    />
  );
}
