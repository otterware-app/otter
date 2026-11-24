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
  const [r, g, b] = [5, 3, 1].map((channel) => {
    const k = (channel + hue / 60) % 6;
    const value = 0.75 * (1 - 0.614 * Math.max(0, Math.min(k, 4 - k, 1)));
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const darkText = r * 0.2126 + g * 0.7152 + b * 0.0722 > 0.179;
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
