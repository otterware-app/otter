#!/usr/bin/env node
// Bundles the composer's editor (composer/editor.ts: the web's TipTap schema)
// into one HTML file the otter-composer view loads from its resources.
//
//   node scripts/build-composer.mts   (from apps/mobile)

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { build } from "esbuild";

const app = NodePath.resolve(import.meta.dirname, "..");
const web = NodePath.resolve(app, "../web");

const result = await build({
  entryPoints: [NodePath.join(app, "composer/editor.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "safari18",
  write: false,
  nodePaths: [NodePath.join(web, "node_modules")],
  legalComments: "none",
});
const script = result.outputFiles[0]!.text.replaceAll("</script", "<\\/script");

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body { font: -apple-system-body; color: CanvasText; -webkit-text-size-adjust: 100%; }
  #editor { min-height: 100vh; }
  .ProseMirror { outline: none; padding: 12px 20px 40px; min-height: calc(100vh - 52px); word-wrap: break-word; }
  .ProseMirror p { margin: 0 0 0.6em; }
  .ProseMirror blockquote { margin: 0.6em 0; padding-left: 12px; border-left: 3px solid color-mix(in srgb, CanvasText 25%, transparent); color: color-mix(in srgb, CanvasText 70%, transparent); }
  .ProseMirror img { max-width: 100%; height: auto; }
  .ProseMirror [data-signature] { color: color-mix(in srgb, CanvasText 65%, transparent); }
  #editor[data-placeholder] .ProseMirror > p:only-child:has(> br.ProseMirror-trailingBreak:only-child)::before,
  #editor[data-placeholder] .ProseMirror > p.is-empty:only-child::before {
    content: attr(data-placeholder); color: color-mix(in srgb, CanvasText 40%, transparent); float: left; height: 0; pointer-events: none;
  }
</style>
</head>
<body><div id="editor" data-placeholder="Message"></div>
<script>${script}</script>
</body>
</html>
`;

const out = NodePath.join(app, "modules/otter-composer/ios/Resources/composer.html");
NodeFS.mkdirSync(NodePath.dirname(out), { recursive: true });
NodeFS.writeFileSync(out, html);
console.log(`composer.html: ${Math.round(html.length / 1024)} KB`);
