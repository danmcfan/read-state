# 0001: The site is built with Bun, SolidJS and strict TypeScript

## Context

The site started as one static `site/index.html` with inline scripts and a pre-rendered chart. The live latency chart (#17) added Web Workers and the WASM builds, and the explainer (#11) still has to add an article walkthrough (#18) and experiment controls (#19). Untyped inline scripts gave no check before a browser run.

## Decision

- **Bun** runs everything: installs, scripts, `bun test`, the dev server and the bundler. No Vite.
- **SolidJS** renders the interactive parts as components in `site/src/`. The article prose stays static HTML in `site/index.html`, with mount points.
- **TypeScript** in strict mode, linted by type-aware oxlint, formatted by Prettier, with knip for unused code. `bun run check` is the gate (`docs/agents/quality-gate.md`).

Two Bun gaps shape the build:

- Bun's JSX transform targets React. `scripts/solid-plugin.ts` compiles `.tsx` with `babel-preset-solid` instead. `scripts/build.ts` passes it to `Bun.build`, and `bunfig.toml` registers it for the dev server.
- Bun's bundler does not follow `new Worker(new URL(...))`. The worker is a separate entry point, served and built as `./worker.js` beside the page (`scripts/site.ts`).

## Consequences

- GitHub Pages deploys `dist/` from `bun run build`, not `site/` as committed.
- The WASM builds stay committed in `site/wasm/` and are copied into `dist/` as they are. They load at runtime through `site/src/wasm.ts`.
- Browser checks (`bun run verify`) run against the built `dist/`, the files that ship.
