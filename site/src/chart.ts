// Pure SVG chart math shared by the recorded CPU chart and the live chart.

/** One value `v` at time `t`, in whatever units the chart plots. */
export interface Point {
  t: number;
  v: number;
}

/** The plot area inside an SVG viewBox. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Time `t0..t1` runs across the box; values `0..yMax` run up it. */
export interface Scale {
  t0: number;
  t1: number;
  yMax: number;
}

/** Both charts use a 680x250 viewBox with this plot area. */
export const BOX: Box = { left: 44, top: 22, width: 624, height: 200 };

export function xAt(t: number, scale: Scale, box: Box): number {
  return box.left + ((t - scale.t0) / (scale.t1 - scale.t0)) * box.width;
}

export function yAt(v: number, scale: Scale, box: Box): number {
  return box.top + box.height * (1 - Math.min(v, scale.yMax) / scale.yMax);
}

/** Rounds `v` up to 1, 2 or 5 times a power of ten, for the y axis. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * p).find((top) => v <= top) ?? 10 * p;
}

/** Points as an SVG `points` string, clamping values above `yMax` to the top edge. */
export function polyline(points: readonly Point[], scale: Scale, box: Box): string {
  return points.map((p) => `${xAt(p.t, scale, box).toFixed(1)},${yAt(p.v, scale, box).toFixed(1)}`).join(" ");
}

/** Length of a bar for `v` out of `max` across `width`, never under `min` so a tiny value still shows. */
export function barWidth(v: number, max: number, width: number, min = 2): number {
  return Math.max(min, (v / max) * width);
}
