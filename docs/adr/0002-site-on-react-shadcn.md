# 0002: The site's components use React and shadcn/ui, not SolidJS

Supersedes the SolidJS part of [0001](0001-site-on-vite-solid-typescript.md). Bun, Vite and strict TypeScript stay.

## Context

The site is one article with a handful of interactive pieces: four diagrams, a recorded CPU chart, the live latency chart and its experiment controls, a theme toggle and copy buttons. Each control was built by hand in Solid and styled in `site/styles.css`. Solid's fine-grained updates were never needed: the live chart already redraws at most once per animation frame, and the WASM caches do their work in Web Workers. A shared component library would stop each new control being written from scratch, and the libraries with the widest support (shadcn/ui, its CLI and registry, the tooling around it) target React.

## Decision

- **React** renders the interactive parts. `site/src/main.tsx` mounts one root per mount point in `site/index.html`; the article prose stays static HTML.
- **shadcn/ui** (the Radix base) supplies the controls: `Button`, `Slider` and `ToggleGroup`, in `site/src/components/ui/`, added with `bunx --bun shadcn@latest add <name>` (`components.json`). Their files are ours: they are edited to pass the gate (explicit return types, no casts) like any other code.
- **Tailwind CSS v4**, which shadcn needs, through `@tailwindcss/vite`. `site/styles.css` maps shadcn's semantic tokens (`--color-primary`, `--color-border`, ...) onto the site's existing palette, so both themes keep their colors. The article, chart and diagram styles stay as plain CSS there.

## Consequences

- The JavaScript bundle grows from about 13 KB to about 97 KB gzipped, mostly React DOM. That is fine for one article page.
- Tailwind's preflight resets browser defaults. `site/styles.css` puts back the ones the article relies on (paragraph margins, list bullets, heading weight).
- The browser checks drive the Radix slider and toggle group the way a keyboard user would (`Home`/`End` on the slider thumb, clicking a toggle item), not native inputs.
- Workers post samples faster than React should render. `LiveChart.tsx` keeps the runs in a ref and batches renders to one per animation frame.
- `tailwindcss` is imported only from CSS, so knip is told to ignore it.
