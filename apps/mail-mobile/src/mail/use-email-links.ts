import { useRouter } from "expo-router";
import { Linking } from "react-native";

import { mailFailure } from "./mail-actions.tsx";

export function useEmailLinks(account: string) {
  const router = useRouter();
  return async (href: string) => {
    try {
      if (/^mailto:/i.test(href)) {
        const uri = new URL(href);
        router.push({
          pathname: "/compose",
          params: {
            account,
            to: decodeURIComponent(uri.pathname),
            cc: uri.searchParams.get("cc") ?? "",
            bcc: uri.searchParams.get("bcc") ?? "",
            subject: uri.searchParams.get("subject") ?? "",
            body: uri.searchParams.get("body") ?? "",
          },
        });
      } else if (/^(https?:\/\/|tel:|sms:)/i.test(href)) {
        await Linking.openURL(href);
      }
    } catch (error) {
      mailFailure(error);
    }
  };
}
