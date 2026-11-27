import { isICloud } from "@otter/client/mail/capabilities";
import type { MailAccount } from "@otter/client/mail/types";
import { Icon } from "@otter/ui-native/components/icon";
import Svg, { Path, Rect } from "react-native-svg";

// The web app's provider-mark.tsx; Gmail's from https://www.gstatic.com/apps/signup/resources/products_lockup_icon.svg
export function GmailMark({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="52 42 88 66" accessible={false}>
      <Path d="M58 108h14V74L52 59v43c0 3.315 2.685 6 6 6z" fill="#4285F4" />
      <Path d="M120 108h14c3.315 0 6-2.685 6-6V59l-20 15v34z" fill="#34A853" />
      <Path d="M120 48v26l20-15v-8c0-7.415-8.465-11.65-14.4-7.2L120 48z" fill="#FBBC04" />
      <Path
        d="M72 74V48l24 18 24-18v26L96 92 72 74z"
        fill="#EA4335"
        fillRule="evenodd"
        clipRule="evenodd"
      />
      <Path d="M52 51v8l20 15V48l-5.6-4.2C60.465 39.35 52 43.585 52 51z" fill="#C5221F" />
    </Svg>
  );
}

export function MicrosoftMark({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 21 21" accessible={false}>
      <Rect x={1} y={1} width={9} height={9} fill="#f25022" />
      <Rect x={11} y={1} width={9} height={9} fill="#7fba00" />
      <Rect x={1} y={11} width={9} height={9} fill="#00a4ef" />
      <Rect x={11} y={11} width={9} height={9} fill="#ffb900" />
    </Svg>
  );
}

/** Which service a mailbox is on: Gmail's and Microsoft's marks, iCloud's and a server's symbols. */
export function ProviderMark({
  account,
  size = 18,
}: {
  account: Pick<MailAccount, "provider" | "imap">;
  size?: number;
}) {
  const provider = account.provider ?? "gmail";
  if (provider === "gmail") return <GmailMark size={size} />;
  if (provider === "outlook") return <MicrosoftMark size={size} />;
  return isICloud(account) ? (
    <Icon name="icloud.fill" size={size} tint="#3b9cf5" />
  ) : (
    <Icon name="server.rack" size={size} color="mutedForeground" />
  );
}
