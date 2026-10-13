# Coding standards

Judgement calls for review. Anything a tool can enforce lives in the quality gate (`docs/agents/quality-gate.md`), not here.

## Go and Rust stay in lockstep

The Go and Rust caches are two implementations of one benchmark. A change to one side's behaviour (the workload's key range, operation mix or xorshift64 stream, eviction order, what `Put` reports) lands on the other side in the same PR, with the matching test. A one-sided change makes the latency chart compare two different workloads.

## Committed WASM matches its source

`site/public/wasm/` is built output, committed. A PR that changes `src/`, `cmd/wasm` or the Go package the WASM build compiles reruns `bun run build:wasm` and commits the result, so the live chart runs the code under review.

## Hot paths pay for checks once

A latency number is only as good as the code it measures. Validate an invariant once at the boundary (`LruCache::new` asserts the capacity fits the link type) and keep per-operation code free of extra work. A checked conversion inside `get`/`put`/`insert` is a cost on every operation: call it out in the PR, with the reason it can't move to the boundary.

## Doc comments state the contract

The linters require doc comments on exported items. The comment is useful only when it says what the caller can't see from the signature: what a returned `bool` means, when the function panics, which end of the list it touches. A comment that restates the name is a finding.

## A disabled rule carries its reason

Turning a lint rule off is a change to `.oxlintrc.json`, `.golangci.yml` or `Cargo.toml`. It needs a reason next to the rule and in `docs/agents/quality-gate.md`, and it applies only when the rule is wrong for the whole repo. A finding that is merely awkward to fix is fixed in the code.
