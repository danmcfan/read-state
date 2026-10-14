// `bun run verify controls`: the status line shows loading and refilling,
// Force GC waits for Go to run and then marks a collection, and the cache
// size, batch size and read ratio sliders change the run while it streams
// (issue #19).

import { verify } from "../harness.ts";

const gcLines = "document.querySelectorAll('#live-chart .gc line').length";
const goPoints =
  "(document.querySelector('#live-chart .go-line')?.getAttribute('points') ?? '').split(' ').filter(Boolean).length";

/** Set a slider to step `i` and fire the events a drag would. */
const slide = (name: string, i: number): string => `(() => {
  const label = [...document.querySelectorAll('#live-chart .slider')].find((l) => l.textContent?.startsWith('${name}'));
  const input = label?.querySelector('input');
  if (!input) return false;
  input.value = '${String(i)}';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return label.querySelector('output')?.textContent;
})()`;

const stats = "document.querySelector('#live-chart .stats')?.textContent";
const forceGcDisabled = "document.querySelector('#live-chart .force-gc')?.disabled";

await verify("controls", async (v) => {
  await v.open();
  v.check((await v.eval(forceGcDisabled)) === true, "Force GC is disabled until Go runs");

  // A small cache so Go fills quickly and collects rarely on its own.
  v.check((await v.eval(slide("Cache size", 0))) === "100k entries", "the cache size slider reads 100k entries");
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

  v.check((await v.eval(slide("Batch size", 5))) === "100k ops", "the batch size slider reads 100k ops");
  v.check((await v.eval(slide("Read ratio", 10))) === "100% reads", "the read ratio slider reads 100% reads");
  v.check((await v.eval(slide("Cache size", 4))) === "2M entries", "the cache size slider reads 2M entries");
  await v.until("a resize shows the cache refilling", `${stats}?.startsWith('Go filling cache')`, 10_000);
  await v.until("Go keeps streaming after the changes", `${goPoints} > 40`, 60_000);
  await v.screenshot("controls", "#live-chart");

  await v.click("#live-chart .run-go");
  await v.until("Stop Go ends the run", `${stats} === 'Stopped.'`);
  await v.assertNoErrors();
});
