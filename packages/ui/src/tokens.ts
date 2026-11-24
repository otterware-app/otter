import { converter, formatHex, formatHex8, parse, toGamut, type Color } from "culori";

/**
 * The tokens in tokens.css and globals.css, resolved to the values a browser
 * paints (var() followed, color-mix() mixed) for the stock light and dark
 * palettes, and written as the variables of design/otter.pen and as
 * @otter/ui-native's tokens.
 */

export type Mode = "light" | "dark";
/** A theme's design: the stock tokens, or a `html[data-design]` block over them. */
export type Design = "otter" | "margin";
export const DESIGNS: readonly Design[] = ["otter", "margin"];

type Themed<T> = { value: T; theme: { mode?: Mode; theme: Design } }[];
type PenVariable =
  | { type: "color"; value: { value: string; theme: { mode: Mode; theme: Design } }[] }
  | { type: "number"; value: number | Themed<number> }
  | { type: "string"; value: string | Themed<string> };

export type PenVariables = Record<string, PenVariable>;

/** Tailwind's own steps the app uses, beside globals.css's. */
const TAILWIND_TEXT: Record<string, number> = {
  xs: 0.75,
  sm: 0.875,
  base: 1,
  lg: 1.125,
  xl: 1.25,
  "2xl": 1.5,
  "3xl": 1.875,
};
const SPACING_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8];
/** Not colors a design draws with: the machinery behind them. */
const SKIPPED = new Set(["accent", "accent-contrast", "app-chrome-background"]);

function blocks(css: string, selector: string): Map<string, string> {
  const out = new Map<string, string>();
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, "g");
  for (const match of css.matchAll(re)) {
    const body = match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const decl of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      out.set(decl[1]!, decl[2]!.replace(/\s+/g, " ").trim());
    }
  }
  return out;
}

function splitArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(inner.slice(start).trim());
  return args;
}

const toRgb = converter("rgb");
const toOklab = converter("oklab");

function mix(space: string, a: Color, pa: number, b: Color, pb: number): Color {
  const convert = (color: Color) =>
    (space === "oklab" ? toOklab(color) : toRgb(color)) as unknown as Record<string, number>;
  const ca = convert(a);
  const cb = convert(b);
  const keys = space === "oklab" ? ["l", "a", "b"] : ["r", "g", "b"];
  const total = pa + pb;
  const wa = pa / total;
  const wb = pb / total;
  const aa = ca.alpha ?? 1;
  const ab = cb.alpha ?? 1;
  const alpha = aa * wa + ab * wb;
  const mixed: Record<string, number | string> = { mode: space === "oklab" ? "oklab" : "rgb" };
  for (const key of keys) {
    mixed[key] = alpha === 0 ? 0 : ((ca[key] ?? 0) * aa * wa + (cb[key] ?? 0) * ab * wb) / alpha;
  }
  mixed.alpha = alpha * Math.min(total, 1);
  return mixed as unknown as Color;
}

function evaluate(value: string, vars: Map<string, string>, seen: string[] = []): Color {
  const trimmed = value.trim();
  const ref = /^var\(--([\w-]+)\)$/.exec(trimmed);
  if (ref) {
    const name = ref[1]!;
    const next = vars.get(name);
    if (next === undefined || seen.includes(name)) throw new Error(`Unresolved --${name}`);
    return evaluate(next, vars, [...seen, name]);
  }
  const mixMatch = /^color-mix\((.*)\)$/.exec(trimmed);
  if (mixMatch) {
    const [spaceArg, first, second] = splitArgs(mixMatch[1]!);
    const space = spaceArg!.replace(/^in\s+/, "");
    const part = (arg: string) => {
      const pct = /\s(-?[\d.]+)%$/.exec(arg);
      return {
        color: evaluate(pct ? arg.slice(0, pct.index) : arg, vars, seen),
        pct: pct ? Number(pct[1]) / 100 : undefined,
      };
    };
    const a = part(first!);
    const b = part(second!);
    const pa = a.pct ?? (b.pct === undefined ? 0.5 : 1 - b.pct);
    const pb = b.pct ?? 1 - pa;
    return mix(space, a.color, pa, b.color, pb);
  }
  const parsed = parse(trimmed);
  if (!parsed) throw new Error(`Not a color: ${trimmed}`);
  return parsed;
}

