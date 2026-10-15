// The article's explanatory diagrams: what a read state is, how the LRU cache
// keeps them (stepped through with lru.ts), when Go's forced GC hits, and what
// the Rust rewrite changed. All are schematic, not measurements.

import { useState, type JSX } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { write, type Step } from "./lru.ts";

/** Who reads where, the service that tracks it, and the database behind it. */
export function ReadStatesDiagram(): JSX.Element {
  const events = ["connect", "send message", "read message"];
  return (
    <svg
      viewBox="0 0 680 200"
      role="img"
      aria-label="Client events (connect, send message, read message) go to the Read States service, which keeps recent read states in an in-memory LRU cache and writes changes back to the database. Each read state is one record per user per channel: last message read and mention count."
    >
      {events.map((e, i) => (
        <g key={e}>
          <rect className="box" x={10} y={30 + i * 50} width={140} height={34} rx={6} />
          <text x={80} y={52 + i * 50} textAnchor="middle">
            {e}
          </text>
          <line className="arrow" x1={150} y1={47 + i * 50} x2={226} y2={97} markerEnd="url(#rs-arrow)" />
        </g>
      ))}
      <rect className="box accent" x={230} y={20} width={240} height={160} rx={8} />
      <text x={350} y={42} textAnchor="middle" className="strong">
        Read States service
      </text>
      <rect className="box" x={244} y={56} width={212} height={110} rx={6} />
      <text x={350} y={74} textAnchor="middle">
        LRU cache, millions of entries
      </text>
      <text x={260} y={100} className="mono">
        (user 42, #general)
      </text>
      <text x={272} y={118} className="mono small">
        last read: msg 9107
      </text>
      <text x={272} y={134} className="mono small">
        mentions: 2
      </text>
      <text x={260} y={156} className="mono small">
        … one per user, per channel
      </text>
      <line className="arrow" x1={470} y1={100} x2={556} y2={100} markerEnd="url(#rs-arrow)" />
      <text x={513} y={92} textAnchor="middle" className="small">
        write back
      </text>
      <rect className="box" x={560} y={76} width={110} height={48} rx={6} />
      <text x={615} y={105} textAnchor="middle">
        database
      </text>
      <defs>
        <marker id="rs-arrow" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto">
          <path d="M0,0 L10,5 L0,10 z" className="head" />
        </marker>
      </defs>
    </svg>
  );
}

const CAPACITY = 5;
const WRITES = ["a", "b", "c", "a", "d", "e", "b", "f", "g", "a"];

interface Shown extends Step {
  key: string;
}

/** What the last write did, for the status line. */
function describe(last: Shown | undefined): string {
  if (last === undefined) return "Empty cache. Press Write to add an entry.";
  if (last.hit) return `Write ${last.key}: already cached, so it moves to the front.`;
  if (last.evicted !== undefined)
    return `Write ${last.key}: new, and the cache is full, so ${last.evicted} is evicted.`;
  return `Write ${last.key}: new, so it goes in front.`;
}

/** Steps through `WRITES` on a 5-slot cache, one button press per write. */
export function LruDiagram(): JSX.Element {
  const [steps, setSteps] = useState<Shown[]>([]);
  const last = steps.at(-1);
  const order = last?.order ?? [];
  const upcoming = WRITES[steps.length];
  const next = (): void => {
    if (upcoming !== undefined) setSteps([...steps, { ...write(order, upcoming, CAPACITY), key: upcoming }]);
  };

  return (
    <div className="lru">
      <div className="lru-row">
        <span className="lru-end">most recent</span>
        {Array.from({ length: CAPACITY }, (_, i) => (
          <span
            // Slots are positions, not entries: the key is the position.
            key={i}
            className={cn("slot", { fresh: i === 0 && last !== undefined, empty: order[i] === undefined })}
          >
            {order[i] ?? ""}
          </span>
        ))}
        <span className="lru-end">least recent</span>
        {last?.evicted !== undefined && <span className="slot evicted">{last.evicted}</span>}
      </div>
      <div className="live-bar">
        <Button variant="outline" size="sm" className="min-w-19" disabled={upcoming === undefined} onClick={next}>
          Write {upcoming ?? ""}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-w-19"
          disabled={steps.length === 0}
          onClick={() => {
            setSteps([]);
          }}
        >
          Reset
        </Button>
        <span className="lru-status" aria-live="polite">
          {describe(last)}
        </span>
      </div>
    </div>
  );
}

const GC_MINUTES = [2, 4, 6];

/** X position of minute `min` on the GC timeline. */
function x(min: number): number {
  return 50 + min * 76;
}

/** Schematic latency over 8 minutes: Go spikes at each forced GC, Rust stays flat. */
export function GcTimelineDiagram(): JSX.Element {
  const pts = [`${String(x(0))},150`];
  for (const m of GC_MINUTES) pts.push(`${String(x(m) - 4)},150`, `${String(x(m))},40`, `${String(x(m) + 10)},150`);
  pts.push(`${String(x(8))},150`);
  const go = pts.join(" ");
  return (
    <svg
      viewBox="0 0 680 200"
      role="img"
      aria-label="Schematic latency over eight minutes. Go's latency is low until each forced garbage collection, every two minutes, when it spikes while the collector scans the whole cache. Rust's latency stays flat."
    >
      <line className="axis" x1={50} y1={170} x2={x(8)} y2={170} />
      {[0, 2, 4, 6, 8].map((m) => (
        <text key={m} x={x(m)} y={188} textAnchor="middle">
          {`${String(m)} min`}
        </text>
      ))}
      <text x={40} y={100} textAnchor="end" transform="rotate(-90 40 100)">
        latency
      </text>
      {GC_MINUTES.map((m) => (
        <g key={m}>
          <line className="gc-mark" x1={x(m)} x2={x(m)} y1={24} y2={170} />
          <text x={x(m)} y={18} textAnchor="middle">
            forced GC
          </text>
        </g>
      ))}
      <polyline className="series" stroke="var(--go-fill)" points={go} />
      <polyline className="series" stroke="var(--rust-fill)" points={`${String(x(0))},154 ${String(x(8))},154`} />
    </svg>
  );
}

/** Top-left corner of entry `i` in an 8-wide grid starting at `left`. */
function cell(i: number, left: number): { x: number; y: number } {
  return { x: left + (i % 8) * 34, y: 60 + Math.floor(i / 8) * 34 };
}

/** The same cache in each language: Go's GC walks every entry; Rust frees on eviction. */
export function RewriteDiagram(): JSX.Element {
  const cells = Array.from({ length: 24 }, (_, i) => i);
  return (
    <svg
      viewBox="0 0 680 200"
      role="img"
      aria-label="Left, Go: every two minutes the garbage collector visits every live entry in the cache to find what is still reachable, even though almost nothing is garbage. Right, Rust: the cache owns its entries, and an evicted entry is freed on the spot, so nothing ever walks the whole cache."
    >
      <text x={20} y={30} className="strong go-text">
        Go: GC marks every live entry
      </text>
      {cells.map((i) => (
        <rect key={i} className="box scanned" x={cell(i, 20).x} y={cell(i, 20).y} width={28} height={28} rx={4} />
      ))}
      <text x={20} y={184} className="small">
        cost grows with the cache, not with the garbage
      </text>
      <text x={370} y={30} className="strong rust-text">
        Rust: evicted entry freed at once
      </text>
      {cells.map((i) => (
        <rect
          key={i}
          className={cn("box", i === 23 ? "freed" : "owned")}
          x={cell(i, 370).x}
          y={cell(i, 370).y}
          width={28}
          height={28}
          rx={4}
        />
      ))}
      <text x={370} y={184} className="small">
        no pass over the heap, so no periodic spike
      </text>
    </svg>
  );
}
