// Streams per-batch latency from the Go and Rust WASM builds, each in its own
// worker, with Go's collections as dashed lines (issue #17). The controls run
// either language, force a Go collection and change the experiment mid-run
// (issue #19).

import { createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { BOX, niceMax, polyline, xAt, yAt, type Scale } from "./chart.ts";
import { TimeWindow, formatCount, isWorkerMessage, type Lang, type Settings, type WorkerRequest } from "./live.ts";

const SPAN_MS = 30_000;
const LANGS: readonly Lang[] = ["go", "rust"];
const NAMES: Record<Lang, string> = { go: "Go", rust: "Rust" };

const CAPACITIES = [100_000, 250_000, 500_000, 1_000_000, 2_000_000];
const BATCHES = [1000, 5000, 10_000, 20_000, 50_000, 100_000];
const READ_PCTS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const DEFAULTS: Settings = { capacity: 2_000_000, batch: 20_000, readPct: 50 };

function fmt(ms: number): string {
  return ms > 0 && ms < 10 ? ms.toFixed(1) : String(Math.round(ms));
}

function latest(w: TimeWindow): string {
  const s = w.samples.at(-1);
  return s === undefined ? "loading" : `${fmt(s.ms)} ms`;
}

interface Run {
  worker: Worker;
  window: TimeWindow;
}

/** A range input over a fixed list of values: the label follows the drag, `onCommit` fires on release. */
function Slider(props: {
  name: string;
  values: readonly number[];
  value: number;
  format: (v: number) => string;
  onCommit: (v: number) => void;
}): JSX.Element {
  const [shown, setShown] = createSignal<number>();
  const at = (e: Event): number | undefined => {
    const el = e.currentTarget;
    return el instanceof HTMLInputElement ? props.values[Number(el.value)] : undefined;
  };
  const value = (): number => shown() ?? props.value;
  return (
    <label class="slider">
      <span>{props.name}</span>
      <input
        type="range"
        min="0"
        max={props.values.length - 1}
        step="1"
        value={props.values.indexOf(props.value)}
        aria-valuetext={props.format(value())}
        onInput={(e) => {
          setShown(at(e));
        }}
        onChange={(e) => {
          const v = at(e);
          setShown(undefined);
          if (v !== undefined) props.onCommit(v);
        }}
      />
      <output>{props.format(value())}</output>
    </label>
  );
}

export function LiveChart(): JSX.Element {
  const [runs, setRuns] = createSignal<Partial<Record<Lang, Run>>>({});
  const [settings, setSettings] = createSignal<Settings>(DEFAULTS);
  // Bumped once per animation frame after new samples, so the chart redraws
  // at most once a frame however fast the workers post.
  const [frame, setFrame] = createSignal(0);
  const [status, setStatus] = createSignal("Not running. Each language uses a CPU core while it runs.");
  let pending = 0;

  const redraw = (): void => {
    pending ||= requestAnimationFrame(() => {
      pending = 0;
      setFrame((n) => n + 1);
    });
  };

  const send = (lang: Lang, req: WorkerRequest): void => {
    runs()[lang]?.worker.postMessage(req);
  };

  const stop = (lang: Lang): void => {
    runs()[lang]?.worker.terminate();
    const { [lang]: _, ...rest } = runs();
    setRuns(rest);
    if (Object.keys(rest).length === 0) {
      cancelAnimationFrame(pending);
      pending = 0;
      setStatus("Stopped.");
    }
    redraw();
  };

  const start = (lang: Lang): void => {
    const samples = new TimeWindow(SPAN_MS);
    const worker = new Worker(new URL("worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (e: MessageEvent<unknown>) => {
      const msg = e.data;
      if (!isWorkerMessage(msg)) return;
      switch (msg.kind) {
        case "ready":
          return;
        case "error":
          stop(lang);
          setStatus(`${NAMES[lang]} failed to start: ${msg.error}`);
          return;
        case "sample":
          samples.add(msg.sample);
          redraw();
      }
    });
    setRuns({ ...runs(), [lang]: { worker, window: samples } });
    send(lang, { kind: "start", lang, settings: settings() });
  };

  const change = (next: Partial<Settings>): void => {
    setSettings({ ...settings(), ...next });
    for (const lang of LANGS) send(lang, { kind: "settings", settings: settings() });
  };

  onCleanup(() => {
    for (const lang of LANGS) stop(lang);
  });

  // Everything below reads frame() so it recomputes on each redraw.
  const view = (): { scale: Scale; windows: Partial<Record<Lang, TimeWindow>> } | undefined => {
    frame();
    const windows: Partial<Record<Lang, TimeWindow>> = {};
    for (const lang of LANGS) {
      const w = runs()[lang]?.window;
      if (w !== undefined) windows[lang] = w;
    }
    const all = Object.values(windows);
    if (all.length === 0) return undefined;
    const t1 = Math.max(...all.map((w) => w.end));
    return { scale: { t0: t1 - SPAN_MS, t1, yMax: niceMax(Math.max(...all.map((w) => w.max()))) }, windows };
  };

  const stats = (): string => {
    const v = view();
    if (v === undefined || Object.values(v.windows).every((w) => w.samples.length === 0)) return status();
    const parts = LANGS.flatMap((lang) => {
      const w = v.windows[lang];
      return w === undefined ? [] : [`${NAMES[lang]} ${latest(w)}`];
    });
    const go = v.windows.go;
    if (go !== undefined) parts.push(`${String(go.gcCount())} Go GCs in view`);
    return parts.join(" · ");
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
                  <For each={(v().windows.go?.samples ?? []).filter((s) => s.gc !== undefined && s.t >= v().scale.t0)}>
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
                        (v().windows[lang]?.samples ?? []).map((s) => ({ t: s.t, v: s.ms })),
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
        <For each={LANGS}>
          {(lang) => (
            <button
              class={`copy run-${lang}`}
              type="button"
              aria-pressed={runs()[lang] !== undefined}
              onClick={() => {
                if (runs()[lang] === undefined) start(lang);
                else stop(lang);
              }}
            >
              {`${runs()[lang] === undefined ? "Run" : "Stop"} ${NAMES[lang]}`}
            </button>
          )}
        </For>
        <button
          class="copy force-gc"
          type="button"
          disabled={runs().go === undefined}
          onClick={() => {
            send("go", { kind: "gc" });
          }}
        >
          Force GC
        </button>
        <span class="stats">{stats()}</span>
      </div>
      <div class="controls">
        <Slider
          name="Cache size"
          values={CAPACITIES}
          value={settings().capacity}
          format={(n) => `${formatCount(n)} entries`}
          onCommit={(capacity) => {
            change({ capacity });
          }}
        />
        <Slider
          name="Batch size"
          values={BATCHES}
          value={settings().batch}
          format={(n) => `${formatCount(n)} ops`}
          onCommit={(batch) => {
            change({ batch });
          }}
        />
        <Slider
          name="Read ratio"
          values={READ_PCTS}
          value={settings().readPct}
          format={(n) => `${String(n)}% reads`}
          onCommit={(readPct) => {
            change({ readPct });
          }}
        />
      </div>
    </>
  );
}