function hex(color: Color): string {
  const rgb = toGamut("rgb", "oklch")(color);
  return (rgb.alpha ?? 1) < 1 ? formatHex8(rgb) : formatHex(rgb);
}

function isColor(value: string, vars: Map<string, string>): boolean {
  try {
    evaluate(value, vars);
    return true;
  } catch {
    return false;
  }
}

/**
 * The stock palette, resolved per mode, in tokens.css's order. The `sidebar-*`
 * roles the sidebar redeclares (`[data-app-sidebar]`) take its values, where
 * they're drawn.
 */
function designBlock(css: string, design: Design, suffix = ""): Map<string, string> {
  return design === "otter" ? new Map() : blocks(css, `html[data-design="${design}"]${suffix}`);
}

export function resolveColors(
  tokensCss: string,
  design: Design = "otter",
): Map<string, Record<Mode, string>> {
  const stock = blocks(tokensCss, ":root");
  const designLight = designBlock(tokensCss, design);
  const light = new Map([...stock, ...designLight]);
  const dark = new Map([
    ...stock,
    ...blocks(tokensCss, ".dark"),
    ...designLight,
    ...designBlock(tokensCss, design, ".dark"),
  ]);
  const sidebarScope = new Map([
    ...blocks(tokensCss, "[data-app-sidebar]"),
    ...designBlock(tokensCss, design, " [data-app-sidebar]"),
  ]);
  const sidebarDarkScope = new Map([
    ...blocks(tokensCss, ".dark [data-app-sidebar]"),
    ...designBlock(tokensCss, design, ".dark [data-app-sidebar]"),
  ]);
  const sidebarLight = new Map([...light, ...sidebarScope]);
  const sidebarDark = new Map([...dark, ...sidebarScope, ...sidebarDarkScope]);
  const colors = new Map<string, Record<Mode, string>>();
  for (const [name, value] of stock) {
    if (SKIPPED.has(name) || !isColor(value, light)) continue;
    // A sidebar role the sidebar redeclares is computed there; one declared
    // only on :root is computed there and inherited as is.
    const scoped =
      name.startsWith("sidebar-") && (sidebarScope.has(name) || sidebarDarkScope.has(name));
    const [inLight, inDark] = scoped ? [sidebarLight, sidebarDark] : [light, dark];
    colors.set(name, {
      light: hex(evaluate(inLight.get(name) ?? value, inLight)),
      dark: hex(evaluate(inDark.get(name)!, inDark)),
    });
  }
  return colors;
}

function firstFamily(stack: string): string {
  const families = stack.split(",").map((family) => family.trim().replace(/^"|"$/g, ""));
  const family = families.find((f) => !/^(ui-|-apple|system-ui|BlinkMacSystemFont)/.test(f));
  return (family ?? families[0]!).replace(/ Variable$/, "");
}

