# Results

Each `<variant>.jsonl` file here is one isolated run made by `scripts/run.sh`, and `summary.json` (copied to `site/data/summary.json` for the site) is built from them by `cmd/summarize`. `logs/<variant>.stderr.log` holds each run's stderr; for Go that's the `GODEBUG=gctrace=1` trace of every collection.

## The quick profile

Every committed run uses the **quick profile**, so that each variant takes about 3 minutes instead of the 15 or more that the faithful workload would need:

| Setting            | Quick profile (measured)           | Faithful default (no flags) |
| ------------------ | ---------------------------------- | --------------------------- |
| Cache capacity     | 2,000,000 entries                  | 20,000,000 entries          |
| Key space          | `[0, 2,500,000)`                   | `[0, 25,000,000)`           |
| Operations         | 50% `Get` (a miss loads the key with a `Put`), 50% `Put` | all `Put`     |
| Batch, sleep       | 20,000 operations, 100 ms          | same                        |
| Go forced-GC period | 20 s (`--gcperiod=20s`)           | 2 minutes, as at Discord    |
| Run length         | 180 s, one variant at a time, 10 s cooldown between runs | forever |

The cache fills in about 22 seconds, which leaves about 7 periodic collections in each Go run, about as many as the 15-minute run the measurement plan first proposed. The smaller cache means smaller heaps and shorter collections than Discord's or the faithful default's, so compare variants with each other rather than with Discord's absolute numbers.

## Findings

### Go baseline vs Rust baseline (#2)

