// Browser verification harness for `bun run verify` (docs/agents/verification.md).
// Builds the site, serves dist/ on a free port, and drives it with
// agent-browser in a session of its own. Files land in out/verify/<name>/.
//
//   await verify("live", async (v) => {
//     v.open();
//     v.click("#live-chart button");
//     await v.until("both series have samples", "document.querySelectorAll(...).length > 0");
//     v.screenshot("running", "#live-chart");
//   });

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { root } from "./site.ts";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

/** Unwrap agent-browser's `--json` envelope (`{ success, data: { result } }`). */
function unwrap(v: unknown): unknown {
  if (isRecord(v)) {
    if (v["success"] === false) throw new Error(`eval failed: ${JSON.stringify(v["error"] ?? v)}`);
    if ("data" in v) return unwrap(v["data"]);
    if ("result" in v) return v["result"];
  }
  return v;
}

function freePort(): number {
  const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = s;
  s.stop(true);
  return port;
}

/** Serve dist/ as GitHub Pages would: files as they are, index.html at /. */
function serveDist(): { url: string; stop: () => void } {
  const dist = join(root, "dist");
  const server = Bun.serve({
    port: freePort(),
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const file = Bun.file(join(dist, path === "/" ? "index.html" : path));
      return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
    },
  });
  return {
    url: server.url.href,
    stop: () => {
      void server.stop(true);
    },
  };
}

export interface Verify {
  /** out/verify/<name>/ */
  dir: string;
  /** Run an agent-browser command in this check's session; returns stdout. */
  run: (...args: string[]) => Promise<string>;
  /** Evaluate `js` in the page; returns its result. */
  eval: (js: string) => Promise<unknown>;
  /**
   * Open the page at `path` (default /) in `theme` (default light) and wait
   * for it to load. Always emulates reduced motion: the page's smooth
   * scrolling otherwise moves elements under agent-browser's clicks and
   * element screenshots.
   */
  open: (path?: string, theme?: "light" | "dark") => Promise<void>;
  click: (selector: string) => Promise<void>;
  /** Poll `js` every 250 ms until it is truthy, or fail after `ms`. */
  until: (what: string, js: string, ms?: number) => Promise<void>;
  /**
   * Screenshot the viewport to <dir>/<name>.png, first centring `selector` in
   * it if given. (agent-browser's element screenshots clip the wrong region
   * once the page has scrolled.)
   */
  screenshot: (name: string, selector?: string) => Promise<string>;
  /** Record a passing check; throw with `got` if it fails. */
  check: (ok: boolean, what: string, got?: unknown) => void;
  /** Throw if the page logged any error. */
  assertNoErrors: () => Promise<void>;
}

export async function verify(name: string, body: (v: Verify) => Promise<void>): Promise<void> {
  const dir = join(root, "out/verify", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const built = Bun.spawnSync(["bun", "run", "build"], { cwd: root, stdout: "ignore", stderr: "inherit" });
  if (built.exitCode !== 0) throw new Error("bun run build failed");
  // From here on, spawn asynchronously: the server below runs in this process,
  // and a blocking spawn would stop it answering the browser.
  const server = serveDist();

  const session = `read-state-verify-${name}`;
  const run = async (...args: string[]): Promise<string> => {
    const p = Bun.spawn(["agent-browser", "--session", session, ...args], { stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    if (code !== 0) throw new Error(`agent-browser ${args.join(" ")} failed: ${err}${out}`);
    return out;
  };
  const evalJs = async (js: string): Promise<unknown> => {
    const out: unknown = JSON.parse(await run("--json", "eval", "-b", Buffer.from(js).toString("base64")));
    return unwrap(out);
  };

  const v: Verify = {
    dir,
    run,
    eval: evalJs,
    open: async (path = "/", theme = "light") => {
      await run("set", "media", theme, "reduced-motion");
      await run("open", new URL(path, server.url).href);
      await run("wait", "--load", "load");
    },
    click: async (selector) => {
      await run("click", selector);
    },
    until: async (what, js, ms = 30_000) => {
      const deadline = Date.now() + ms;
      const poll = async (): Promise<void> => {
        if ((await evalJs(`Boolean(${js})`)) === true) return;
        if (Date.now() > deadline) throw new Error(`timed out after ${String(ms)} ms waiting for: ${what}`);
        await Bun.sleep(250);
        await poll();
      };
      await poll();
      console.log(`  ok  ${what}`);
    },
    screenshot: async (shot, selector) => {
      const path = join(dir, `${shot}.png`);
      if (selector !== undefined) {
        await evalJs(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center" })`);
      }
      await run("screenshot", path);
      console.log(`  png ${path}`);
      return path;
    },
    check: (ok, what, got) => {
      if (!ok) throw new Error(`FAILED: ${what}${got === undefined ? "" : `\n  got: ${JSON.stringify(got)}`}`);
      console.log(`  ok  ${what}`);
    },
    assertNoErrors: async () => {
      const errors = (await run("errors")).trim();
      if (errors !== "") throw new Error(`page errors:\n${errors}`);
      console.log("  ok  no page errors");
    },
  };

  console.log(`verify ${name}:`);
  try {
    await body(v);
    console.log(`verify ${name}: passed`);
  } catch (error) {
    console.error(`verify ${name}: FAILED\n${String(error)}`);
    process.exitCode = 1;
  } finally {
    try {
      await run("close");
    } catch {
      // The session may already be gone.
    }
    server.stop();
  }
}
