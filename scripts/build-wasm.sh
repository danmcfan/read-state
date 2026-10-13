#!/usr/bin/env bash
# Rebuilds the browser builds of both caches into site/public/wasm/:
#   site/public/wasm/go/    readstate.wasm + Go's wasm_exec.js
#   site/public/wasm/rust/  wasm-pack output (read_state_bg.wasm + JS glue)
# Needs Go, Rust with the wasm32-unknown-unknown target, and wasm-pack.
set -euo pipefail
cd "$(dirname "$0")/.."

# Fail before touching the output when a tool is missing, naming the install.
missing=()
command -v go >/dev/null || missing+=("go: https://go.dev/dl/")
command -v wasm-pack >/dev/null || missing+=("wasm-pack: cargo install wasm-pack")
rustup target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown ||
  missing+=("wasm32 target: rustup target add wasm32-unknown-unknown")
if ((${#missing[@]})); then
  printf 'build-wasm: missing %s\n' "${missing[@]}" >&2
  exit 1
fi

out=site/public/wasm
rm -rf "$out/go" "$out/rust"
mkdir -p "$out/go"

GOOS=js GOARCH=wasm go build -trimpath -o "$out/go/readstate.wasm" ./cmd/wasm
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$out/go/"

wasm-pack build --release --target web --no-pack --out-dir "$out/rust"
# wasm-pack ignores its own output; these files are committed.
rm -f "$out/rust/.gitignore"

ls -l "$out/go" "$out/rust"
