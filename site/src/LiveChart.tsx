// Streams per-batch latency from the Go and Rust WASM builds, each in its own
// worker, with Go's collections as dashed lines (issue #17).

import { createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { BOX, niceMax, polyline, xAt, yAt, type Scale } from "./chart.ts";
import { TimeWindow, isWorkerMessage, type Lang, type WorkerRequest } from "./live.ts";

const SPAN_MS = 30_000;
const CAPACITY = 2_000_000;
const BATCH = 20_000;
const LANGS: readonly Lang[] = ["go", "rust"];

function fmt(ms: number): string {
  return ms > 0 && ms < 10 ? ms.toFixed(1) : String(Math.round(ms));
}

function latest(w: TimeWindow): string {
  const s = w.samples.at(-1);
  return s === undefined ? "loading" : `${fmt(s.ms)} ms`;
}

interface Run {
  windows: Record<Lang, TimeWindow>;
  workers: Worker[];
}

export function LiveChart(): JSX.Element {
  const [run, setRun] = createSignal<Run>();
  // Bumped once per animation frame after new samples, so the chart redraws
  // at most once a frame however fast the workers post.
  const [frame, setFrame] = createSignal(0);
  const [status, setStatus] = createSignal("Not running. Uses two CPU cores while running.");
  let pending = 0;

  const redraw = (): void => {
    pending ||= requestAnimationFrame(() => {
      pending = 0;
      setFrame((n) => n + 1);
    });
  };

  const stop = (): void => {
    run()?.workers.forEach((w) => {
      w.terminate();
    });
    cancelAnimationFrame(pending);
    pending = 0;
    setRun(undefined);
    setStatus("Stopped.");
  };

  const start = (): void => {
    const windows = { go: new TimeWindow(SPAN_MS), rust: new TimeWindow(SPAN_MS) };
    const workers = LANGS.map((lang) => {
      const w = new Worker(new URL("worker.ts", import.meta.url), { type: "module" });
      w.addEventListener("message", (e: MessageEvent<unknown>) => {
        const msg = e.data;
        if (!isWorkerMessage(msg)) return;
        switch (msg.kind) {
          case "ready":
            return;
          case "error":
            stop();
            setStatus(`${lang} failed to start: ${msg.error}`);
            return;
          case "sample":
            windows[lang].add(msg.sample);
            redraw();
        }
      });
      const req: WorkerRequest = { lang, capacity: CAPACITY, batch: BATCH };
      w.postMessage(req);
      return w;
    });
    setRun({ windows, workers });
    setStatus("Loading and filling both caches...");
  };

  onCleanup(stop);

  // Everything below reads frame() so it recomputes on each redraw.
  const view = (): { scale: Scale; windows: Record<Lang, TimeWindow> } | undefined => {
    frame();
    const r = run();
    if (r === undefined) return undefined;
    const all = LANGS.map((l) => r.windows[l]);
    const t1 = Math.max(...all.map((w) => w.end));
    return { scale: { t0: t1 - SPAN_MS, t1, yMax: niceMax(Math.max(...all.map((w) => w.max()))) }, windows: r.windows };
  };

  const stats = (): string => {
    const v = view();
    if (v === undefined || v.windows.go.samples.length + v.windows.rust.samples.length === 0) return status();
    return `Go ${latest(v.windows.go)} · Rust ${latest(v.windows.rust)} · ${String(v.windows.go.gcCount())} Go GCs in view`;
  };

  return (
    <>
      <div class="plot">
        <svg viewBox="0 0 680 250" role="img" aria-label="Live per-batch latency for Go and Rust">
          <Show when={view()}>
            {(v) => (
              <>
                <For each={[0, 0.5, 1]}>
                  {(f) => {
                    const y = (): number => yAt(f * v().scale.yMax, v().scale, BOX);
                    return (
                      <>
                        <line x1={BOX.left} x2={BOX.left + BOX.width} y1={y()} y2={y()} stroke="var(--border)" />
                        <text x={BOX.left - 8} y={y() + 4} text-anchor="end">
                          {`${fmt(f * v().scale.yMax)} ms`}
                        </text>
                      </>
                    );
                  }}
                </For>
                <g class="gc">
                  <For each={v().windows.go.samples.filter((s) => s.gc !== undefined && s.t >= v().scale.t0)}>
                    {(s) => (
                      <line
                        x1={xAt(s.t, v().scale, BOX)}
                        x2={xAt(s.t, v().scale, BOX)}
                        y1={BOX.top - 4}
                        y2={BOX.top + BOX.height}
                      />
                    )}
                  </For>
                </g>
                <For each={LANGS}>
                  {(lang) => (
                    <polyline
                      class={`${lang}-line`}
                      fill="none"
                      stroke-width="2"
                      stroke-linejoin="round"
                      stroke={`var(--${lang}-fill)`}
                      points={polyline(
                        v().windows[lang].samples.map((s) => ({ t: s.t, v: s.ms })),
                        v().scale,
                        BOX,
                      )}
                    />
                  )}
                </For>
              </>
            )}
          </Show>
        </svg>
      </div>
      <div class="live-bar">
        <button
          class="copy"
          type="button"
          onClick={() => {
            if (run() === undefined) start();
            else stop();
          }}
        >
          {run() === undefined ? "Start" : "Stop"}
        </button>
        <span class="stats">{stats()}</span>
      </div>
    </>
  );
}
