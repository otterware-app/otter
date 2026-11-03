import { execFileSync } from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const site = NodePath.resolve(import.meta.dirname, "..");
const web = NodePath.resolve(site, "../apps/web/dist");
const dist = NodePath.join(site, "dist");

execFileSync("pnpm", ["--filter", "@otter-mail/web", "build"], { cwd: site, stdio: "inherit" });
execFileSync("node", [NodePath.resolve(site, "../scripts/upload-sourcemaps.ts"), "web", web], {
  cwd: site,
  stdio: "inherit",
});

NodeFS.rmSync(dist, { recursive: true, force: true });
NodeFS.mkdirSync(dist);
for (const name of [
  "index.html",
  "favicon.ico",
  "favicon.svg",
  "apple-touch-icon.png",
  "assets",
  "todoist-callback",
]) {
  NodeFS.cpSync(NodePath.join(web, name), NodePath.join(dist, name), { recursive: true });
}
const pkg = JSON.parse(
  NodeFS.readFileSync(NodePath.resolve(site, "../apps/web/package.json"), "utf8"),
) as { version: string };
const version = process.env.OTTER_MAIL_VERSION?.trim() || pkg.version;
NodeFS.writeFileSync(NodePath.join(dist, "version.json"), JSON.stringify({ version }));
console.log(`Site ${version} assembled in site/dist.`);
