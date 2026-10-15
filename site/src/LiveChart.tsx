// Streams per-batch latency from the Go and Rust WASM builds, each in its own
// worker, with Go's collections as dashed lines (issue #17). The controls run
// either language, force a Go collection and change the experiment mid-run
// (issue #19), including Go's pointer-free layout (issue #20).

import { useEffect, useRef, useState, type JSX } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BOX, niceMax, polyline, xAt, yAt, type Scale } from "./chart.ts";
import {
  TimeWindow,
  formatCount,
  isWorkerMessage,
  type GoLayout,
  type Lang,
  type Settings,
  type WorkerRequest,
} from "./live.ts";

const SPAN_MS = 30_000;
const LANGS: readonly Lang[] = ["go", "rust"];
const NAMES: Record<Lang, string> = { go: "Go", rust: "Rust" };

const CAPACITIES = [100_000, 250_000, 500_000, 1_000_000, 2_000_000];
const BATCHES = [1000, 5000, 10_000, 20_000, 50_000, 100_000];
const READ_PCTS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const DEFAULTS: Settings = { capacity: 2_000_000, batch: 20_000, readPct: 50, goLayout: "list" };
const LAYOUTS: readonly { value: GoLayout; label: string }[] = [
  { value: "list", label: "Pointers" },
  { value: "slab", label: "Pointer-free" },
];

function fmt(ms: number): string {
  return ms > 0 && ms < 10 ? ms.toFixed(1) : String(Math.round(ms));
}

/** Where a run is: loading the build, filling its cache (at start or after a resize), or running batches. */
type Phase = "loading" | "filling" | "running";

interface Run {
  readonly worker: Worker;
  readonly window: TimeWindow;
  phase: Phase;
}

function latest(run: Run): string {
  const s = run.window.samples.at(-1);
  if (run.phase !== "running" || s === undefined) return run.phase === "filling" ? "filling cache" : "loading";
  return `${fmt(s.ms)} ms`;
}

/** A slider over a fixed list of values: the label follows the drag, `onCommit` fires on release. */
function Choice(props: {
  name: string;
  values: readonly number[];
  value: number;
  format: (v: number) => string;
  onCommit: (v: number) => void;
}): JSX.Element {
  const [shown, setShown] = useState<number>();
  const text = props.format(shown ?? props.value);
  return (
    <div className="slider grid grid-cols-[1fr_auto] gap-x-2 gap-y-1.5">
      <span>{props.name}</span>
      <output className="font-mono text-foreground">{text}</output>
      <Slider
        className="col-span-2"
        min={0}
        max={props.values.length - 1}
        step={1}
        value={[shown === undefined ? props.values.indexOf(props.value) : props.values.indexOf(shown)]}
        aria-label={props.name}
        aria-valuetext={text}
        onValueChange={([i]) => {
          setShown(i === undefined ? undefined : props.values[i]);
        }}
        onValueCommit={([i]) => {
          const v = i === undefined ? undefined : props.values[i];
          setShown(undefined);
          if (v !== undefined) props.onCommit(v);
        }}
      />
    </div>
  );
}

function isLayout(v: string): v is GoLayout {
  return LAYOUTS.some((l) => l.value === v);
}

