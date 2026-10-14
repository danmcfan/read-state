// Runs one cache off the main thread and streams a sample per batch. Requests
// arrive between batches, so settings and forced collections apply mid-run.

import {
  gcEvent,
  settingsChanges,
  type HeapStats,
  type Lang,
  type Settings,
  type WorkerMessage,
  type WorkerRequest,
} from "./live.ts";
import { loadCache, type Cache } from "./wasm.ts";

let cache: Cache | undefined;
// The latest settings asked for, including any that arrive while loading.
let settings: Settings | undefined;

function send(msg: WorkerMessage): void {
  postMessage(msg);
}

function loop(c: Cache, s: Settings, prev: HeapStats | undefined): void {
  const ms = c.runBatch(s.batch);
  const t = performance.timeOrigin + performance.now();
  const stats = c.heapStats?.();
  const gc = stats === undefined ? undefined : gcEvent(prev, stats);
  send({ kind: "sample", sample: gc === undefined ? { t, ms } : { t, ms, gc } });
  setTimeout(() => {
    loop(c, settings ?? s, stats);
  }, 0);
}

async function start(lang: Lang, first: Settings): Promise<void> {
  settings = first;
  try {
    const c = await loadCache[lang](new URL("/wasm/", location.origin));
    const s = settings;
    c.setReadRatio(s.readPct);
    c.init(s.capacity);
    cache = c;
    send({ kind: "ready" });
    loop(c, s, c.heapStats?.());
  } catch (error) {
    send({ kind: "error", error: String(error) });
  }
}

function update(next: Settings): void {
  if (cache === undefined || settings === undefined) {
    settings = next;
    return;
  }
  const changes = settingsChanges(settings, next);
  if (changes.readRatio) cache.setReadRatio(next.readPct);
  if (changes.init) cache.init(next.capacity);
  settings = next;
}

addEventListener("message", (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  switch (req.kind) {
    case "start":
      void start(req.lang, req.settings);
      return;
    case "settings":
      update(req.settings);
      return;
    case "gc":
      cache?.forceGC?.();
  }
});
