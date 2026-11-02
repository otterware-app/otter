import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEMO_ACCOUNTS } from "../packages/shared/src/demo-mailboxes.ts";
import {
  APP_THEMES,
  OTTER_DARK_THEME_COLORS,
  OTTER_LIGHT_THEME_COLORS,
  getThemeColorsForAppearance,
} from "../packages/shared/src/theme-palettes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/ios/OtterMail/Resources");
mkdirSync(out, { recursive: true });

const themes = APP_THEMES.map((theme) => ({
  id: theme.id,
  label: theme.label,
  exact: theme.exact ?? false,
  monochrome: theme.monochrome ?? false,
  light: getThemeColorsForAppearance(theme, "light") ?? OTTER_LIGHT_THEME_COLORS,
  dark: getThemeColorsForAppearance(theme, "dark") ?? OTTER_DARK_THEME_COLORS,
}));

const seededAt = Date.now();
const demo = DEMO_ACCOUNTS.map(({ threads, ...account }) => ({
  ...account,
  threads: threads(seededAt).map((thread) => ({
    ...thread,
    messages: thread.messages.map(({ attachments, html, ...message }) => ({
      ...message,
      html: (attachments ?? []).reduce(
        (body, a) =>
          a.contentId && body
            ? body.replaceAll(
                `cid:${a.contentId}`,
                `data:${a.mimeType};base64,${Buffer.from(a.content).toString("base64")}`,
              )
            : body,
        html,
      ),
      attachments: (attachments ?? [])
        .filter((a) => !a.contentId)
        .map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.content.length })),
    })),
  })),
}));

const write = (name: string, value: unknown) => {
  writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`Wrote apps/ios/OtterMail/Resources/${name}`);
};
write("Themes.json", themes);
write("DemoMailboxes.json", demo);
