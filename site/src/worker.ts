// Runs one cache off the main thread and streams a sample per batch. Requests
// arrive between batches, so settings and forced collections apply mid-run.
// Any failure, at load or later, is reported and ends the run.

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

let loaded: Cache | undefined;
// The latest settings asked for, including any that arrive while loading.
let current: Settings | undefined;
let failed = false;

function send(msg: WorkerMessage): void {
  postMessage(msg);
}

/** Run `step`, or report its error and stop everything after it. */
function guard(step: () => void): void {
  if (failed) return;
  try {
    step();
  } catch (error) {
    failed = true;
    send({ kind: "error", error: String(error) });
  }
}

function fill(cache: Cache, capacity: number): void {
  send({ kind: "filling" });
  cache.init(capacity);
  send({ kind: "ready" });
}

function loop(cache: Cache, prev: HeapStats | undefined): void {
  guard(() => {
    const ms = cache.runBatch(current?.batch ?? 0);
    const t = performance.timeOrigin + performance.now();
    const stats = cache.heapStats?.();
    const gc = stats === undefined ? undefined : gcEvent(prev, stats);
    send({ kind: "sample", sample: gc === undefined ? { t, ms } : { t, ms, gc } });
    setTimeout(() => {
      loop(cache, stats);
    }, 0);
  });
}

async function start(lang: Lang, first: Settings): Promise<void> {
  current = first;
  let cache: Cache;
  try {
    cache = await loadCache[lang](new URL("/wasm/", location.origin));
  } catch (error) {
    guard(() => {
      throw error;
    });
    return;
  }
  guard(() => {
    const settings = current ?? first;
    cache.setReadRatio(settings.readPct);
    fill(cache, settings.capacity);
    loaded = cache;
    loop(cache, cache.heapStats?.());
  });
}

function update(next: Settings): void {
  const prev = current;
  current = next;
  // Before load, start() applies the latest settings itself.
  if (loaded === undefined || prev === undefined) return;
  const cache = loaded;
  const changes = settingsChanges(prev, next);
  guard(() => {
    if (changes.readRatio) cache.setReadRatio(next.readPct);
    if (changes.init) fill(cache, next.capacity);
  });
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
      guard(() => loaded?.forceGC?.());
  }
});
