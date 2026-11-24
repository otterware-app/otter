import { Avatar } from "@otter/ui-native/components/avatar";
import { Text } from "@otter/ui-native/components/text";
import { View } from "react-native";

export function SenderAvatar({
  email,
  name,
  size = 36,
}: {
  email: string;
  name: string;
  size?: number;
}) {
  const address = email.trim().toLowerCase();
  let hash = 0;
  for (let index = 0; index < address.length; index++) {
    hash = (Math.imul(hash, 31) + address.charCodeAt(index)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  const darkText = hue >= 25 && hue <= 180;
  return (
    <Avatar
      size={size}
      shape="rounded"
      mark={
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size * 0.22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `hsl(${hue}, 48%, 52%)`,
          }}
        >
          <Text
            allowFontScaling={false}
            weight="medium"
            style={{ fontSize: size * 0.42, color: darkText ? "#000" : "#fff" }}
          >
            {Array.from(name || email)[0]?.toUpperCase()}
          </Text>
        </View>
      }
    />
  );
}
