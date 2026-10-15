// `bun run verify controls`: the status line shows loading and refilling,
// Force GC waits for Go to run and then marks a collection, and the cache
// size, batch size and read ratio sliders change the run while it streams
// (issue #19).

import { verify, type Verify } from "../harness.ts";

const gcLines = "document.querySelectorAll('#live-chart .gc line').length";
const goPoints =
  "(document.querySelector('#live-chart .go-line')?.getAttribute('points') ?? '').split(' ').filter(Boolean).length";

/** Move a slider to its first or last step with the keyboard, as a reader would. */
const slide = (name: string, key: "Home" | "End"): string => `(() => {
  const control = [...document.querySelectorAll('#live-chart .slider')].find((c) => c.textContent?.startsWith('${name}'));
  const thumb = control?.querySelector('[role=slider]');
  if (!thumb) return false;
  thumb.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true }));
  return true;
})()`;

/** The label a slider shows. */
const label = (name: string): string =>
  `[...document.querySelectorAll('#live-chart .slider')].find((c) => c.textContent?.startsWith('${name}'))?.querySelector('output')?.textContent`;

/** Moves slider `name` to `key` and waits for its label to read `want`. */
async function setSlider(v: Verify, name: string, key: "Home" | "End", want: string): Promise<void> {
  v.check((await v.eval(slide(name, key))) === true, `the ${name.toLowerCase()} slider takes the keyboard`);
  await v.until(`the ${name.toLowerCase()} slider reads ${want}`, `${label(name)} === '${want}'`, 5000);
}

const stats = "document.querySelector('#live-chart .stats')?.textContent";
const forceGcDisabled = "document.querySelector('#live-chart .force-gc')?.disabled";

await verify("controls", async (v) => {
  await v.open();
  v.check((await v.eval(forceGcDisabled)) === true, "Force GC is disabled until Go runs");

  // A small cache so Go fills quickly and collects rarely on its own.
  await setSlider(v, "Cache size", "Home", "100k entries");
  await v.click("#live-chart .run-go");
  v.check(
    /^Go (loading|filling cache)/u.test(String(await v.eval(stats))),
    "the status line shows Go loading",
    await v.eval(stats),
  );
  await v.until("Go streams samples", `${goPoints} > 20`, 60_000);
  v.check((await v.eval(forceGcDisabled)) === false, "Force GC is enabled once Go runs");

  const before = Number(await v.eval(gcLines));
  await v.click("#live-chart .force-gc");
  await v.until("Force GC marks a collection", `${gcLines} > ${String(before)}`, 10_000);

  await setSlider(v, "Batch size", "End", "100k ops");
  await setSlider(v, "Read ratio", "End", "100% reads");
  await setSlider(v, "Cache size", "End", "2M entries");
  await v.until("a resize shows the cache refilling", `${stats}?.startsWith('Go filling cache')`, 10_000);
  await v.until("Go keeps streaming after the changes", `${goPoints} > 40`, 60_000);
  await v.screenshot("controls", "#live-chart");

  await v.click("#live-chart .run-go");
  await v.until("Stop Go ends the run", `${stats} === 'Stopped.'`);
  await v.assertNoErrors();
});
