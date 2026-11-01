/**
 * Extensions: features that plug into Otter Mail through contribution points
 * instead of being wired into the app by hand (VS Code's model). Each is a
 * package under extensions/ whose package.json carries its manifest (the
 * `otterMail` field), with up to three halves: `./core` (core's: handlers,
 * services, an agent; packages/core/src/extensions.ts), `./ui` (the
 * renderer's: buttons, cards, commands, settings;
 * apps/web/src/main/extensions) and `./desktop` (what only the desktop
 * backend runs: Claude, Codex).
 *
 * Where it runs is its manifest's `platforms`. Each app loads the half it can
 * run, as VS Code loads an extension's `main` or `browser`: the desktop app
 * `./desktop` when there is one, else `./core`; the web app `./core`.
 */

export type ExtensionManifest = {
  /** Stable: preferences, channels and secrets refer to it. */
  id: string;
  /** As Settings shows it. */
  name: string;
  /** One line, under its name in Settings. */
  description: string;
  /** The Settings pane it lives in: Features (mail), Integrations, Agents. */
  category: ExtensionCategory;
  /** Where your data goes when it runs, in one sentence: shown on its page in Settings. */
  dataUse: string;
  /** The apps it runs in; absent: every one. */
  platforms?: readonly AppPlatform[];
};

/** The apps an extension can run in: the desktop app on each OS, and the web app. */
export const APP_PLATFORMS = ["mac", "linux", "web"] as const;

export type AppPlatform = (typeof APP_PLATFORMS)[number];

/** Whether an extension runs in this app. */
export function runsOn(manifest: ExtensionManifest, platform: AppPlatform): boolean {
  return !manifest.platforms || manifest.platforms.includes(platform);
}

export const EXTENSION_CATEGORIES = {
  mail: "Mail",
  integration: "Integrations",
  agent: "Agents",
} as const;

export type ExtensionCategory = keyof typeof EXTENSION_CATEGORIES;

/** Reads a package's `otterMail` field, so a bad manifest fails when it loads rather than later. */
export function extensionManifest(pkg: { otterMail?: unknown }): ExtensionManifest {
  const m = pkg.otterMail as Partial<Record<keyof ExtensionManifest, unknown>> | undefined;
  const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (!m || !text(m.id) || !text(m.name) || !text(m.description) || !text(m.dataUse))
    throw new Error(
      "An extension's package.json needs otterMail.id, name, description and dataUse.",
    );
  if (typeof m.category !== "string" || !(m.category in EXTENSION_CATEGORIES))
    throw new Error(`${String(m.id)}: otterMail.category is mail, integration or agent.`);
  const platforms = m.platforms;
  if (
    platforms !== undefined &&
    (!Array.isArray(platforms) ||
      !platforms.every((p) => (APP_PLATFORMS as readonly unknown[]).includes(p)))
  )
    throw new Error(`${String(m.id)}: otterMail.platforms lists ${APP_PLATFORMS.join(", ")}.`);
  return {
    id: m.id as string,
    name: m.name as string,
    description: m.description as string,
    category: m.category as ExtensionCategory,
    dataUse: m.dataUse as string,
    ...(platforms ? { platforms: platforms as AppPlatform[] } : {}),
  };
}