On the same workload both do about 180,000 operations a second at an 80% hit rate. Rust averaged 5.5% of one core (max 10.2%) with no periodic spikes; Go averaged 12.0% but jumped to 29–44% in the second of each periodic GC, which marked about 195 MiB of live heap with 0.22–0.43 s of CPU every 20 s. (Go's numbers are from the #3 rerun of `go-baseline`; Rust's are from #2.)

Go used 256 MiB of RSS (134 bytes per entry, 56 of them the entry and its list element) against Rust's 160 MiB (84 bytes per entry, 48 of them the entry). Batch-latency tails were dominated by noise from other work on the host for both languages (see the caveats), so they don't yet separate the two.

### Discord's tuning steps in Go (#3)

Each step of [Discord's post](https://discord.com/blog/why-discord-is-switching-from-go-to-rust) has its own runs here. Per-cycle GC CPU is `/cpu/classes/gc/total` per steady-state collection, and "GC CPU per second" is the steady window's total GC CPU divided by its length. The issue's capacities (20M, 10M, 5M, 2M) are scaled down by the quick profile's factor of 10.

| Step | Variants | Steady collections (kind) | GC CPU per cycle (median, max) | GC CPU per second | Miss rate | RSS (median) |
| ---- | -------- | ------------------------- | ------------------------------ | ----------------- | --------- | ------------ |
| 0 | `go-baseline` (2M entries, GC percent 100) | 7 periodic, 1 heap | 0.258 s, 0.430 s | 0.014 s | 0.20 | 256 MiB |
| 1 | `go-gcpercent-50` | 8 periodic | 0.246 s, 0.382 s | 0.014 s | 0.20 | 256 MiB |
| 1 | `go-gcpercent-400` | 7 periodic | 0.246 s, 0.281 s | 0.011 s | 0.20 | 255 MiB |
| 1 | `go-gcpercent-1000` | 7 periodic | 0.256 s, 0.372 s | 0.012 s | 0.20 | 255 MiB |
| 2 | `go-cap-500K` (keys 2.5M) | 34 heap | 0.068 s (mean) | 0.013 s | 0.80 | 105 MiB |
| 2 | `go-cap-1M` (keys 2.5M) | 13 heap | 0.147 s (mean) | 0.011 s | 0.60 | 204 MiB |
| 2 | `go-cap-4M` (keys 5M) | 7 periodic | 0.507 s, 0.542 s | 0.027 s | 0.20 | 457 MiB |
| 2 | `go-cap-8M` (keys 10M) | 4 periodic | 1.293 s, 1.348 s | 0.057 s | 0.20 | 864 MiB |
| 3 | `go-shards-16` (16 × 125,000) | 8 periodic | 0.211 s, 0.255 s | 0.011 s | 0.20 | 255 MiB |

**Step 0, the baseline.** The steady window starts at 22.5 s, and its first collection (gc 7 at 24.4 s, 0.30 s of CPU) is the last heap-triggered one from the fill: the heap reached its 237 MiB goal at 202 MiB live. Every collection after it is periodic: 7 of them about 20.2 s apart, each spending about 0.26 s of CPU marking a 194 MiB live heap. Between them the heap grows only about 46 MiB (from 194 MiB to about 240 MiB against a 389 MiB goal), so once the fill is over the heap trigger never fires again.

**Step 1, GC percent: no effect, as in the article.** At 50, 400 and 1000 every steady collection is still periodic, 20.1 to 20.2 s apart, at 0.25 to 0.26 s of CPU each, and RSS stays at 255 to 256 MiB, because the heap never gets near even GC percent 50's goal before the timer fires. GC percent changes only the warm-up (19 collections in total at 50, 14 at 100, 10 at 400, 9 at 1000), which matches Discord's "we were not allocating memory quickly enough for it to force garbage collection to happen more often".

**Step 2, a smaller cache: smaller collections, more misses, but not less GC work overall.** Per-collection CPU tracks the live heap: 0.068 s at 500K, 0.147 s at 1M, 0.258 s at 2M, 0.507 s at 4M and 1.293 s at 8M (heap 49, 97, 194, 389 and 778 MiB), while the miss rate rises from 0.20 to 0.60 at 1M and 0.80 at 500K. Because every miss inserts a new entry and evicts an old one, the small caches allocate fast enough that the heap trigger fires every 5.3 s (500K) or 14 s (1M), before the 20 s timer, so the spikes are smaller but more frequent and GC CPU per second stays at about 0.011 to 0.014 s, the same as the baseline.

- This demo has no database, so a miss costs only a `Put` and the batch latency doesn't show the p99 cost Discord saw. The miss rate stands in for their database loads.
- With uniform random keys and a fixed key space, hit rate is simply capacity / keys. Discord's real traffic is skewed, so shrinking their cache cost fewer misses than it does here.

**Step 3, 16 partitioned caches at the same total capacity: the same live heap, somewhat cheaper collections in this run.** The live heap (194 MiB), scannable heap (about 161 MiB) and object count are the same as the baseline's, every steady collection is still periodic, and neither run has meaningful assists (under 0.001 s per collection). Per periodic collection, though, `go-shards-16` spent 0.189 to 0.255 s of GC CPU (median 0.211 s), against 0.216 to 0.268 s (median 0.258 s, plus one 0.430 s outlier) for the baseline and medians of 0.246 to 0.256 s for the three GC percent runs, all from `summary.json`. That is 14 to 18% less than every other 2M list run, and its peak CPU was 37.4% against 43 to 46%. With the same pointers live, the mark work should be the same, so the cause is unexplained; a guess is that 16 maps and lists of 125,000 entries each are laid out more compactly, which makes marking faster. It is one run each, so #7's rerun of the whole matrix will recheck it. In the article, partitioning came together with a smaller cache per partition, and its effect there is step 2's.

## Caveats

- **Periodic GCs aren't counted as forced.** `/gc/cycles/forced:gc-cycles` counts only `runtime.GC()` calls, so it stays at 0 even though Go's 2-minute (here 20 s) collection is called "forced" in `gctrace`. Each `gc` record's `kind` says what started it instead: `user` if the forced counter went up; otherwise `periodic` if GC is on and the cycle ended at least one forced-GC period after the previous cycle ended (the runtime's own trigger condition); otherwise `heap`. A group of cycles of different kinds is `mixed`. The time rule could call a slow heap-triggered cycle periodic, so check against the `GC forced` lines in the gctrace log (each one comes just before the `gc N` line it starts).
- **GC pause totals come from `debug.ReadGCStats`.** `/sched/pauses/total/gc:seconds` is a histogram with bucket counts, not a total, so `gc_pause_total_s` and `pause_s` use `ReadGCStats`' exact `PauseTotal` (which doesn't stop the world). `gc_pause_cpu_s` is `/cpu/classes/gc/pause:cpu-seconds`.
- **Per-second p99 is close to max.** Each `sec` record covers only about 9 batches. Run-level percentiles in `summary.json` come from all the steady-state `batch_us` values.
- **The `/cpu/classes/gc/...` values are the runtime's estimates.** Compare them with each other, not with `cpu_s`.
- **macOS RSS leaves out compressed memory.** At quick-profile sizes on a 16 GB machine compression shouldn't kick in.
- **The host wasn't idle.** The runs didn't overlap with each other or with builds, but other work on the machine (load average 7 to 15 on 10 cores) shared it. `cpu_pct` counts only the measured process's own CPU, but batch latency includes waiting for a core, so latency tails here are mostly host noise. The #3 runs had a quieter host (load average about 1.5 to 7), but other builds and browsers still shared it at times. The machine slept during the first `go-gcpercent-400` and `go-gcpercent-1000` runs, so those two were rerun with `caffeinate`, and no sleep overlapped the committed runs. The full matrix is rerun in one session later (#7).
- **Go 1.9.2 wasn't run.** Discord ran Go 1.9.2. The optional Docker run of the baseline under `golang:1.9.2` from #3 was skipped. Which variants could have run there (`go192` in `summary.json`) comes from Go's documentation and release notes, not from a measurement. For #3's variants that rests on `debug.SetGCPercent` (Go 1.1), `container/list` and built-in maps all being in Go 1.9; the 16 shards are plain Go.

