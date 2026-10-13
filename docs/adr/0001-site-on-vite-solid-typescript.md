# 0001: The site is built with Vite, SolidJS and strict TypeScript, run by Bun

## Context

The site started as one static `site/index.html` with inline scripts and a pre-rendered chart. The live latency chart (#17) added Web Workers and the WASM builds, and the explainer (#11) still has to add an article walkthrough (#18) and experiment controls (#19). Untyped inline scripts gave no check before a browser run.

## Decision

- **Bun** runs everything: installs, scripts, `bun test`, and Vite itself (`bunx --bun vite`).
- **Vite** with `vite-plugin-solid` is the dev server and bundler. Its root is `site/`; `site/public/` is served and copied as it is.
- **SolidJS** renders the interactive parts as components in `site/src/`. The article prose stays static HTML in `site/index.html`, with mount points.
- **TypeScript** in strict mode, linted by type-aware oxlint, formatted by Prettier, with knip for unused code. `bun run check` is the gate (`docs/agents/quality-gate.md`).

We first tried Bun's own bundler, without Vite. It needed a hand-written Babel plugin for Solid JSX (Bun's JSX targets React, and `bun-plugin-solid` is unmaintained) and a separate build and dev route for the Web Worker (Bun does not bundle `new Worker(new URL(...))`). Vite handles both with its official Solid plugin and native worker bundling, so those scripts are gone.

## Consequences

- GitHub Pages deploys `dist/` from `bun run build`, not `site/` as committed.
- The WASM builds stay committed in `site/public/wasm/` and are served at `/wasm/` as they are, not bundled. `site/src/wasm.ts` imports them at runtime (`/* @vite-ignore */`), which assumes the site is served from the domain root.
- The tsconfig uses Bun's types only: `vite/client` conflicts with them over `import.meta`, so the site code does not use `import.meta.env`.
- Browser checks (`bun run verify`) run against the built `dist/`, the files that ship.
