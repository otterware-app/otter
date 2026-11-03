export type ExtensionManifest = {
  id: string;
  name: string;
  description: string;
  category: ExtensionCategory;
  dataUse: string;
  platforms?: readonly AppPlatform[];
  contributes?: ExtensionContributes;
};

export type ExtensionContributes = {
  workspaces?: readonly WorkspaceManifest[];
};

export type WorkspaceManifest = {
  id: string;
  title: string;
};

const RESERVED_WORKSPACES = new Set([
  "all",
  "app",
  "calendar",
  "chats",
  "compose",
  "search",
  "settings",
]);

export const APP_PLATFORMS = ["mac", "linux", "web"] as const;

export type AppPlatform = (typeof APP_PLATFORMS)[number];

export function runsOn(manifest: ExtensionManifest, platform: AppPlatform): boolean {
  return !manifest.platforms || manifest.platforms.includes(platform);
}

export const EXTENSION_CATEGORIES = {
  mail: "Mail",
  integration: "Integrations",
  connection: "Connections",
  agent: "Agents",
} as const;

export type ExtensionCategory = keyof typeof EXTENSION_CATEGORIES;

export function extensionManifest(pkg: { otterMail?: unknown }): ExtensionManifest {
  const m = pkg.otterMail as Partial<Record<keyof ExtensionManifest, unknown>> | undefined;
  const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (!m || !text(m.id) || !text(m.name) || !text(m.description) || !text(m.dataUse))
    throw new Error(
      "An extension's package.json needs otterMail.id, name, description and dataUse.",
    );
  if (typeof m.category !== "string" || !(m.category in EXTENSION_CATEGORIES))
    throw new Error(
      `${String(m.id)}: otterMail.category is mail, integration, connection or agent.`,
    );
  const platforms = m.platforms;
  if (
    platforms !== undefined &&
    (!Array.isArray(platforms) ||
      !platforms.every((p) => (APP_PLATFORMS as readonly unknown[]).includes(p)))
  )
    throw new Error(`${String(m.id)}: otterMail.platforms lists ${APP_PLATFORMS.join(", ")}.`);
  const contributes = readContributes(String(m.id), m.contributes);
  return {
    id: m.id as string,
    name: m.name as string,
    description: m.description as string,
    category: m.category as ExtensionCategory,
    dataUse: m.dataUse as string,
    ...(platforms ? { platforms: platforms as AppPlatform[] } : {}),
    ...(contributes ? { contributes } : {}),
  };
}

function readContributes(id: string, value: unknown): ExtensionContributes | undefined {
  if (value === undefined) return undefined;
  const workspaces = (value as { workspaces?: unknown } | null)?.workspaces;
  if (workspaces === undefined) return {};
  if (!Array.isArray(workspaces))
    throw new Error(`${id}: otterMail.contributes.workspaces is a list.`);
  return {
    workspaces: workspaces.map((w: Partial<WorkspaceManifest> | null) => {
      if (
        typeof w?.id !== "string" ||
        !/^[a-z]+$/.test(w.id) ||
        RESERVED_WORKSPACES.has(w.id) ||
        typeof w.title !== "string" ||
        !w.title.trim()
      )
        throw new Error(
          `${id}: each workspace has a lowercase id (not ${[...RESERVED_WORKSPACES].join(", ")}) and a title.`,
        );
      return { id: w.id, title: w.title };
    }),
  };
}
