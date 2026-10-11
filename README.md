# Read State

A demo based on the Discord Read State service rewrite from Go to Rust, with the same LRU cache workload implemented in Go, Rust, Odin, and Python for comparison.

[Why Discord is Switching from Go to Rust](https://discord.com/blog/why-discord-is-switching-from-go-to-rust)

## Workload

Each program runs a single-threaded LRU cache with a capacity of 20,000,000 entries. In an endless loop it writes 20,000 random `i64` key/value pairs, then sleeps for 100ms. Watching memory and CPU over time (for example, Go's GC spikes) is the point of the demo.

## Implementations

| Language | File          | Cache structure                                   |
| -------- | ------------- | ------------------------------------------------- |
| Go       | `main.go`     | `map` + `container/list` doubly linked list       |
| Rust     | `src/main.rs` | Hash map + index-based doubly linked list         |
| Odin     | `main.odin`   | `map` + index-based doubly linked list in a `[dynamic]Entry` |
| Python   | `main.py`     | `collections.OrderedDict`                         |

## Running

```sh
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