export function penVariables(tokensCss: string, globalsCss: string): PenVariables {
  const variables: PenVariables = {};
  const colors = DESIGNS.map((design) => [design, resolveColors(tokensCss, design)] as const);
  for (const name of colors[0]![1].keys()) {
    variables[name] = {
      type: "color",
      value: colors.flatMap(([design, resolved]) =>
        (["light", "dark"] as const).map((mode) => ({
          value: resolved.get(name)![mode],
          theme: { mode, theme: design },
        })),
      ),
    };
  }

  const root = blocks(tokensCss, ":root");
  const margin = designBlock(tokensCss, "margin");
  const radiusPx = Number.parseFloat(root.get("radius") ?? "0.5") * 16;
  const themed = <T>(otter: T, marginValue: T | undefined): T | Themed<T> =>
    marginValue === undefined || marginValue === otter
      ? otter
      : [
          { value: otter, theme: { theme: "otter" } },
          { value: marginValue, theme: { theme: "margin" } },
        ];
  const px = (value: string | undefined) =>
    value === undefined ? undefined : Number.parseFloat(value);
  for (const match of globalsCss.matchAll(
    /--radius-([\w-]+):\s*(?:var\(--radius\)|calc\(var\(--radius\)\s*([+-])\s*(\d+)px\));/g,
  )) {
    const offset = match[3] ? Number(match[3]) * (match[2] === "-" ? -1 : 1) : 0;
    variables[`radius-${match[1]}`] = {
      type: "number",
      value: themed(radiusPx + offset, px(margin.get(`radius-${match[1]}`))),
    };
  }
  variables["radius-full"] = { type: "number", value: 9999 };
  variables["radius-pill"] = { type: "number", value: themed(9999, px(margin.get("radius-pill"))) };

  const text: Record<string, number> = { ...TAILWIND_TEXT };
  for (const match of globalsCss.matchAll(/--text-([\w-]+):\s*([\d.]+)rem;/g)) {
    text[match[1]!] = Number(match[2]);
  }
  for (const [name, rem] of Object.entries(text).sort((a, b) => a[1] - b[1])) {
    variables[`text-${name}`] = { type: "number", value: rem * 16 };
  }

  for (const step of SPACING_STEPS) {
    variables[`space-${step}`] = { type: "number", value: step * 4 };
  }

  const theme = blocks(globalsCss, "@theme");
  const sans = firstFamily(theme.get("font-sans") ?? "");
  const family = (value: string | undefined) => (value ? firstFamily(value) : undefined);
  variables["font-sans"] = { type: "string", value: themed(sans, family(margin.get("font-sans"))) };
  variables["font-mono"] = {
    type: "string",
    value: themed(firstFamily(theme.get("font-mono") ?? ""), family(margin.get("font-mono"))),
  };
  variables["font-reading"] = {
    type: "string",
    value: themed(sans, family(margin.get("font-reading"))),
  };
  return variables;
}

/** The designs the iPhone apps draw with. */
const NATIVE_DESIGNS: readonly Design[] = ["otter"];

type Tree = string | number | [string, Tree][];

function printTree(tree: Tree, indent = ""): string {
  if (!Array.isArray(tree)) return JSON.stringify(tree);
  const inner = `${indent}  `;
  const entries = tree.map(([key, value]) => {
    const name = /^([A-Za-z_$][\w$]*|\d+(\.\d+)?)$/.test(key) ? key : JSON.stringify(key);
    return `${inner}${name}: ${printTree(value, inner)},\n`;
  });
  return `{\n${entries.join("")}${indent}}`;
}

/**
 * packages/ui-native/src/tokens.ts: the same variables as plain data for React
 * Native, per design (colors per scheme, the radius scale, the fonts) beside
 * the type scale and spacing every design shares. Names are camelCase, without
 * their group's prefix (`muted-foreground` → `colors.mutedForeground`,
 * `radius-lg` → `radius.lg`).
 */
export function nativeTokensModule(tokensCss: string, globalsCss: string): string {
  const variables = Object.entries(penVariables(tokensCss, globalsCss));
  const pick = ({ value }: PenVariable, design: Design, mode?: Mode) =>
    Array.isArray(value)
      ? (value as Themed<string | number>).find(
          ({ theme }) =>
            theme.theme === design && (theme.mode === undefined || theme.mode === mode),
        )!.value
      : value;
  const group = (prefix: string, design: Design): [string, Tree][] =>
    variables
      .filter(([name, variable]) => variable.type !== "color" && name.startsWith(prefix))
      .map(([name, variable]) => [name.slice(prefix.length), pick(variable, design)]);
  const colors = (design: Design, mode: Mode): [string, Tree][] =>
    variables
      .filter(([, variable]) => variable.type === "color")
      .map(([name, variable]) => [
        name.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase()),
        pick(variable, design, mode),
      ]);
  const designs: [string, Tree][] = NATIVE_DESIGNS.map((design) => [
    design,
    [
      [
        "colors",
        [
          ["light", colors(design, "light")],
          ["dark", colors(design, "dark")],
        ],
      ],
      ["radius", group("radius-", design)],
      ["fonts", group("font-", design)],
    ],
  ]);
  return `${[
    "// Generated from @otter/ui's tokens.css and globals.css by `pnpm design:tokens`: don't edit.",
    [
      'export type Scheme = "light" | "dark";',
      "export type Design = keyof typeof designs;",
      'export type Colors = (typeof designs)[Design]["colors"][Scheme];',
    ].join("\n"),
    `export const designs = ${printTree(designs)};`,
    `export const text = ${printTree(group("text-", "otter"))};`,
    `export const space = ${printTree(group("space-", "otter"))};`,
  ].join("\n\n")}\n`;
}
