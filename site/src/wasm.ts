// Loads the committed WASM builds in site/public/wasm/ (scripts/build-wasm.sh).
// They are served as they are, not bundled, hence the runtime imports below.
// Shared by the worker (browser) and wasm.test.ts (Bun), which differ only in
// the base URL: http(s) in the browser, file:// under Bun.

import { isRecord, type GoLayout, type HeapStats, type Lang } from "./live.ts";

/** The API both builds expose; only Go has `heapStats`, `forceGC` and `setLayout`. */
export interface Cache {
  /** Build a fresh, pre-filled cache of `capacity`, replacing any old one. */
  init(capacity: number): void;
  /** Percent of operations that are reads, 0..100; kept across `init`. */
  setReadRatio(pct: number): void;
  /** Run `n` operations; elapsed milliseconds, or NaN before `init`. */
  runBatch(n: number): number;
  heapStats?: () => HeapStats;
  forceGC?: () => void;
  /** The layout for the next `init`; kept across `init`. */
  setLayout?: (layout: GoLayout) => void;
}

interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

declare global {
  /** Set by wasm_exec.js. */
  var Go: (new () => GoRuntime) | undefined;
  /** Set by the Go build's main(). */
  var readStateGo: unknown;
}

function isFn(x: unknown): x is (...args: never[]) => unknown {
  return typeof x === "function";
}

function isHeapStats(x: unknown): x is HeapStats {
  return (
    isRecord(x) &&
    typeof x["heapAlloc"] === "number" &&
    typeof x["numGC"] === "number" &&
    typeof x["lastPauseMs"] === "number"
  );
}

/** Wrap a module's untyped `init`/`setReadRatio`/`runBatch` (and Go's extras) as a `Cache`. */
function toCache(m: unknown, lang: Lang): Cache {
  if (!isRecord(m) || !isFn(m["init"]) || !isFn(m["setReadRatio"]) || !isFn(m["runBatch"])) {
    throw new Error(`${lang} build does not expose init, setReadRatio and runBatch`);
  }
  const { init, setReadRatio, runBatch, heapStats, forceGC, setLayout } = m;
  const cache: Cache = {
    init: (capacity) => {
      Reflect.apply(init, m, [capacity]);
    },
    setReadRatio: (pct) => {
      Reflect.apply(setReadRatio, m, [pct]);
    },
    runBatch: (n) => {
      const ms: unknown = Reflect.apply(runBatch, m, [n]);
      return typeof ms === "number" ? ms : Number.NaN;
    },
  };
  if (isFn(heapStats)) {
    cache.heapStats = (): HeapStats => {
      const s: unknown = Reflect.apply(heapStats, m, []);
      if (!isHeapStats(s)) throw new Error(`unexpected heapStats(): ${JSON.stringify(s)}`);
      return s;
    };
  }
  if (isFn(forceGC)) cache.forceGC = (): void => void Reflect.apply(forceGC, m, []);
  if (isFn(setLayout)) cache.setLayout = (layout): void => void Reflect.apply(setLayout, m, [layout]);
  return cache;
}

async function bytes(url: URL): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.href}: HTTP ${String(res.status)}`);
  return res.arrayBuffer();
}

async function loadGo(base: URL): Promise<Cache> {
  await import(/* @vite-ignore */ new URL("go/wasm_exec.js", base).href);
  if (globalThis.Go === undefined) throw new Error("wasm_exec.js did not define Go");
  const go = new globalThis.Go();
  const { instance } = await WebAssembly.instantiate(await bytes(new URL("go/readstate.wasm", base)), go.importObject);
  // run() registers readStateGo synchronously, then blocks on select{} forever.
  void go.run(instance);
  return toCache(globalThis.readStateGo, "go");
}

async function loadRust(base: URL): Promise<Cache> {
  const mod: unknown = await import(/* @vite-ignore */ new URL("rust/read_state.js", base).href);
  if (!isRecord(mod) || !isFn(mod["default"])) throw new Error("rust build has no default init export");
  await Reflect.apply(mod["default"], mod, [{ module_or_path: await bytes(new URL("rust/read_state_bg.wasm", base)) }]);
  return toCache(mod, "rust");
}

/** Load a build from `base`, the URL the site/public/wasm/ directory is served at. */
export const loadCache: Record<Lang, (base: URL) => Promise<Cache>> = { go: loadGo, rust: loadRust };
