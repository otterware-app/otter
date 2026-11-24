import type { AgentSettingsControls } from "@otter/mobile/extension-kit";
import { Button } from "@otter/ui-native/components/button";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Glass } from "@otter/ui-native/components/glass";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { useTheme } from "@otter/ui-native/theme";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { Linking, Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type Scanning = Parameters<AgentSettingsControls["scan"]>[0];

/**
 * OpenClawScanner.swift: the camera over the whole screen, reading QR codes until one is taken,
 * with what to point it at (or why that one isn't it) at the bottom.
 */
export function QRScanner({
  scanning,
  onScanned,
  onCancel,
}: {
  scanning: Scanning | null;
  onScanned: (code: string) => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      visible={scanning !== null}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onCancel}
    >
      {scanning ? <Camera scanning={scanning} onScanned={onScanned} onCancel={onCancel} /> : null}
    </Modal>
  );
}

function Camera({
  scanning,
  onScanned,
  onCancel,
}: {
  scanning: Scanning;
  onScanned: (code: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, ask] = useCameraPermissions();
  const [invalid, setInvalid] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void ask();
  }, [permission, ask]);

  const denied = permission !== null && !permission.granted && !permission.canAskAgain;
  const shown =
    problem ??
    (denied
      ? "Allow camera access to scan a QR code, or paste a setup code on the previous screen."
      : null);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.canvas }}>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 8,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Text
          size="lg"
          weight="semibold"
          accessibilityRole="header"
          style={{ position: "absolute", left: 0, right: 0, bottom: 18, textAlign: "center" }}
        >
          Scan QR code
        </Text>
        <Button title="Cancel" variant="glass" onPress={onCancel} />
      </View>
      {shown ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <EmptyState
            icon="camera"
            title="Camera unavailable"
            description={shown}
            actions={
              denied ? (
                <Button title="Open Settings" onPress={() => void Linking.openSettings()} />
              ) : undefined
            }
          />
        </View>
      ) : permission?.granted ? (
        <View style={{ flex: 1 }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onMountError={() =>
              setProblem("Couldn't start the camera. Try again or paste a setup code.")
            }
            onBarcodeScanned={({ data }) => {
              if (done.current) return;
              if (!scanning.accepts(data)) return setInvalid(true);
              done.current = true;
              onScanned(data);
            }}
          />
          <Glass
            shape={{ radius: 20 }}
            style={{
              position: "absolute",
              left: 20,
              right: 20,
              bottom: insets.bottom + 20,
              padding: 20,
            }}
          >
            <Text size="md" weight="medium" style={{ textAlign: "center" }}>
              {invalid ? scanning.invalid : scanning.prompt}
            </Text>
          </Glass>
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Spinner />
        </View>
      )}
    </View>
  );
}