export function LiveChart(): JSX.Element {
  // The runs live in a ref, not state: the workers' handlers outlive any one
  // render and must see the current runs. `rerender` shows a change now;
  // `redraw` batches the stream of samples into one render per frame.
  const runs = useRef<Partial<Record<Lang, Run>>>({});
  const [, setFrame] = useState(0);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  // The latest settings, for changes that land before React renders the last one.
  const latestSettings = useRef(DEFAULTS);
  const [status, setStatus] = useState("Not running. Each language uses a CPU core while it runs.");
  // The last run to fail; shown ahead of any run still going.
  const [failure, setFailure] = useState<string>();
  const pending = useRef(0);

  const rerender = (): void => {
    setFrame((n) => n + 1);
  };

  const redraw = (): void => {
    pending.current ||= requestAnimationFrame(() => {
      pending.current = 0;
      rerender();
    });
  };

  const send = (lang: Lang, req: WorkerRequest): void => {
    runs.current[lang]?.worker.postMessage(req);
  };

  const stop = (lang: Lang): void => {
    runs.current[lang]?.worker.terminate();
    const { [lang]: _, ...rest } = runs.current;
    runs.current = rest;
    if (Object.keys(rest).length === 0) {
      cancelAnimationFrame(pending.current);
      pending.current = 0;
      setStatus("Stopped.");
    }
    rerender();
  };

  const setPhase = (lang: Lang, phase: Phase): void => {
    const run = runs.current[lang];
    if (run === undefined) return;
    run.phase = phase;
    rerender();
  };

  const start = (lang: Lang): void => {
    const samples = new TimeWindow(SPAN_MS);
    const worker = new Worker(new URL("worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (e: MessageEvent<unknown>) => {
      const msg = e.data;
      if (!isWorkerMessage(msg)) return;
      switch (msg.kind) {
        case "filling":
          setPhase(lang, "filling");
          return;
        case "ready":
          setPhase(lang, "running");
          return;
        case "error": {
          const verb = runs.current[lang]?.phase === "loading" ? "failed to start" : "stopped";
          stop(lang);
          setFailure(`${NAMES[lang]} ${verb}: ${msg.error}`);
          return;
        }
        case "sample":
          samples.add(msg.sample);
          redraw();
      }
    });
    setFailure(undefined);
    runs.current = { ...runs.current, [lang]: { worker, window: samples, phase: "loading" } };
    send(lang, { kind: "start", lang, settings: latestSettings.current });
    rerender();
  };

  const change = (next: Partial<Settings>): void => {
    const s = { ...latestSettings.current, ...next };
    latestSettings.current = s;
    setSettings(s);
    for (const lang of LANGS) send(lang, { kind: "settings", settings: s });
  };

  useEffect(
    () => (): void => {
      for (const run of Object.values(runs.current)) run.worker.terminate();
      cancelAnimationFrame(pending.current);
    },
    [],
  );

  const windows: Partial<Record<Lang, TimeWindow>> = {};
  for (const lang of LANGS) {
    const w = runs.current[lang]?.window;
    if (w !== undefined) windows[lang] = w;
  }
  const all = Object.values(windows);
  const t1 = Math.max(...all.map((w) => w.end));
  const scale: Scale | undefined =
    all.length === 0 ? undefined : { t0: t1 - SPAN_MS, t1, yMax: niceMax(Math.max(...all.map((w) => w.max()))) };

  const parts = LANGS.flatMap((lang) => {
    const run = runs.current[lang];
    return run === undefined ? [] : [`${NAMES[lang]} ${latest(run)}`];
  });
  const go = runs.current.go;
  if (go !== undefined) parts.push(`${String(go.window.gcCount())} Go GCs in view`);
  if (failure !== undefined) parts.unshift(failure);
  const stats = parts.length === 0 ? status : parts.join(" · ");

  return (
    <>
      <div className="plot">
        <svg viewBox="0 0 680 250" role="img" aria-label="Live per-batch latency for Go and Rust">
          {scale !== undefined && (
            <>
              {[0, 0.5, 1].map((f) => {
                const y = yAt(f * scale.yMax, scale, BOX);
                return (
                  <g key={f}>
                    <line x1={BOX.left} x2={BOX.left + BOX.width} y1={y} y2={y} stroke="var(--border)" />
                    <text x={BOX.left - 8} y={y + 4} textAnchor="end">
                      {`${fmt(f * scale.yMax)} ms`}
                    </text>
                  </g>
                );
              })}
              <g className="gc">
                {(windows.go?.samples ?? [])
                  .filter((s) => s.gc !== undefined && s.t >= scale.t0)
                  .map((s) => (
                    <line
                      key={s.t}
                      x1={xAt(s.t, scale, BOX)}
                      x2={xAt(s.t, scale, BOX)}
                      y1={BOX.top - 4}
                      y2={BOX.top + BOX.height}
                    />
                  ))}
              </g>
              {LANGS.map((lang) => (
                <polyline
                  key={lang}
                  className={`${lang}-line`}
                  fill="none"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  stroke={`var(--${lang}-fill)`}
                  points={polyline(
                    (windows[lang]?.samples ?? []).map((s) => ({ t: s.t, v: s.ms })),
                    scale,
                    BOX,
                  )}
                />
              ))}
            </>
          )}
        </svg>
      </div>
      <div className="live-bar">
        {LANGS.map((lang) => (
          <Button
            key={lang}
            variant="outline"
            size="sm"
            className={`run-${lang} min-w-19 aria-pressed:border-muted-foreground`}
            aria-pressed={runs.current[lang] !== undefined}
            onClick={() => {
              if (runs.current[lang] === undefined) start(lang);
              else stop(lang);
            }}
          >
            {`${runs.current[lang] === undefined ? "Run" : "Stop"} ${NAMES[lang]}`}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="force-gc min-w-19"
          disabled={go?.phase !== "running"}
          onClick={() => {
            send("go", { kind: "gc" });
          }}
        >
          Force GC
        </Button>
        <span className="stats">{stats}</span>
      </div>
      <div className="controls">
        <Choice
          name="Cache size"
          values={CAPACITIES}
          value={settings.capacity}
          format={(n) => `${formatCount(n)} entries`}
          onCommit={(capacity) => {
            change({ capacity });
          }}
        />
        <Choice
          name="Batch size"
          values={BATCHES}
          value={settings.batch}
          format={(n) => `${formatCount(n)} ops`}
          onCommit={(batch) => {
            change({ batch });
          }}
        />
        <Choice
          name="Read ratio"
          values={READ_PCTS}
          value={settings.readPct}
          format={(n) => `${String(n)}% reads`}
          onCommit={(readPct) => {
            change({ readPct });
          }}
        />
        <div className="flex flex-col gap-1.5">
          <span id="go-layout">Go layout</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-labelledby="go-layout"
            value={settings.goLayout}
            onValueChange={(v) => {
              // Radix sends "" when the pressed item is clicked again: keep the layout.
              if (isLayout(v)) change({ goLayout: v });
            }}
          >
            {LAYOUTS.map((l) => (
              <ToggleGroupItem key={l.value} value={l.value} data-value={l.value}>
                {l.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
    </>
  );
}
