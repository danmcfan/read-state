// Paths and the worker bundle shared by scripts/build.ts and scripts/serve.ts.

import { join } from "node:path";
import solid from "./solid-plugin.ts";

export const root = join(import.meta.dir, "..");
export const site = join(root, "site");

/** Static files served beside the page as they are. */
export const staticPaths = ["wasm", "og.png"];

/**
 * Bundle site/src/worker.ts to `<outdir>/worker.js`, or to memory without
 * `outdir`. The page loads it as ./worker.js: Bun's bundler does not follow
 * `new Worker(new URL(...))`, so the worker is an entry point of its own.
 */
export async function buildWorker(opts: { outdir?: string; minify: boolean }): Promise<Bun.BuildOutput> {
  const result = await Bun.build({
    entrypoints: [join(site, "src/worker.ts")],
    plugins: [solid],
    target: "browser",
    minify: opts.minify,
    naming: "worker.js",
    ...(opts.outdir === undefined ? {} : { outdir: opts.outdir }),
  });
  if (!result.success) throw new AggregateError(result.logs, "worker build failed");
  return result;
}
