import { useNotices } from "@otter/mobile/notices";
import { Toast } from "@otter/ui-native/components/toast";
import { View } from "react-native";
import Animated, { FadeInUp, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ICON = {
  info: "info.circle",
  success: "checkmark.circle",
  warning: "exclamationmark.circle",
  error: "exclamationmark.triangle",
} as const;

/** What @otter/client asks to show (an agent's question, a failure), at the top as the Swift app's notice. */
export function Notices() {
  const notices = useNotices();
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", top: insets.top + 6, left: 0, right: 0, gap: 8 }}
    >
      {notices.map((notice) => (
        <Animated.View
          key={notice.id}
          entering={FadeInUp.duration(200)}
          exiting={FadeOut.duration(200)}
        >
          <Toast
            text={notice.body ? `${notice.title} · ${notice.body}` : notice.title}
            icon={ICON[notice.tone]}
            onPress={notice.close}
            action={
              notice.action
                ? {
                    label: notice.action.label,
                    run: () => {
                      notice.action?.run();
                      notice.close();
                    },
                  }
                : undefined
            }
          />
        </Animated.View>
      ))}
    </View>
  );
}
