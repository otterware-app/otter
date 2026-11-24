// Writes an Expo app's list of licenses, `apps/<app>/src/settings/licenses.json`: the packages
// whose JavaScript is in its iOS bundle (an `expo export`'s source map), the packages autolinked
// into its Release build for their native code, and the notices third-party-licenses.config.json
// gives its bundle (named for the app). `node scripts/export-mobile-licenses.ts agents-mobile
// [--check]`; `--check` fails when the committed list is stale.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateThirdPartyLicenseManifest } from "./lib/third-party-licenses.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = process.argv[2];
if (!app || app.startsWith("-")) {
  console.error("Usage: node scripts/export-mobile-licenses.ts <app> [--check]");
  process.exit(1);
}
const appDir = join(root, "apps", app);
const path = `apps/${app}/src/settings/licenses.json`;

// Its own Metro cache, so a dev server's is never touched, and the production shape: no fake data.
const work = mkdtempSync(join(tmpdir(), "otter-licenses-"));
const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: work };
delete env.EXPO_PUBLIC_OTTER_DATA;

function run(args: string[]): string {
  const result = spawnSync("npx", args, { cwd: appDir, env, encoding: "utf8", maxBuffer: 1 << 28 });
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    throw new Error(`npx ${args.join(" ")} failed.`);
  }
  return result.stdout;
}

function bundledSources(): string[] {
  const out = join(work, "export");
  run([
    "expo",
    "export",
    "--platform",
    "ios",
    "--source-maps",
    "external",
    "--no-bytecode",
    "--no-minify",
    "--dump-assetmap",
    "--output-dir",
    out,
  ]);
  const js = join(out, "_expo/static/js/ios");
  const mapFile = readdirSync(js).find((file) => file.endsWith(".js.map"));
  if (!mapFile) throw new Error("expo export wrote no source map.");
  const map = JSON.parse(readFileSync(join(js, mapFile), "utf8")) as {
    sources?: string[];
    sections?: { map: { sources: string[] } }[];
  };
  const sources = map.sections?.flatMap((section) => section.map.sources) ?? map.sources ?? [];
  const assets = JSON.parse(readFileSync(join(out, "assetmap.json"), "utf8")) as Record<
    string,
    { files: string[] }
  >;
  return [
    // Metro names a module by its path from the workspace root.
    ...sources.filter((source) => source.startsWith("/")).map((source) => join(root, source)),
    ...Object.values(assets).flatMap((asset) => asset.files),
  ];
}

function autolinkedPackages(): string[] {
  const expo = JSON.parse(
    run(["expo-modules-autolinking", "resolve", "--platform", "apple", "--json"]),
  ) as {
    modules: { debugOnly: boolean; pods: { podspecDir: string }[] }[];
  };
  const community = JSON.parse(
    run(["expo-modules-autolinking", "react-native-config", "--platform", "ios", "--json"]),
  ) as { reactNativePath: string; dependencies: Record<string, { root: string }> };
  return [
    ...expo.modules
      .filter((module) => !module.debugOnly)
      .flatMap((module) =>
        module.pods.map((pod) =>
          join(
            pod.podspecDir,
            readdirSync(pod.podspecDir).find((file) => file.endsWith(".podspec"))!,
          ),
        ),
      ),
    ...Object.values(community.dependencies).map((dependency) =>
      join(dependency.root, "package.json"),
    ),
    join(community.reactNativePath, "package.json"),
  ];
}

let next: string;
try {
  const { entries } = await generateThirdPartyLicenseManifest({
    bundleName: app,
    configFile: join(root, "third-party-licenses.config.json"),
    packageManifests: [],
    bundledModuleIds: [...bundledSources(), ...autolinkedPackages()],
  });
  const list = entries.map(({ name, version, license, noticeText, sourceUrl }) => ({
    name,
    version,
    license,
    noticeText,
    sourceUrl,
  }));
  next = `${JSON.stringify(list, null, 2)}\n`;
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(join(root, path), "utf8");
  } catch {}
  if (current !== next) {
    console.error(`${path} is stale: run \`node scripts/export-mobile-licenses.ts ${app}\`.`);
    process.exitCode = 1;
  }
} else {
  writeFileSync(join(root, path), next);
  console.log(`Wrote ${path}`);
}
