import { useAtomValue } from "@effect/atom-react";
import {
  Button,
  Capsule,
  HStack,
  Image,
  Rectangle,
  ScrollView,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  accessibilityElement,
  accessibilityLabel,
  background,
  buttonStyle,
  clipShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  navigationTitle,
  onTapGesture,
  padding,
  shapes,
  strokeBorder,
  toolbarTitleDisplayMode,
} from "@expo/ui/swift-ui/modifiers";
import type { ThemeAppearance, ThemeDefinition } from "@otter-mail/shared/themes";

import { setUiPreference, uiPreferencesAtom } from "../../state/preferences";
import { availableThemes, paletteOf, themeId, themeModes, type Palette } from "../theme";

/**
 * The Swift app's ThemeSettings: every theme as a card with its light and dark
 * palettes; tapping one wears it in both, its sun or moon in one.
 */
export function ThemeSettings({ colors }: { colors: Palette }) {
  const ui = useAtomValue(uiPreferencesAtom);
  const themes = availableThemes(ui);
  const light = themeId(ui, "light");
  const dark = themeId(ui, "dark");
  const pick = (theme: ThemeDefinition, modes: readonly ThemeAppearance[]) => {
    for (const mode of modes) setUiPreference(`otter:theme:${mode}`, theme.id);
  };
  const rows: ThemeDefinition[][] = [];
  for (let i = 0; i < themes.length; i += 2) rows.push(themes.slice(i, i + 2));

  return (
    <ScrollView
      modifiers={[
        background(colors.canvas),
        navigationTitle("Theme"),
        toolbarTitleDisplayMode("inline"),
      ]}
    >
      <VStack spacing={12} modifiers={[padding({ all: 20 })]}>
        {rows.map((row) => (
          <HStack key={row.map((t) => t.id).join()} spacing={12} alignment="top">
            {row.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                themes={themes}
                colors={colors}
                light={light === theme.id}
                dark={dark === theme.id}
                onPick={(modes) => pick(theme, modes)}
              />
            ))}
            {row.length === 1 ? <Spacer modifiers={[frame({ maxWidth: Infinity })]} /> : null}
          </HStack>
        ))}
      </VStack>
    </ScrollView>
  );
}

function ThemeCard({
  theme,
  themes,
  colors,
  light,
  dark,
  onPick,
}: {
  theme: ThemeDefinition;
  themes: readonly ThemeDefinition[];
  colors: Palette;
  light: boolean;
  dark: boolean;
  onPick: (modes: readonly ThemeAppearance[]) => void;
}) {
  const modes = themeModes(theme);
  const worn = [light && "light", dark && "dark"].filter(Boolean).join(" and ");
  const orb = (mode: ThemeAppearance, picked: boolean) => (
    <Button
      onPress={() => onPick([mode])}
      modifiers={[
        buttonStyle("plain"),
        accessibilityLabel(mode === "light" ? "Use in light mode" : "Use in dark mode"),
      ]}
    >
      <Image
        systemName={mode === "light" ? "sun.max.fill" : "moon.fill"}
        size={11}
        color={picked ? colors.actionText : colors.secondary}
        modifiers={[
          frame({ width: 24, height: 24 }),
          background(picked ? colors.accent : colors.input, shapes.circle()),
        ]}
      />
    </Button>
  );
  return (
    <VStack
      alignment="leading"
      spacing={10}
      modifiers={[
        padding({ all: 10 }),
        frame({ maxWidth: Infinity }),
        background(colors.surface, shapes.roundedRectangle({ cornerRadius: 18 })),
        strokeBorder({
          content: light || dark ? colors.focus : colors.border,
          style: { lineWidth: light && dark ? 2 : 1 },
          shape: "roundedRectangle",
          cornerRadius: 18,
        }),
        onTapGesture(() => onPick(modes)),
        accessibilityElement("combine"),
        accessibilityLabel(`${theme.label}${worn ? `, worn in ${worn}` : ""}`),
        ...(light && dark ? [accessibilityAddTraits(["isSelected"])] : []),
      ]}
    >
      <HStack spacing={0} modifiers={[frame({ height: 76 }), clipShape("roundedRectangle", 12)]}>
        {modes.map((mode) => (
          <Preview key={mode} p={paletteOf(themes, theme.id, mode)} />
        ))}
      </HStack>
      <HStack>
        <Text
          modifiers={[
            font({ textStyle: "subheadline", weight: "medium" }),
            foregroundStyle(colors.text),
            lineLimit(1),
          ]}
        >
          {theme.label}
        </Text>
        <Spacer />
        {modes.includes("light") ? orb("light", light) : null}
        {modes.includes("dark") ? orb("dark", dark) : null}
      </HStack>
    </VStack>
  );
}

function Preview({ p }: { p: Palette }) {
  return (
    <HStack spacing={0}>
      <Rectangle modifiers={[foregroundStyle(p.sidebar), frame({ width: 18 })]} />
      <VStack
        alignment="leading"
        spacing={5}
        modifiers={[
          padding({ all: 8 }),
          frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "leading" }),
          background(p.canvas),
        ]}
      >
        <Capsule modifiers={[foregroundStyle(p.text), frame({ width: 34, height: 4 })]} />
        <Capsule modifiers={[foregroundStyle(p.secondary), frame({ width: 24, height: 4 })]} />
        <Spacer />
        <Capsule modifiers={[foregroundStyle(p.accent), frame({ width: 20, height: 8 })]} />
      </VStack>
    </HStack>
  );
}
