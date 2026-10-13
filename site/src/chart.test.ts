import { expect, test } from "bun:test";
import { niceMax, polyline } from "./chart.ts";

test("niceMax rounds up to 1, 2 or 5 times a power of ten", () => {
  expect([0, 0.7, 1.3, 3, 7, 48, 120].map((v) => niceMax(v))).toEqual([1, 1, 2, 5, 10, 50, 200]);
});

test("polyline maps points into the plot box and clamps values above yMax", () => {
  const box = { left: 10, top: 0, width: 100, height: 50 };
  const points = [
    { t: 0, v: 0 },
    { t: 1000, v: 10 },
    { t: 500, v: 20 },
  ];
  expect(polyline(points, { t0: 0, t1: 1000, yMax: 10 }, box)).toBe("10.0,50.0 110.0,0.0 60.0,0.0");
});
