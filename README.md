# Read State

An interactive explainer of Discord's [Why Discord is Switching from Go to Rust](https://discord.com/blog/why-discord-is-switching-from-go-to-rust), about the rewrite of their Read State service.

**Explainer site:** [read-state.dannyobrien.dev](https://read-state.dannyobrien.dev)

## Cache implementations

The heart of the Read State service is an LRU cache. This repo holds that cache in Go and in Rust.

| Language | Files           | Cache structure                                                                  |
| -------- | --------------- | -------------------------------------------------------------------------------- |
| Go       | `cache_list.go` | `map` + `container/list` doubly linked list                                      |
| Rust     | `src/lib.rs`    | `HashMap` or `BTreeMap` + index-based doubly linked list in a preallocated `Vec` |

Every Go entry is a separate heap object full of pointers, which the garbage collector has to trace on every cycle. The Rust cache keeps its entries in one `Vec` and links them by index, reusing an evicted entry's slot for the new entry so the `Vec` never grows past the capacity. Its links are either `Option<usize>` (48-byte entries) or compact `u32`s (24-byte entries). Both caches preallocate their map for the full capacity, except Rust's `BTreeMap`, which can't be preallocated.

Run the tests with `go test ./...` and `cargo test`.

## WASM builds

Both caches also run in the browser, driven by the same workload (`workload.go`, `src/workload.rs`): a cache pre-filled to capacity, then random keys over a range of `capacity * 5 / 4`, each a Get (a read) or a Put (a write). Half are reads by default; `setReadRatio(pct)` changes the share, and a read never adds a key, so at 100% the cache stops changing.

| Build | Source        | Output                  | Loaded as                                                        |
| ----- | ------------- | ----------------------- | ---------------------------------------------------------------- |
| Go    | `cmd/wasm`    | `site/public/wasm/go`   | `wasm_exec.js` + `readstate.wasm`, then the `readStateGo` global |
| Rust  | `src/wasm.rs` | `site/public/wasm/rust` | ES module `read_state.js` (wasm-pack, `--target web`)            |

Both expose `init(capacity)`, which builds a fresh, pre-filled cache, `setReadRatio(pct)`, which is kept across `init`, and `runBatch(n)`, which runs `n` operations and returns the elapsed milliseconds (NaN before `init`). The Go build also exposes `forceGC()` and `heapStats()`, which returns `{ heapAlloc, numGC, lastPauseMs }`.

The built files are committed. After changing either cache or workload, rebuild them all with:

```sh
scripts/build-wasm.sh
```

This needs Go, the `wasm32-unknown-unknown` Rust target (`rustup target add wasm32-unknown-unknown`) and [`wasm-pack`](https://github.com/wasm-bindgen/wasm-pack) (`cargo install wasm-pack`). Then check the builds with `bun test`.

## Site

The explainer is `site/index.html` (the article) plus SolidJS components in `site/src/` for the charts and buttons, built with Vite and run by Bun (`docs/adr/0001-site-on-vite-solid-typescript.md`). It follows the system light or dark theme, and the toggle in the corner overrides it.

```sh
bun install        # also installs the git hooks
bun run dev        # Vite dev server at http://localhost:3000
bun run check      # the quality gate: types, lint, format, unused code, tests, build, Go and Rust
bun run verify     # browser checks with agent-browser; screenshots in out/verify/
```

`.github/workflows/pages.yml` builds the site and deploys `dist/` to GitHub Pages on every push to `main` that changes it.
