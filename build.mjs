// Build: one small card module for guests; editor + 3D engine as lazy chunks.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
fs.rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/floor3d-snapshot-card.js"],
  outdir: "dist", bundle: true, splitting: true, format: "esm", minify: true, target: "es2020",
  chunkNames: "floor3d-snapshot-[name]-[hash]", legalComments: "eof",
  define: { __VERSION__: JSON.stringify(pkg.version) },
  metafile: true, logLevel: "info",
}).then((r) => fs.writeFileSync("dist/meta.json", JSON.stringify(r.metafile)));
fs.rmSync("dist/meta.json");
// Draco / Basis decoders for compressed floor3d models (loaded by the editor only).
const three = "node_modules/three/examples/jsm/libs";
for (const [from, to] of [["draco/gltf", "decoders/draco"], ["basis", "decoders/basis"]]) {
  fs.mkdirSync(path.join("dist", to), { recursive: true });
  for (const f of fs.readdirSync(path.join(three, from))) if (/\.(js|wasm)$/.test(f) && !/encoder/.test(f)) fs.copyFileSync(path.join(three, from, f), path.join("dist", to, f));
}
// HACS zip release
fs.rmSync("floor3d-snapshot-card.zip", { force: true });
execSync("cd dist && zip -qr ../floor3d-snapshot-card.zip .");
for (const f of fs.readdirSync("dist")) { const s = fs.statSync(path.join("dist", f)); if (s.isFile()) console.log(`${f.padEnd(52)} ${(s.size / 1024).toFixed(1)} KB`); }
