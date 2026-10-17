// `bun run verify page`: the article renders its components (the copy buttons,
// no recorded CPU chart), in light and dark themes: the system theme by
// default, the toggle's choice once made.

import { verify } from "../harness.ts";

const LIGHT_BG = "rgb(250, 250, 249)";
const DARK_BG = "rgb(12, 10, 9)";
const bg = "getComputedStyle(document.body).backgroundColor";
const gcDrawn = "document.querySelector('#gc-diagram svg') !== null";

await verify("page", async (v) => {
  // System theme, nothing saved.
  await v.open("/", "dark");
  await v.eval("localStorage.clear()");
  await v.open("/", "dark");
  v.check((await v.eval(bg)) === DARK_BG, "a dark system theme gives a dark page", await v.eval(bg));
  await v.open("/", "light");
  v.check((await v.eval(bg)) === LIGHT_BG, "a light system theme gives a light page", await v.eval(bg));
  await v.until("the GC schematic renders", gcDrawn);
  await v.screenshot("gc-to-fix-light", "#fix");

  // The toggle overrides the system theme and survives a reload.
  await v.click(".theme-toggle");
  v.check((await v.eval(bg)) === DARK_BG, "the toggle switches a light system theme to dark", await v.eval(bg));
  await v.open("/", "light");
  v.check((await v.eval(bg)) === DARK_BG, "the chosen theme survives a reload", await v.eval(bg));
  const label = await v.eval("document.querySelector('.theme-toggle')?.textContent");
  v.check(label === "☀ Light", "the toggle then offers light", label);
  await v.until("the GC schematic renders", gcDrawn);
  await v.screenshot("gc-to-fix-dark", "#fix");
  await v.click(".theme-toggle");
  v.check((await v.eval(bg)) === LIGHT_BG, "the toggle switches back to light", await v.eval(bg));

  const gone = await v.eval(
    "document.querySelector('#cpu-chart, #cpu-table') === null && !document.body.textContent.includes('CPU in an earlier')",
  );
  v.check(gone === true, "the stale CPU chart and its table are gone", gone);
  const next = await v.eval("document.querySelector('#gc-diagram').closest('figure').nextElementSibling?.id");
  v.check(next === "fix", "the GC schematic leads straight into the fix", next);
  const buttons = await v.eval("document.querySelectorAll('.cmd button').length");
  v.check(buttons === 2, "2 copy buttons", buttons);

  await v.assertNoErrors();
});
