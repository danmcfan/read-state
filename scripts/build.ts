// `bun run build`: bundle site/ into dist/ for GitHub Pages.

import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildWorker, root, site, staticPaths } from "./site.ts";
import solid from "./solid-plugin.ts";

const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });

const page = await Bun.build({
  entrypoints: [join(site, "index.html")],
  outdir: dist,
  plugins: [solid],
  minify: true,
});
if (!page.success) throw new AggregateError(page.logs, "page build failed");

await buildWorker({ outdir: dist, minify: true });

for (const path of staticPaths) cpSync(join(site, path), join(dist, path), { recursive: true });

console.log(`built ${dist}`);
