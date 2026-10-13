// Pure helpers for the live latency chart: no DOM, so they run under Node.

// Window holds the samples ({ t, ms, gc? }) from the last `span` milliseconds.
export class Window {
  constructor(span) {
    this.span = span;
    this.samples = [];
    this.end = 0;
  }
  get start() {
    return this.end - this.span;
  }
  push(sample) {
    this.samples.push(sample);
    this.end = Math.max(this.end, sample.t);
    const start = this.start;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop].t < start) drop++;
    if (drop) this.samples.splice(0, drop);
  }
  max() {
    return this.samples.reduce((m, s) => Math.max(m, s.ms), 0);
  }
}

// gcEvent compares two Go heapStats() readings and returns the collections
// that ran between them, or null if none did.
export function gcEvent(prev, next) {
  if (!prev || next.numGC <= prev.numGC) return null;
  return { count: next.numGC - prev.numGC, pauseMs: next.lastPauseMs };
}

// niceMax rounds v up to 1, 2 or 5 times a power of ten, for the y axis.
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p;
}

// polyline maps samples into box ({ left, top, width, height }) with time
// t0..t1 across and 0..yMax up, as an SVG points string.
export function polyline(samples, t0, t1, yMax, box) {
  return samples
    .map((s) => {
      const x = box.left + ((s.t - t0) / (t1 - t0)) * box.width;
      const y = box.top + box.height * (1 - Math.min(s.ms, yMax) / yMax);
      return x.toFixed(1) + "," + y.toFixed(1);
    })
    .join(" ");
}
