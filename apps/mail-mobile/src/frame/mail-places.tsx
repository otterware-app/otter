import {
  getAccountColor,
  getAccountContrastColor,
  getAccountDisplayName,
  getAccountPicture,
} from "@otter/client/mail/account-style";
import { capabilitiesOf } from "@otter/client/mail/capabilities";
import { ALL_MAIL_LABEL_ID, folderName } from "@otter/client/mail/label-names";
import type { MailAccount, MailLabel } from "@otter/client/mail/types";
import { Avatar } from "@otter/ui-native/components/avatar";
import { Text } from "@otter/ui-native/components/text";
import { View } from "react-native";
import type { IconName } from "@otter/ui-native/components/icon";

const SYSTEM_PLACES: { id: string; icon: IconName }[] = [
  { id: "INBOX", icon: "tray" },
  { id: "STARRED", icon: "star" },
  { id: "SENT", icon: "paperplane" },
  { id: "DRAFT", icon: "doc" },
  { id: "IMPORTANT", icon: "bookmark" },
  { id: ALL_MAIL_LABEL_ID, icon: "tray.full" },
  { id: "ARCHIVE", icon: "archivebox" },
  { id: "SPAM", icon: "xmark.bin" },
  { id: "TRASH", icon: "trash" },
];

export function mailPlaces(account: MailAccount | undefined, labels: MailLabel[]) {
  const capabilities = capabilitiesOf(account);
  const known = new Map(labels.map((label) => [label.id, label]));
  const system = SYSTEM_PLACES.filter(({ id }) => {
    if (id === "INBOX" || id === "STARRED" || id === "DRAFT") return true;
    if (id === ALL_MAIL_LABEL_ID) return !capabilities.archiveFolder;
    return known.has(id);
  }).map(({ id, icon }) => ({
    id,
    icon: id === "STARRED" && !capabilities.stars ? ("flag" as const) : icon,
    title: folderName(id, capabilities) ?? id,
    label: known.get(id),
  }));
  const custom = labels.filter(
    (label) => label.type === "user" && !system.some(({ id }) => id === label.id),
  );
  const folders = custom.filter(({ id }) => !id.startsWith("category:"));
  const categories = custom.filter(({ id }) => id.startsWith("category:"));
  return {
    system,
    folders: folders.map((label) => ({
      id: label.id,
      icon: (capabilities.archiveFolder ? "folder" : "tag") as IconName,
      title: label.name,
      label,
    })),
    categories: categories.map((label) => ({
      id: label.id,
      icon: "tag" as const,
      title: label.name,
      label,
    })),
    folderTitle: capabilities.archiveFolder ? "Folders" : "Labels",
  };
}

export function MailboxAvatar({ mailbox, size = 28 }: { mailbox: MailAccount; size?: number }) {
  const color = getAccountColor(mailbox);
  return (
    <Avatar
      size={size}
      source={getAccountPicture(mailbox)}
      mark={
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size * 0.28,
            backgroundColor: color,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            weight="bold"
            style={{ color: getAccountContrastColor(color), fontSize: size * 0.6 }}
          >
            {Array.from(getAccountDisplayName(mailbox))[0]?.toUpperCase()}
          </Text>
        </View>
      }
    />
  );
}
