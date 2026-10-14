import { expect, test } from "bun:test";
import { TimeWindow, formatCount, gcEvent, isWorkerMessage, settingsChanges } from "./live.ts";

test("TimeWindow keeps only samples inside the time span", () => {
  const w = new TimeWindow(1000);
  w.add({ t: 0, ms: 1 });
  w.add({ t: 600, ms: 2 });
  w.add({ t: 1500, ms: 3 });
  expect(w.samples.map((s) => s.t)).toEqual([600, 1500]);
  expect(w.end).toBe(1500);
  expect(w.start).toBe(500);
});

test("TimeWindow.max ignores samples outside the span", () => {
  const w = new TimeWindow(1000);
  w.add({ t: 0, ms: 50 });
  w.add({ t: 2000, ms: 4 });
  expect(w.max()).toBe(4);
});

test("TimeWindow.gcCount sums collections in the span", () => {
  const w = new TimeWindow(1000);
  w.add({ t: 0, ms: 1, gc: { count: 5, pauseMs: 0 } });
  w.add({ t: 1500, ms: 1, gc: { count: 2, pauseMs: 0 } });
  w.add({ t: 1600, ms: 1 });
  expect(w.gcCount()).toBe(2);
});

test("gcEvent reports new collections and the latest pause", () => {
  const stats = { heapAlloc: 0, numGC: 3, lastPauseMs: 1 };
  expect(gcEvent(undefined, stats)).toBeUndefined();
  expect(gcEvent(stats, stats)).toBeUndefined();
  expect(gcEvent(stats, { ...stats, numGC: 5, lastPauseMs: 0.4 })).toEqual({ count: 2, pauseMs: 0.4 });
});

test("isWorkerMessage accepts each message kind and rejects anything else", () => {
  expect(isWorkerMessage({ kind: "ready" })).toBe(true);
  expect(isWorkerMessage({ kind: "error", error: "boom" })).toBe(true);
  expect(isWorkerMessage({ kind: "sample", sample: { t: 1, ms: 2 } })).toBe(true);
  expect(isWorkerMessage({ kind: "sample", sample: { t: 1, ms: 2, gc: { count: 1, pauseMs: 0 } } })).toBe(true);
  expect(isWorkerMessage({ kind: "sample", sample: { t: 1 } })).toBe(false);
  expect(isWorkerMessage({ kind: "nope" })).toBe(false);
  expect(isWorkerMessage(null)).toBe(false);
});

test("settingsChanges re-inits only when the cache size changes", () => {
  const s = { capacity: 1000, batch: 10, readPct: 50 };
  expect(settingsChanges(s, s)).toEqual({ init: false, readRatio: false });
  expect(settingsChanges(s, { ...s, batch: 20 })).toEqual({ init: false, readRatio: false });
  expect(settingsChanges(s, { ...s, readPct: 90 })).toEqual({ init: false, readRatio: true });
  expect(settingsChanges(s, { ...s, capacity: 2000 })).toEqual({ init: true, readRatio: false });
});

test("formatCount abbreviates thousands and millions", () => {
  expect(formatCount(500)).toBe("500");
  expect(formatCount(20_000)).toBe("20k");
  expect(formatCount(250_000)).toBe("250k");
  expect(formatCount(2_000_000)).toBe("2M");
});
