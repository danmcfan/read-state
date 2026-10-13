// Runs one cache off the main thread and streams a sample per batch. Built to
// ./worker.js beside the page (scripts/build.ts, scripts/serve.ts), because
// Bun's bundler does not follow `new Worker(new URL(...))`.

import { gcEvent, type HeapStats, type WorkerMessage, type WorkerRequest } from "./live.ts";
import { loadCache, type Cache } from "./wasm.ts";

function send(msg: WorkerMessage): void {
  postMessage(msg);
}

function loop(cache: Cache, batch: number, prev: HeapStats | undefined): void {
  const ms = cache.runBatch(batch);
  const t = performance.timeOrigin + performance.now();
  const stats = cache.heapStats?.();
  const gc = stats === undefined ? undefined : gcEvent(prev, stats);
  send({ kind: "sample", sample: gc === undefined ? { t, ms } : { t, ms, gc } });
  setTimeout(() => {
    loop(cache, batch, stats);
  }, 0);
}

async function start({ lang, capacity, batch }: WorkerRequest): Promise<void> {
  try {
    const cache = await loadCache[lang](new URL("./wasm/", location.href));
    cache.init(capacity);
    send({ kind: "ready" });
    loop(cache, batch, cache.heapStats?.());
  } catch (error) {
    send({ kind: "error", error: String(error) });
  }
}

addEventListener("message", (e: MessageEvent<WorkerRequest>) => void start(e.data), { once: true });
