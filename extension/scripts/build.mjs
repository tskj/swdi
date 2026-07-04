import { build, context } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root   = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");
const watch  = process.argv.includes("--watch");

mkdirSync(outdir, { recursive: true });
cpSync(join(root, "manifest.json"),        join(outdir, "manifest.json"));
cpSync(join(root, "src/content.css"),      join(outdir, "content.css"));
cpSync(join(root, "src/popup/popup.html"), join(outdir, "popup.html"));
cpSync(join(root, "src/popup/popup.css"),  join(outdir, "popup.css"));

// Entry points share the src/ base, so outputs land at dist/content.js,
// dist/background.js and dist/popup/popup.js (popup.html references the latter).
const options = {
  entryPoints: [
    join(root, "src/content.ts"),
    join(root, "src/background.ts"),
    join(root, "src/popup/popup.ts"),
  ],
  bundle: true,
  minify: true,
  format: "iife",
  target: "chrome120",
  outdir,
  logLevel: "info",
};

if (watch) await (await context(options)).watch();
else       await build(options);
