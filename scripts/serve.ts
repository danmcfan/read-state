// `bun run dev`: serve site/ with hot reload on PORT (default 3000). Bun
// bundles the page itself (Solid JSX through bunfig.toml's plugin); this adds
// the worker, rebuilt on each request, and the static files beside the page.

import { join, normalize } from "node:path";
import index from "../site/index.html";
import { buildWorker, site, staticPaths } from "./site.ts";

const server = Bun.serve({
  port: Number(process.env["PORT"] ?? 3000),
  development: true,
  routes: {
    "/": index,
    "/worker.js": async () => {
      const [out] = (await buildWorker({ minify: false })).outputs;
      if (out === undefined) return new Response("worker build produced no output", { status: 500 });
      return new Response(out, { headers: { "content-type": "text/javascript" } });
    },
  },
  async fetch(req) {
    const path = normalize(decodeURIComponent(new URL(req.url).pathname)).slice(1);
    if (!staticPaths.some((p) => path === p || path.startsWith(`${p}/`))) {
      return new Response("not found", { status: 404 });
    }
    const file = Bun.file(join(site, path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

console.log(`serving site/ at ${server.url.href}`);
