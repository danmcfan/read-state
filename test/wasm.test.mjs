// Loads the committed WASM builds in site/wasm/ under Node and checks the JS
// API the site relies on. Rebuild them first with scripts/build-wasm.sh.
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const wasm = new URL("../site/wasm/", import.meta.url);

async function loadGo() {
  await import(new URL("go/wasm_exec.js", wasm));
  const go = new globalThis.Go();
  const bytes = await readFile(new URL("go/readstate.wasm", wasm));
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  go.run(instance); // registers readStateGo, then blocks on select{}
  return globalThis.readStateGo;
}

async function loadRust() {
  const mod = await import(new URL("rust/read_state.js", wasm));
  const bytes = await readFile(new URL("rust/read_state_bg.wasm", wasm));
  await mod.default({ module_or_path: bytes });
  return mod;
}

for (const [name, load] of [["go", loadGo], ["rust", loadRust]]) {
  test(`${name}: init and runBatch`, async (t) => {
    const m = await load();

    await t.test("runBatch before init returns NaN", () => {
      assert.ok(Number.isNaN(m.runBatch(10)));
    });

    await t.test("runBatch returns finite positive ms", () => {
      m.init(100_000);
      const ms = m.runBatch(20_000);
      assert.ok(Number.isFinite(ms) && ms > 0, `got ${ms}`);
    });

    await t.test("init(2_000_000) succeeds", () => {
      m.init(2_000_000);
      const ms = m.runBatch(1_000);
      assert.ok(Number.isFinite(ms) && ms > 0, `got ${ms}`);
    });
  });
}

test("go: forceGC increases numGC", async () => {
  const m = await loadGo();
  m.init(100_000);
  const before = m.heapStats();
  assert.equal(typeof before.heapAlloc, "number");
  assert.equal(typeof before.lastPauseMs, "number");
  m.forceGC();
  const after = m.heapStats();
  assert.ok(after.numGC > before.numGC, `${before.numGC} -> ${after.numGC}`);
});
