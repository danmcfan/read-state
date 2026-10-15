// The recorded 10-minute CPU run (cpu-run.json): a chart with a hover
// readout, and the same data as a table.

import { useEffect, useRef, useState, type JSX, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { BOX, polyline, xAt, yAt, type Scale } from "./chart.ts";
import run from "./cpu-run.json";

const SCALE: Scale = { t0: 0, t1: 600, yMax: 200 };
const series = [
  { name: "Rust", values: run.rust, color: "var(--rust-fill)" },
  { name: "Go", values: run.go, color: "var(--go-fill)" },
] as const;

function points(values: readonly number[]): string {
  return polyline(
    run.t.map((t, i) => ({ t, v: values[i] ?? 0 })),
    SCALE,
    BOX,
  );
}

function clock(t: number): string {
  return `${String(Math.floor(t / 60))}:${String(t % 60).padStart(2, "0")}`;
}

/** Index of the sample nearest time `t`. */
function nearest(t: number): number {
  return run.t.reduce((best, s, i) => (Math.abs(s - t) < Math.abs((run.t[best] ?? 0) - t) ? i : best), 0);
}

const LABEL =
  "CPU use over 10 minutes. Go jumps to 147 to 195 percent right after each forced garbage collection, " +
  "about every two minutes. Rust stays between about 30 and 70 percent with no spikes.";

export function CpuChart(): JSX.Element {
  const [hover, setHover] = useState<{ i: number; left: number; top: number }>();
  const [drawn, setDrawn] = useState(false);
  const plot = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setDrawn(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    if (plot.current !== null) io.observe(plot.current);
    return (): void => {
      io.disconnect();
    };
  }, []);

  const move = (e: PointerEvent<SVGRectElement>): void => {
    const ctm = svg.current?.getScreenCTM();
    const el = plot.current;
    if (el === null || ctm === null || ctm === undefined) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const t = ((p.x - BOX.left) / BOX.width) * SCALE.t1;
    const box = el.getBoundingClientRect();
    let left = e.clientX - box.left + el.scrollLeft + 12;
    if (left + 110 > el.scrollLeft + box.width) left -= 130;
    setHover({ i: nearest(t), left, top: e.clientY - box.top + 12 });
  };

  const hoverX = hover === undefined ? 0 : xAt(run.t[hover.i] ?? 0, SCALE, BOX);

  return (
    <div className={cn("plot", { draw: drawn })} ref={plot}>
      <svg viewBox="0 0 680 250" role="img" aria-label={LABEL} ref={svg}>
        {[0, 50, 100, 150, 200].map((v) => (
          <g key={v}>
            <line
              x1={BOX.left}
              x2={BOX.left + BOX.width}
              y1={yAt(v, SCALE, BOX)}
              y2={yAt(v, SCALE, BOX)}
              stroke="var(--border)"
            />
            <text x={36} y={yAt(v, SCALE, BOX) + 4} textAnchor="end">{`${String(v)}%`}</text>
          </g>
        ))}
        {[0, 2, 4, 6, 8, 10].map((min) => (
          <text key={min} x={xAt(min * 60, SCALE, BOX)} y={240} textAnchor="middle">{`${String(min)} min`}</text>
        ))}
        {run.forcedGcSeconds.map((t) => (
          <g key={t}>
            <line
              x1={xAt(t, SCALE, BOX)}
              x2={xAt(t, SCALE, BOX)}
              y1={18}
              y2={BOX.top + BOX.height}
              stroke="var(--muted)"
              strokeDasharray="3 4"
            />
            <text x={xAt(t, SCALE, BOX)} y={14} textAnchor="middle">
              forced GC
            </text>
          </g>
        ))}
        {series.map((s) => (
          <polyline key={s.name} className="line" pathLength={1} stroke={s.color} points={points(s.values)} />
        ))}
        {hover !== undefined && (
          <line x1={hoverX} x2={hoverX} y1={BOX.top} y2={BOX.top + BOX.height} stroke="var(--muted)" />
        )}
        <rect
          x={BOX.left}
          y={BOX.top}
          width={BOX.width}
          height={BOX.height}
          fill="transparent"
          onPointerMove={move}
          onPointerLeave={() => {
            setHover(undefined);
          }}
        />
      </svg>
      {hover !== undefined && (
        <div className="tip" style={{ left: `${String(hover.left)}px`, top: `${String(hover.top)}px` }}>
          <b>{clock(run.t[hover.i] ?? 0)}</b>
          <br />
          Go {run.go[hover.i]}%
          <br />
          Rust {run.rust[hover.i]}%
        </div>
      )}
    </div>
  );
}

export function CpuTable(): JSX.Element {
  return (
    <details>
      <summary>Show the data as a table</summary>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Seconds</th>
              <th>Go CPU</th>
              <th>Rust CPU</th>
            </tr>
          </thead>
          <tbody>
            {run.t.map((t, i) => (
              <tr key={t}>
                <td>{t}</td>
                <td>{run.go[i]}%</td>
                <td>{run.rust[i]}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
