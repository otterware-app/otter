import { EmptyState } from "@otter/ui-native/components/empty-state";
import type { IconName } from "@otter/ui-native/components/icon";
import { Sheet } from "@otter/ui-native/components/sheet";
import { Stack, router } from "expo-router";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** A screen still to write: its title and a line on what it will be. */
export function Placeholder({
  title,
  line,
  icon,
}: {
  title: string;
  line: string;
  icon?: IconName;
}) {
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title }} />
      <EmptyState icon={icon} title={title} description={line} />
    </ScrollView>
  );
}

/** A sheet still to write. */
export function SheetPlaceholder({
  title,
  line,
  icon,
}: {
  title: string;
  line: string;
  icon?: IconName;
}) {
  return (
    <Sheet title={title} onCancel={() => router.back()} onDone={() => router.back()}>
      <EmptyState icon={icon} title={title} description={line} />
    </Sheet>
  );
}

/** A full-screen cover still to write: below the status bar, as a cover has no header to keep it there. */
export function CoverPlaceholder(props: { title: string; line: string; icon?: IconName }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <SheetPlaceholder {...props} />
    </View>
  );
}
