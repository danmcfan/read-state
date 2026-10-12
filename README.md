# Read State

A demo based on the Discord Read State service rewrite from Go to Rust, with the same LRU cache workload implemented in Go, Rust, Odin, and Python for comparison.

**Explainer site:** [read-state.dannyobrien.dev](https://read-state.dannyobrien.dev)

Based on [Why Discord is Switching from Go to Rust](https://discord.com/blog/why-discord-is-switching-from-go-to-rust).

## Workload

Each program runs a single-threaded LRU cache with a capacity of 20,000,000 entries. In an endless loop it writes 20,000 random key/value pairs, then sleeps for 100ms.

Keys are drawn from a range 1.25× the capacity (0 to 25,000,000), so once the cache has warmed up most writes update an entry that is already cached and only some evict. Like Discord's service, this creates little garbage, so Go's collections come mostly from its forced two-minute GC rather than from heap growth. Watching memory and CPU over time (for example, Go's GC spikes) is the point of the demo.

## Implementations

| Language | File          | Cache structure                                              |
| -------- | ------------- | ------------------------------------------------------------ |
| Go       | `main.go`     | `map` + `container/list` doubly linked list                  |
| Rust     | `src/main.rs` | `HashMap` + index-based doubly linked list in a `Vec`        |
| Odin     | `main.odin`   | `map` + index-based doubly linked list in a `[dynamic]Entry` |
| Python   | `main.py`     | `collections.OrderedDict`                                    |

The Rust and Odin caches reuse an evicted entry's slot for the new entry, so their backing arrays never grow past the capacity.

## Requirements

- Go 1.22 or newer
- Rust (stable toolchain with `cargo`)
- [Odin](https://odin-lang.org) (any recent release)
- Python 3

Each program uses about 1.5 to 3 GB of RAM once the cache is full, so run one at a time on smaller machines.

## Running

```sh
git clone https://github.com/danmcfan/read-state.git
cd read-state

# Go
go run main.go

# Rust
cargo run --release

# Odin
odin run main.odin -file -o:speed

# Python
python3 main.py
```

Each program runs until stopped with Ctrl+C.

## What to look for

Watch CPU and memory in a tool like `htop` or Activity Monitor. On macOS, use Activity Monitor's "Memory" column, because RSS in `htop` leaves out compressed memory.

To print every Go garbage collection, with its duration and heap size:

```sh
GODEBUG=gctrace=1 go run main.go
```

In a 10-minute run on a 10-core Mac with all four programs running at once:

- The cache takes about 45 million writes to fill. Memory climbs during this warm-up, then levels off.
- Rust levels off at about 1.5 GB and Odin at about 1.4 GB. At 10 minutes, Go was at about 1.8 GB and Python about 2.6 GB, both still rising slowly as their caches filled.
- Go printed `GC forced` about every two minutes. Each collection used 4 to 22 seconds of CPU marking a heap of 1.1 to 1.6 GB, and Go's CPU jumped from about 55% to between 147% and 195%.
- Rust had no periodic spikes. Its CPU stayed under 70% for the whole run.

## Site

The explainer lives in `site/index.html`, a single static page with no build step. `.github/workflows/pages.yml` deploys it to GitHub Pages on every push to `main` that changes `site/**`.
