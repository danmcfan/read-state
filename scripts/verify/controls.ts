// `bun run verify controls`: Force GC marks a Go collection, and the cache
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

await verify("controls", async (v) => {
  await v.open();
  v.check(
    (await v.eval("document.querySelector('#live-chart .force-gc')?.disabled")) === true,
    "Force GC is disabled until Go runs",
  );

  // A small cache so Go fills quickly and collects rarely on its own.
  v.check((await v.eval(slide("Cache size", 0))) === "100k entries", "the cache size slider reads 100k entries");
  await v.click("#live-chart .run-go");
  await v.until("Go streams samples", `${goPoints} > 20`, 60_000);

  const before = Number(await v.eval(gcLines));
  await v.click("#live-chart .force-gc");
  await v.until("Force GC marks a collection", `${gcLines} > ${String(before)}`, 10_000);

  v.check((await v.eval(slide("Batch size", 5))) === "100k ops", "the batch size slider reads 100k ops");
  v.check((await v.eval(slide("Read ratio", 10))) === "100% reads", "the read ratio slider reads 100% reads");
  v.check((await v.eval(slide("Cache size", 2))) === "500k entries", "the cache size slider reads 500k entries");
  await v.until("Go keeps streaming after the changes", `${goPoints} > 40`, 60_000);
  await v.screenshot("controls", "#live-chart");

  await v.click("#live-chart .run-go");
  await v.until("Stop Go ends the run", "document.querySelector('#live-chart .stats')?.textContent === 'Stopped.'");
  await v.assertNoErrors();
});
