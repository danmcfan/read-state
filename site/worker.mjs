// Runs one cache (Go or Rust WASM) off the main thread and streams a sample
// per batch: { t, ms, gc? }, with t in epoch milliseconds so samples from
// both workers share a clock. Start it with { lang, capacity, batch }.
import { gcEvent } from "./live.mjs";

async function load(lang) {
  if (lang === "go") {
    await import("./wasm/go/wasm_exec.js");
    const go = new globalThis.Go();
    const { instance } = await WebAssembly.instantiateStreaming(fetch("./wasm/go/readstate.wasm"), go.importObject);
    go.run(instance); // registers readStateGo, then blocks on select{}
    return globalThis.readStateGo;
  }
  const mod = await import("./wasm/rust/read_state.js");
  await mod.default({ module_or_path: new URL("./wasm/rust/read_state_bg.wasm", import.meta.url) });
  return mod;
}

onmessage = async ({ data: { lang, capacity, batch } }) => {
  try {
    const m = await load(lang);
    m.init(capacity);
    postMessage({ ready: true });
    let stats = m.heapStats?.();
    const loop = () => {
      const ms = m.runBatch(batch);
      const sample = { t: performance.timeOrigin + performance.now(), ms };
      if (m.heapStats) {
        const next = m.heapStats();
        const gc = gcEvent(stats, next);
        if (gc) sample.gc = gc;
        stats = next;
      }
      postMessage(sample);
      setTimeout(loop, 0);
    };
    loop();
  } catch (err) {
    postMessage({ error: String(err) });
  }
};
