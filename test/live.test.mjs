// Pure helpers behind the live latency chart in site/live.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window, gcEvent, niceMax, polyline } from "../site/live.mjs";

test("Window keeps only samples inside the time span", () => {
  const w = new Window(1000);
  w.push({ t: 0, ms: 1 });
  w.push({ t: 600, ms: 2 });
  w.push({ t: 1500, ms: 3 });
  assert.deepEqual(w.samples.map((s) => s.t), [600, 1500]);
  assert.equal(w.end, 1500);
  assert.equal(w.start, 500);
});

test("Window.max ignores samples outside the span", () => {
  const w = new Window(1000);
  w.push({ t: 0, ms: 50 });
  w.push({ t: 2000, ms: 4 });
  assert.equal(w.max(), 4);
});

test("gcEvent reports new collections and the latest pause", () => {
  assert.equal(gcEvent(null, { numGC: 3, lastPauseMs: 1 }), null);
  assert.equal(gcEvent({ numGC: 3 }, { numGC: 3, lastPauseMs: 1 }), null);
  assert.deepEqual(gcEvent({ numGC: 3 }, { numGC: 5, lastPauseMs: 0.4 }), { count: 2, pauseMs: 0.4 });
});

test("niceMax rounds up to 1, 2 or 5 times a power of ten", () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(0.7), 1);
  assert.equal(niceMax(1.3), 2);
  assert.equal(niceMax(3), 5);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(48), 50);
  assert.equal(niceMax(120), 200);
});

test("polyline maps samples into the plot box", () => {
  const box = { left: 10, top: 0, width: 100, height: 50 };
  const pts = polyline([{ t: 0, ms: 0 }, { t: 1000, ms: 10 }, { t: 500, ms: 20 }], 0, 1000, 10, box);
  // Values above yMax are clamped to the top edge.
  assert.equal(pts, "10.0,50.0 110.0,0.0 60.0,0.0");
});
