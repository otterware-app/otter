import { Alert } from "@otter/ui-native/components/alert";
import { Avatar } from "@otter/ui-native/components/avatar";
import { Badge, BadgeDot } from "@otter/ui-native/components/badge";
import { Button, IconButton, type ButtonVariant } from "@otter/ui-native/components/button";
import { Chip } from "@otter/ui-native/components/chip";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon } from "@otter/ui-native/components/icon";
import { ListRow } from "@otter/ui-native/components/list-row";
import { Separator } from "@otter/ui-native/components/separator";
import {
  SettingsButton,
  SettingsRow,
  SettingsSection,
  SettingsSwitchRow,
} from "@otter/ui-native/components/settings";
import { Sheet } from "@otter/ui-native/components/sheet";
import { Spinner } from "@otter/ui-native/components/spinner";
import { SwipeRow } from "@otter/ui-native/components/swipe-row";
import { Switch } from "@otter/ui-native/components/switch";
import { Text } from "@otter/ui-native/components/text";
import { Toast } from "@otter/ui-native/components/toast";
import { useTheme, type TypeStep, type Weight } from "@otter/ui-native/theme";
import { haptics } from "@otter/ui-native/haptics";
import { Link, Stack, router } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActionSheetIOS, Alert as SystemAlert, ScrollView, View } from "react-native";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import { EXTENSIONS } from "../agents/registry.ts";
import { HeldRow } from "../frame/held-row.tsx";

const STEPS: TypeStep[] = ["3xl", "2xl", "xl", "lg", "base", "md", "sm", "body", "xs", "2xs"];
const WEIGHTS: Weight[] = ["regular", "medium", "semibold", "bold"];
const VARIANTS: ButtonVariant[] = [
  "outline",
  "primary",
  "secondary",
  "ghost",
  "ghost-muted",
  "destructive",
  "ghost-destructive",
  "link",
  "glass",
  "glass-prominent",
];
const SWATCHES = [
  "canvas",
  "card",
  "surfaceRaised",
  "foreground",
  "mutedForeground",
  "faintForeground",
  "border",
  "primary",
  "error",
  "warning",
  "successForeground",
  "infoForeground",
] as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text size="sm" weight="medium" color="mutedForeground" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
      {children}
    </View>
  );
}

