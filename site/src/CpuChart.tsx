// The recorded 10-minute CPU run (cpu-run.json): a chart with a hover
// readout, and the same data as a table.

import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
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
  const [hover, setHover] = createSignal<{ i: number; left: number; top: number }>();
  const [drawn, setDrawn] = createSignal(false);
  let plot: HTMLDivElement | undefined;
  let svg: SVGSVGElement | undefined;

  onMount(() => {
    if (plot === undefined) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setDrawn(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(plot);
    onCleanup(() => {
      io.disconnect();
    });
  });

  const move = (e: PointerEvent): void => {
    const ctm = svg?.getScreenCTM();
    if (svg === undefined || plot === undefined || ctm === null || ctm === undefined) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const t = ((p.x - BOX.left) / BOX.width) * SCALE.t1;
    const box = plot.getBoundingClientRect();
    let left = e.clientX - box.left + plot.scrollLeft + 12;
    if (left + 110 > plot.scrollLeft + box.width) left -= 130;
    setHover({ i: nearest(t), left, top: e.clientY - box.top + 12 });
  };

  return (
    <div
      class="plot"
      classList={{ draw: drawn() }}
      ref={(el) => {
        plot = el;
      }}
    >
      <svg
        viewBox="0 0 680 250"
        role="img"
        aria-label={LABEL}
        ref={(el) => {
          svg = el;
        }}
      >
        <For each={[0, 50, 100, 150, 200]}>
          {(v) => (
            <>
              <line
                x1={BOX.left}
                x2={BOX.left + BOX.width}
                y1={yAt(v, SCALE, BOX)}
                y2={yAt(v, SCALE, BOX)}
                stroke="var(--border)"
              />
              <text x={36} y={yAt(v, SCALE, BOX) + 4} text-anchor="end">{`${String(v)}%`}</text>
            </>
          )}
        </For>
        <For each={[0, 2, 4, 6, 8, 10]}>
          {(min) => <text x={xAt(min * 60, SCALE, BOX)} y={240} text-anchor="middle">{`${String(min)} min`}</text>}
        </For>
        <For each={run.forcedGcSeconds}>
          {(t) => (
            <>
              <line
                x1={xAt(t, SCALE, BOX)}
                x2={xAt(t, SCALE, BOX)}
                y1={18}
                y2={BOX.top + BOX.height}
                stroke="var(--muted)"
                stroke-dasharray="3 4"
              />
              <text x={xAt(t, SCALE, BOX)} y={14} text-anchor="middle">
                forced GC
              </text>
            </>
          )}
        </For>
        <For each={series}>
          {(s) => <polyline class="line" pathLength={1} stroke={s.color} points={points(s.values)} />}
        </For>
        <Show when={hover()}>
          {(h) => (
            <line
              x1={xAt(run.t[h().i] ?? 0, SCALE, BOX)}
              x2={xAt(run.t[h().i] ?? 0, SCALE, BOX)}
              y1={BOX.top}
              y2={BOX.top + BOX.height}
              stroke="var(--muted)"
            />
          )}
        </Show>
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
      <Show when={hover()}>
        {(h) => (
          <div class="tip" style={{ left: `${String(h().left)}px`, top: `${String(h().top)}px` }}>
            <b>{clock(run.t[h().i] ?? 0)}</b>
            <br />
            Go {run.go[h().i]}%
            <br />
            Rust {run.rust[h().i]}%
          </div>
        )}
      </Show>
    </div>
  );
}

export function CpuTable(): JSX.Element {
  return (
    <details>
      <summary>Show the data as a table</summary>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Seconds</th>
              <th>Go CPU</th>
              <th>Rust CPU</th>
            </tr>
          </thead>
          <tbody>
            <For each={run.t}>
              {(t, i) => (
                <tr>
                  <td>{t}</td>
                  <td>{run.go[i()]}%</td>
                  <td>{run.rust[i()]}%</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </details>
  );
}