## File formats

### `<variant>.jsonl`

One JSON object per line, in this order: one `env` record (written by `run.sh`), one `config` record, `sec` and `gc` records interleaved, one `end` record (all from the binary), then the `proc` records (appended by `run.sh` after the binary exits). Times `t` are seconds since the process started, with 3 decimals. Byte counts are integers, and batch durations are integer microseconds.

- **`env`**: `variant`, `profile`, `started_at`, `git_commit`, `git_dirty` (ignoring the results files themselves), `command` (the exact command line, with environment variables), `env_vars` (`GOGC`, `GOMEMLIMIT`, `GOEXPERIMENT`, `GOMAXPROCS`, or `null` when unset), `host` (`os`, `os_version`, `kernel`, `arch`, `cpu_model`, `ncpu`, `mem_bytes`), `go_version`, `rust_version`, `cargo_version`, and `matrix` (`order`, `label`, `issue`, `group`, `go192`) copied from the variant table in `run.sh`.
- **`config`**: the binary's settings: `lang`, `variant`, `capacity`, `capacity_effective`, `keys`, `batch`, `sleep_ms`, `read_ratio`, `duration_s`, `seed`, `entry_bytes` (the size of one entry's structs, without map overhead). Go adds `layout`, `shards`, `gcpercent`, `gcperiod_s`, `gcperiod_mechanism` (`linkname` or `runtime-default`), `gomaxprocs`, `goexperiment`, `gomemlimit_bytes` and `go_runtime`. Rust adds `map` and `compact`.
- **`sec`**: written by the main loop after a batch and its sleep, once at least a second has passed since the last one. `ops`, `hits`, `misses` (any operation whose key wasn't cached) and `evictions` count the window; `entries` is the cache size; `batch_us` lists the window's batch durations (timed around the operations only, not the sleep) and `batch_p50_us`, `batch_p99_us`, `batch_max_us` are its nearest-rank percentiles. `cpu_s` is the process's cumulative user plus system CPU (`getrusage`), and `cpu_pct` is `100 × Δcpu_s / Δt`, so 100 is one core. Go adds cumulative runtime values: `gc_cycles` and `gc_cycles_forced` (`/gc/cycles/total`, `/gc/cycles/forced`), `gc_cpu_s`, `gc_mark_dedicated_s`, `gc_mark_assist_s`, `gc_mark_idle_s`, `gc_pause_cpu_s` (`/cpu/classes/gc/...`), `gc_pause_total_s` (`ReadGCStats`), and the current `heap_live_bytes`, `heap_goal_bytes`, `heap_objects`, `scan_heap_bytes` (`/gc/scan/heap`) and `go_total_bytes` (`/memory/classes/total`).
- **`gc`** (Go only): written before a `sec` record whenever cycles have finished since the last `gc` record. `t` is when the newest cycle ended, `cycles` is how many finished, `n_end` is the total so far, and `kind` is described above. `gc_cpu_s`, `mark_dedicated_s`, `mark_assist_s`, `mark_idle_s`, `pause_cpu_s` and `pause_s` are deltas since the previous `gc` record; `heap_live_bytes` and `scan_heap_bytes` are current values.
- **`end`**: run totals of `ops`, `hits`, `misses`, `evictions` and `batches` (including the last, partial window), the final `entries`, and `cpu_s`.
- **`proc`**: `rss_bytes` from `ps` once a second; `t` is whole seconds since launch, so join it to the nearest `sec` record.

### `summary.json` (`schema_version: 1`)

- **`profile`**: the quick-profile settings, plus `faithful` (`capacity` 20,000,000 and `gcperiod_s` 120) for comparison.
- **`env`**: the machine and toolchains: `os`, `cpu_model`, `ncpu`, `mem_bytes`, `go_version`, `rust_version`, `gomaxprocs` and `git_commit`.
- **`variants`**, in the order `scripts/run.sh list` prints them. Each has `id`, `lang`, `label`, `issue`, `group`, `go192` (`run.sh summarize` passes the current matrix to `cmd/summarize --matrix`, so these follow the table in `run.sh` even for files recorded before rows were added; without `--matrix` they come from each file's `env.matrix`), and:
  - `config`: `layout`, `shards`, `gcpercent`, `gomemlimit` (`null` when unlimited), `goexperiment`, `map`, `compact`, `capacity`, `keys`, `entry_bytes`. Fields that don't apply to the language are `null`.
  - `headline`, computed over the **steady window**: from the first `sec` record where `entries >= capacity_effective` to the end of the run. It's `null` if the cache never filled (for example in a short smoke test). Fields: `steady_from_s`, `ops_per_s`, `hit_rate`, `miss_rate`, `cpu_pct_mean`, `cpu_pct_p99`, `cpu_pct_max`, `rss_bytes_median`, `rss_bytes_max`, `bytes_per_entry` (`rss_bytes_median / capacity`), `batch_p50_us`, `batch_p99_us`, `batch_max_us` (over every steady batch), and for Go `gc`: `cycles`, `periodic_cycles`, `cpu_s_per_periodic_median`, `cpu_s_per_periodic_max`, `assist_s_per_periodic_median` (over single-cycle periodic `gc` records; `null` when there are none, as in runs whose collections are all heap-triggered), `pause_max_ms`, and the medians of `scan_heap_bytes` and `heap_live_bytes`. `gc` is `null` for Rust.
  - `series`: one point per `sec` record for the whole run, warm-up included: `t` (whole seconds), `cpu_pct`, `rss_mb` (from the nearest `proc` record, `null` if none is within 1.5 s), `batch_p99_us`, `batch_max_us`, and `heap_live_mb` (`null` for Rust). MB here are MiB.
  - `gc_events`: every `gc` record: `t`, `kind`, `cycles`, `cpu_s`, `assist_s`, `pause_ms`.

Percentages and MB have one decimal; microseconds and bytes are integers.
