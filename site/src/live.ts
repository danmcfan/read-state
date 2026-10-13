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

/** Page to worker: load `lang`, fill a cache of `capacity`, then run batches of `batch` forever. */
export interface WorkerRequest {
  lang: Lang;
  capacity: number;
  batch: number;
}

/** Worker to page. */
export type WorkerMessage = { kind: "ready" } | { kind: "error"; error: string } | { kind: "sample"; sample: Sample };

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