/** Every @otter/ui-native component in its variants, for checking them in light and dark. */
export function GalleryScreen() {
  const theme = useTheme();
  const [on, setOn] = useState(true);
  const [chip, setChip] = useState("Active");
  const [swiped, setSwiped] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 18, paddingBottom: 64, gap: 28 }}
    >
      <Stack.SearchBar placeholder="Search" onChangeText={(e) => setSaid(e.nativeEvent.text)} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
          <Stack.Toolbar.MenuAction icon="star" onPress={() => setSaid("Menu: Favorite")}>
            Favorite
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon="trash"
            destructive
            onPress={() => setSaid("Menu: Delete")}
          >
            Delete
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <Group title="Conventions (README)">
        <Row>
          <Button
            title="Alert"
            variant="secondary"
            onPress={() =>
              SystemAlert.alert("Delete this chat?", "It goes from every device.", [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => setSaid("Alert: Delete") },
              ])
            }
          />
          <Button
            title="Action sheet"
            variant="secondary"
            onPress={() =>
              ActionSheetIOS.showActionSheetWithOptions(
                {
                  options: ["Remove agent", "Cancel"],
                  destructiveButtonIndex: 0,
                  cancelButtonIndex: 1,
                },
                (index) => setSaid(`Action sheet: ${index}`),
              )
            }
          />
          <Button title="Haptic" variant="secondary" onPress={() => haptics.impact()} />
        </Row>
        <HeldRow
          open={() => router.push("/settings/chat")}
          actions={[{ name: "Pin", run: () => setSaid("Link menu: Pin") }]}
        >
          <Link href="/settings/chat" asChild>
            <Link.Trigger>
              <ListRow title="Touch and hold: a preview and a menu" />
            </Link.Trigger>
            <Link.Preview style={{ backgroundColor: theme.colors.canvas }} />
            <Link.Menu>
              <Link.MenuAction icon="pin" onPress={() => setSaid("Link menu: Pin")}>
                Pin
              </Link.MenuAction>
            </Link.Menu>
          </Link>
        </HeldRow>
        {said ? <Text color="mutedForeground">{said}</Text> : null}
      </Group>
      <Group title="Text: the type scale">
        {STEPS.map((step) => (
          <Text key={step} size={step}>
            {step} {theme.text[step].fontSize} · Otter Agents
          </Text>
        ))}
      </Group>
      <Group title="Text: weights">
        {WEIGHTS.map((weight) => (
          <Text key={weight} size="xl" weight={weight}>
            {weight} · Ask brokk
          </Text>
        ))}
        <Text tabular>Tabular 0123456789 · 1111</Text>
      </Group>
      <Group title="Colors">
        <Row>
          {SWATCHES.map((name) => (
            <View key={name} style={{ alignItems: "center", gap: 4, width: 74 }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: theme.colors[name],
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              />
              <Text size="2xs" color="mutedForeground" numberOfLines={1}>
                {name}
              </Text>
            </View>
          ))}
        </Row>
      </Group>
      <Group title="Icon and Spinner">
        <Row>
          <Icon name="bubble.left.and.bubble.right.fill" />
          <Icon name="clock.fill" color="mutedForeground" />
          <Icon name="gearshape.fill" weight="semibold" size={22} />
          <Icon name="exclamationmark.circle.fill" color="error" />
          <Icon name="checkmark" color="primary" weight="bold" />
          <Spinner size="mini" />
          <Spinner />
          <Spinner size="large" />
        </Row>
      </Group>
      <Group title="Button">
        <Row>
          {VARIANTS.map((variant) => (
            <Button key={variant} title={variant} variant={variant} />
          ))}
        </Row>
        <Row>
          <Button title="sm" size="sm" variant="secondary" />
          <Button title="default" variant="secondary" />
          <Button title="lg" size="lg" variant="secondary" icon="plus" />
          <Button title="xl" size="xl" variant="primary" />
          <Button title="Disabled" disabled />
        </Row>
        <Row>
          <IconButton icon="xmark" label="Cancel" />
          <IconButton icon="checkmark" label="Done" variant="glass-prominent" />
          <IconButton icon="ellipsis" label="More" variant="secondary" size="default" />
          <IconButton icon="trash" label="Delete" variant="ghost-destructive" size="sm" />
        </Row>
      </Group>
      <Group title="Badge">
        <Row>
          <Badge>3</Badge>
          <Badge>128</Badge>
          <Badge variant="destructive">!</Badge>
          <Badge variant="warning">2</Badge>
          <Badge variant="secondary">DEFAULT</Badge>
          <Badge variant="outline">Beta</Badge>
          <BadgeDot />
          <BadgeDot color="error" />
        </Row>
      </Group>
      <Group title="Avatar and the agents' marks">
        <Row>
          <Avatar initials="cd" />
          <Avatar initials="Demo" size={44} />
          <Avatar emoji="🦉" size={36} />
          <Avatar initials="ok" shape="rounded" dot />
          <Avatar initials="ok" badge={4} />
          <AgentAvatar size={28} />
          {EXTENSIONS.map((e) => (
            <AgentAvatar key={e.manifest.id} kind={e.manifest.id} size={28} />
          ))}
        </Row>
      </Group>
      <Group title="Chip">
        <Row>
          {["Active", "Snoozed", "Settled"].map((name, index) => (
            <Chip
              key={name}
              text={name}
              count={index}
              selected={chip === name}
              onPress={() => setChip(name)}
            />
          ))}
          <Chip text="brokk" removable selected leading={<AgentAvatar size={14} />} />
          <Chip text="GPT-5.5" variant="glass" />
          <Chip text="Selected" variant="glass" selected />
        </Row>
      </Group>
      <Group title="Glass">
        <Row>
          <Glass style={{ paddingHorizontal: 18, height: 44, justifyContent: "center" }}>
            <Text>Capsule</Text>
          </Glass>
          <Glass
            interactive
            style={{ paddingHorizontal: 18, height: 44, justifyContent: "center" }}
          >
            <Text>Interactive</Text>
          </Glass>
          <Glass shape={{ radius: 22 }} style={{ padding: 16 }}>
            <Text>Rounded 22</Text>
          </Glass>
          <Glass
            shape="circle"
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="plus" />
          </Glass>
        </Row>
      </Group>
      <Group title="Switch">
        <Row>
          <Switch value={on} onValueChange={setOn} />
          <Switch value={!on} onValueChange={(value) => setOn(!value)} />
          <Switch value disabled />
        </Row>
      </Group>
      <Group title="Alert">
        <Alert variant="error" title="Couldn't reach brokk" description="The gateway is offline." />
        <Alert
          variant="warning"
          title="Reconnect varys"
          action={<Button title="Reconnect" size="sm" variant="secondary" />}
        />
        <Alert variant="info" title="Chats follow your Otter account" />
        <Alert variant="success" title="Connected" />
      </Group>
      <Group title="Toast">
        <Toast text="Plan the Lisbon offsite · Done" />
        <Toast
          text="Settled"
          icon="archivebox"
          action={{ label: "Undo", run: () => setSwiped(null) }}
        />
      </Group>
      <Group title="EmptyState">
        <EmptyState
          icon="bubble.left.and.bubble.right"
          title="No chats"
          description="Ask an agent something to start one."
          actions={<Button title="New chat" variant="glass-prominent" icon="square.and.pencil" />}
        />
      </Group>
      <Group title="ListRow, SwipeRow, Separator">
        <View style={{ marginHorizontal: -18 }}>
          <SwipeRow
            leading={{
              title: "Pin",
              icon: "pin.fill",
              tint: "#f5a623",
              onPerform: () => setSwiped("Pinned"),
            }}
            trailing={{
              title: "Settle",
              icon: "checkmark.circle",
              tint: "#34c759",
              onPerform: () => setSwiped("Settled"),
            }}
          >
            <ListRow
              title="Plan the Lisbon offsite"
              subtitle={swiped ? `${swiped} · swipe again` : "Swipe either way"}
              trailing={
                <Text size="md" color="mutedForeground">
                  15. Nov
                </Text>
              }
              onPress={() => {}}
            />
          </SwipeRow>
          <Separator inset={16} />
          <ListRow
            title="Reply to Lena about the Q4 budget"
            subtitle="Shortened to three lines and sent."
            emphasized
            trailing={<AgentAvatar kind="openclaw" size={16} />}
            detail={<BadgeDot />}
            onPress={() => {}}
          />
          <Separator inset={16} />
          <ListRow title="Morning brief" leading={<AgentAvatar kind="hermes" size={28} />} />
        </View>
      </Group>
      <Group title="Settings">
        <SettingsSection title="Agents" footer="A footer under the card.">
          <SettingsRow
            title="brokk"
            icon={<AgentAvatar kind="hermes" size={22} />}
            value="Connected"
            onPress={() => {}}
          />
          <SettingsRow
            title="Color scheme"
            icon="circle.lefthalf.filled"
            value="System"
            accessory={<Icon name="chevron.up.chevron.down" size={13} color="mutedForeground" />}
          />
          <SettingsSwitchRow
            title="Notifications"
            icon="bell.badge"
            value={on}
            onValueChange={setOn}
          />
          <SettingsRow title="Add agent" icon="plus" chevron={false} onPress={() => {}} />
        </SettingsSection>
        <SettingsSection>
          <SettingsButton title="Sign out" onPress={() => {}} />
          <SettingsButton title="Delete account" destructive onPress={() => {}} />
        </SettingsSection>
      </Group>
      <Group title="Sheet (its content, drawn inline)">
        <View
          style={{
            height: 260,
            borderRadius: 24,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Sheet title="Chat details" onCancel={() => {}} onDone={() => {}}>
            <SettingsSection>
              <SettingsRow title="Agent" value="brokk" />
            </SettingsSection>
          </Sheet>
        </View>
      </Group>
    </ScrollView>
  );
}
