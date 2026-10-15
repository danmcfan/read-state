// The live run's data: samples streamed from the workers, the window the
// chart shows, and the messages between page and worker.

export type Lang = "go" | "rust";

/** Collections that ran during one batch (Go only). */
export interface GcEvent {
  count: number;
  pauseMs: number;
}

/** One batch: `t` in epoch milliseconds, so both workers share a clock. */
export interface Sample {
  t: number;
  ms: number;
  gc?: GcEvent;
}

/** Go's `heapStats()`. */
export interface HeapStats {
  heapAlloc: number;
  numGC: number;
  lastPauseMs: number;
}

/** Go's cache layout: Discord's map of pointers into a list, or pointer-free slots like Rust's. */
export type GoLayout = "list" | "slab";

/**
 * The experiment a worker runs: a cache of `capacity`, batches of `batch`,
 * `readPct` percent reads. `goLayout` applies to Go only.
 */
export interface Settings {
  capacity: number;
  batch: number;
  readPct: number;
  goLayout: GoLayout;
}

/**
 * Page to worker. `start` loads `lang`, fills the cache, then runs batches
 * forever; `settings` changes the experiment mid-run; `gc` forces a Go
 * collection.
 */
export type WorkerRequest =
  { kind: "start"; lang: Lang; settings: Settings } | { kind: "settings"; settings: Settings } | { kind: "gc" };

/**
 * What a worker must redo to move from `prev` to `next`; the batch size just
 * applies to the next batch. A new layout needs a refill, but only in Go.
 */
export function settingsChanges(
  prev: Settings,
  next: Settings,
): { init: boolean; readRatio: boolean; layout: boolean } {
  return {
    init: prev.capacity !== next.capacity,
    readRatio: prev.readPct !== next.readPct,
    layout: prev.goLayout !== next.goLayout,
  };
}

/** 500, 20k, 2M. */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${String(n / 1_000_000)}M`;
  if (n >= 1000) return `${String(n / 1000)}k`;
  return String(n);
}

/** Worker to page: `filling` before each cache fill, `ready` once batches run, `error` when the worker stops. */
export type WorkerMessage =
  { kind: "filling" } | { kind: "ready" } | { kind: "error"; error: string } | { kind: "sample"; sample: Sample };

/** The samples from the last `span` milliseconds. */
export class TimeWindow {
  samples: Sample[] = [];
  end = 0;
  readonly span: number;

  constructor(span: number) {
    this.span = span;
  }

  get start(): number {
    return this.end - this.span;
  }

  add(sample: Sample): void {
    this.samples.push(sample);
    this.end = Math.max(this.end, sample.t);
    const first = this.samples.findIndex((s) => s.t >= this.start);
    this.samples.splice(0, first);
  }

  max(): number {
    return this.samples.reduce((m, s) => Math.max(m, s.ms), 0);
  }

  gcCount(): number {
    return this.samples.reduce((n, s) => n + (s.gc?.count ?? 0), 0);
  }
}

/** The collections that ran between two `heapStats()` readings, if any. */
export function gcEvent(prev: HeapStats | undefined, next: HeapStats): GcEvent | undefined {
  if (prev === undefined || next.numGC <= prev.numGC) return undefined;
  return { count: next.numGC - prev.numGC, pauseMs: next.lastPauseMs };
}

export function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object";
}

function isGcEvent(x: unknown): x is GcEvent {
  return isRecord(x) && typeof x["count"] === "number" && typeof x["pauseMs"] === "number";
}

function isSample(x: unknown): x is Sample {
  return (
    isRecord(x) &&
    typeof x["t"] === "number" &&
    typeof x["ms"] === "number" &&
    (x["gc"] === undefined || isGcEvent(x["gc"]))
  );
}

export function isWorkerMessage(x: unknown): x is WorkerMessage {
  if (!isRecord(x)) return false;
  switch (x["kind"]) {
    case "filling":
    case "ready":
      return true;
    case "error":
      return typeof x["error"] === "string";
    case "sample":
      return isSample(x["sample"]);
    default:
      return false;
  }
}
