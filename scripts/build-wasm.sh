#!/usr/bin/env bash
# Rebuilds the browser builds of both caches into site/wasm/:
#   site/wasm/go/    readstate.wasm + Go's wasm_exec.js
#   site/wasm/rust/  wasm-pack output (read_state_bg.wasm + JS glue)
# Needs Go, Rust with the wasm32-unknown-unknown target, and wasm-pack.
set -euo pipefail
cd "$(dirname "$0")/.."

out=site/wasm
rm -rf "$out/go" "$out/rust"
mkdir -p "$out/go"

GOOS=js GOARCH=wasm go build -trimpath -o "$out/go/readstate.wasm" ./cmd/wasm
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$out/go/"

wasm-pack build --release --target web --no-pack --out-dir "$out/rust"
# wasm-pack ignores its own output; these files are committed.
rm -f "$out/rust/.gitignore"

ls -l "$out/go" "$out/rust"
