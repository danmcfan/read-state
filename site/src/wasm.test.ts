// Loads the committed WASM builds in site/public/wasm/ under Bun and checks the API
// the site relies on. Rebuild them first with `bun run build:wasm`.
import { describe, expect, test } from "bun:test";
import { loadCache } from "./wasm.ts";

const base = new URL("../public/wasm/", import.meta.url);

const caches = { go: await loadCache.go(base), rust: await loadCache.rust(base) };

for (const lang of ["go", "rust"] as const) {
  describe(lang, () => {
    const cache = caches[lang];

    test("runBatch before init returns NaN", () => {
      expect(cache.runBatch(10)).toBeNaN();
    });

    test("runBatch returns finite positive ms", () => {
      cache.init(100_000);
      const ms = cache.runBatch(20_000);
      expect(Number.isFinite(ms) && ms > 0).toBe(true);
    });

    test("setReadRatio holds across init", () => {
      cache.setReadRatio(100);
      cache.init(100_000);
      expect(cache.runBatch(20_000)).toBeGreaterThan(0);
      cache.setReadRatio(50);
    });

    test("init(2_000_000) succeeds", () => {
      cache.init(2_000_000);
      expect(cache.runBatch(1_000)).toBeGreaterThan(0);
    });
  });
}

test("go: forceGC increases numGC", async () => {
  const cache = await loadCache.go(base);
  cache.init(100_000);
  const before = cache.heapStats?.();
  cache.forceGC?.();
  const after = cache.heapStats?.();
  expect(after?.numGC ?? 0).toBeGreaterThan(before?.numGC ?? Infinity);
});

test("go: setLayout holds across init and keeps the cache working", async () => {
  const cache = await loadCache.go(base);
  expect(cache.setLayout).toBeDefined();
  cache.setLayout?.("slab");
  cache.init(100_000);
  expect(cache.runBatch(20_000)).toBeGreaterThan(0);
  cache.setLayout?.("list");
});

test("rust: has no setLayout", () => {
  expect(caches.rust.setLayout).toBeUndefined();
});
