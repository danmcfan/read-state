# Read State

A demo based on the Discord Read State service rewrite from Go to Rust, with the same LRU cache workload implemented in Go and Rust for comparison.

**Explainer site:** [read-state.dannyobrien.dev](https://read-state.dannyobrien.dev)

Based on [Why Discord is Switching from Go to Rust](https://discord.com/blog/why-discord-is-switching-from-go-to-rust).

## Workload

Each program runs a single-threaded LRU cache with a capacity of 20,000,000 entries. In an endless loop it writes 20,000 random key/value pairs, then sleeps for 100ms.

Keys are drawn from a range 1.25× the capacity (0 to 25,000,000), so once the cache has warmed up most writes update an entry that is already cached and only some evict. Like Discord's service, this creates little garbage, so Go's collections come mostly from its forced two-minute GC rather than from heap growth. Watching memory and CPU over time (for example, Go's GC spikes) is the point of the demo.

Running either program with no flags is this faithful workload: 20M entries, write-only, Go's normal 2-minute forced GC, no metrics output, running forever. Flags (below) change the workload for measurement runs, including an optional read path: with `--read-ratio=0.5`, half the operations are `Get`s, and a `Get` that misses loads the key with a `Put`, the way a read-heavy service fills its cache from a database.

## Implementations

| Language | Files                                          | Cache structure                                       |
| -------- | ---------------------------------------------- | ----------------------------------------------------- |
| Go       | `main.go`, `cache_list.go`, `metrics.go`       | `map` + `container/list` doubly linked list           |
| Rust     | `src/main.rs`                                  | `HashMap` + index-based doubly linked list in a `Vec` |

The Rust cache reuses an evicted entry's slot for the new entry, so its backing array never grows past the capacity. Both caches preallocate their map for the full capacity.

## Requirements

- Go 1.22 or newer to run the Go program. `scripts/run.sh` needs Go 1.23 or newer (see [Forced-GC period](#forced-gc-period)); the committed results were made with go1.26.4.
- Rust (stable toolchain with `cargo`)

Once the cache is full, Rust uses about 1.5 GB of RAM and Go uses 2 GB or more, so run one at a time on smaller machines.

## Running

```sh
git clone https://github.com/danmcfan/read-state.git
cd read-state

# Go
go run .

# Rust
cargo run --release
```

Each program runs until stopped with Ctrl+C.

### Flags

Both programs take `--name=value`; Go also takes `-name=value` and Rust also takes `--name value`. Durations are a number with `ms`, `s`, `m` or `h`, or `0`.

| Flag           | Language | Default    | Meaning                                                                               |
| -------------- | -------- | ---------- | ------------------------------------------------------------------------------------- |
| `--capacity`   | both     | `20000000` | Total cache entries                                                                   |
| `--keys`       | both     | `0`        | Keys are drawn from `[0, keys)`; `0` means `capacity*5/4`                             |
| `--batch`      | both     | `20000`    | Operations per timed batch                                                            |
| `--sleep`      | both     | `100ms`    | Sleep after each batch                                                                |
| `--read-ratio` | both     | `0`        | Probability that an operation is a `Get`; a miss then `Put`s the key                  |
| `--duration`   | both     | `0`        | Stop after this long; `0` runs forever                                                |
| `--out`        | both     | (none)     | Append one JSON line per second of metrics to this file (`-` for stdout)              |
| `--variant`    | both     | (none)     | Name recorded in the metrics                                                          |
| `--seed`       | both     | `1`        | Random seed                                                                           |
| `--layout`     | Go       | `list`     | Cache layout (only `list` so far)                                                     |
| `--gcpercent`  | Go       | `100`      | Set with `debug.SetGCPercent` at startup, so it overrides `GOGC`; `-1` turns GC off   |
| `--gcperiod`   | Go       | `2m`       | Forced-GC period; any other value needs the `gcperiod` build (below)                  |

### Forced-GC period

Go's runtime starts a garbage collection whenever two minutes pass without one; this is the periodic GC behind Discord's spikes. To see several of them in a short run, `--gcperiod` changes that period by linking to the runtime's internal `runtime.forcegcperiod` variable. Go 1.23 and later only allow that link with a linker flag, so it's behind a build tag:

```sh
go build -tags gcperiod -ldflags=-checklinkname=0 -o bin/read-state-go .
bin/read-state-go --gcperiod=20s
```

A plain `go build .` or `go run .` leaves this out and accepts only `--gcperiod=2m`. Changing the variable keeps the runtime's own periodic path (the same trigger, the same worker setup), which a goroutine calling `runtime.GC()` wouldn't.

## Measuring

`scripts/run.sh` builds both programs, then runs measurement variants one at a time, each for a fixed duration, and writes `results/<variant>.jsonl`: the machine, OS and toolchain versions, the program's per-second metrics (operations, hit rate, batch latency p50/p99/max, CPU, and for Go the runtime's GC counters and heap sizes), one record per Go GC, and the process's RSS once a second. It then writes `results/summary.json`, which the site reads from its copy in `site/data/`.

```sh
scripts/run.sh list                      # variant names, in order
scripts/run.sh go-baseline rust-baseline # run these, then summarize
scripts/run.sh all                       # run every variant
scripts/run.sh summarize                 # only rebuild summary.json
DURATION=15s OUT_DIR=/tmp/smoke scripts/run.sh go-baseline   # quick smoke test
```

The committed results use a **quick profile**: 2,000,000 entries (10× smaller than the faithful default), keys from `[0, 2,500,000)`, a read ratio of 0.5, Go's forced GC every 20 seconds instead of every 2 minutes, and a 3-minute run per variant. Close other heavy programs while it runs, because each variant's CPU numbers assume it has the machine to itself. See [`results/README.md`](results/README.md) for the file formats and the findings.

## What to look for

Watch CPU and memory in a tool like `htop` or Activity Monitor. On macOS, use Activity Monitor's "Memory" column, because RSS in `htop` leaves out compressed memory.

To print every Go garbage collection, with its duration and heap size:

```sh
GODEBUG=gctrace=1 go run .
```

In a 10-minute run on a 10-core Mac with four programs running at once (this repo used to include two more implementations; isolated per-variant measurements will replace these numbers):

- The cache takes about 45 million writes to fill. Memory climbs during this warm-up, then levels off.
- Rust levels off at about 1.5 GB. At 10 minutes, Go was at about 1.8 GB and still rising slowly as its cache filled.
- Go printed `GC forced` about every two minutes. Each collection used 4 to 22 seconds of CPU marking a heap of 1.1 to 1.6 GB, and Go's CPU jumped from about 55% to between 147% and 195%.
- Rust had no periodic spikes. Its CPU stayed under 70% for the whole run.

## Site

The explainer lives in `site/index.html`, a single static page with no build step. `.github/workflows/pages.yml` deploys it to GitHub Pages on every push to `main` that changes `site/**`.
