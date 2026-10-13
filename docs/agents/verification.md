# Browser verification

Every change to `site/` gets a **verify check**: a script in `scripts/verify/<name>.ts` that drives the built page in a real browser with agent-browser, asserts on the DOM, and writes the screenshots the PR needs. Unit tests prove the logic; the verify check proves what a reader sees.

## Run

```sh
bun run verify          # every check in scripts/verify/
bun run verify live     # one check
```

- Each check runs `bun run build`, serves `dist/` on a free port, and uses an agent-browser session of its own.
- Screenshots go to `out/verify/<name>/` (gitignored). Each check prints every path it writes.
- A failing check prints `verify <name>: FAILED` with the reason and exits non-zero.

## Write one

Copy the shape of `scripts/verify/live.ts`. Everything comes from `verify()` in `scripts/harness.ts`:

| Need                      | Use                                                     |
| ------------------------- | ------------------------------------------------------- |
| Load the page             | `await v.open()`, or `await v.open("/", "dark")`        |
| Act                       | `await v.click(selector)`, raw `await v.run(...args)`   |
| Wait for state            | `await v.until("what", "<js expression>", ms)`          |
| Read state                | `await v.eval("<js>")`, then `v.check(ok, "what", got)` |
| Evidence                  | `await v.screenshot("name", selector)`                  |
| No console or page errors | `await v.assertNoErrors()` last                         |

Done when every acceptance criterion on the issue has a `check`/`until` or a screenshot.

## Look at the results

Read every screenshot yourself before reporting it: an assertion can pass while the picture is wrong. Attach the key ones to the PR with `gh pr create --attach <path>` (or `gh pr edit --attach`), referencing each as `![what](<path>)` with the same path.

## Gotchas (handled by the harness)

- **Blocking spawns deadlock.** The harness serves `dist/` from its own process, so it calls agent-browser with async `Bun.spawn`. A `spawnSync` there stops the server answering the browser.
- **Smooth scrolling moves targets.** `open()` emulates `reduced-motion`, which turns off the page's `scroll-behavior: smooth`; otherwise clicks and screenshots land mid-scroll.
- **Element screenshots clip the wrong region** once the page has scrolled. `screenshot(name, selector)` centres the element and captures the viewport.
- **`agent-browser screenshot` takes `[selector] [path]` as positionals.** A `--selector` flag is taken as the output path.
- Wait with `until()`, not sleeps: WASM load and cache fill take a few seconds and vary by machine.
