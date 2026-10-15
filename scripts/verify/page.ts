// `bun run verify page`: the article renders its components (the recorded CPU
// chart with hover readout, its data table, the copy buttons), in light and
// dark themes: the system theme by default, the toggle's choice once made.

import { verify } from "../harness.ts";

const LIGHT_BG = "rgb(250, 250, 249)";
const DARK_BG = "rgb(12, 10, 9)";
const bg = "getComputedStyle(document.body).backgroundColor";
const chartDrawn = "document.querySelectorAll('#cpu-chart polyline').length === 2";

await verify("page", async (v) => {
  // System theme, nothing saved.
  await v.open("/", "dark");
  await v.eval("localStorage.clear()");
  await v.open("/", "dark");
  v.check((await v.eval(bg)) === DARK_BG, "a dark system theme gives a dark page", await v.eval(bg));
  await v.open("/", "light");
  v.check((await v.eval(bg)) === LIGHT_BG, "a light system theme gives a light page", await v.eval(bg));
  await v.until("the recorded chart renders", chartDrawn);
  await v.screenshot("cpu-chart-light", "#cpu-chart");

  // The toggle overrides the system theme and survives a reload.
  await v.click(".theme-toggle");
  v.check((await v.eval(bg)) === DARK_BG, "the toggle switches a light system theme to dark", await v.eval(bg));
  await v.open("/", "light");
  v.check((await v.eval(bg)) === DARK_BG, "the chosen theme survives a reload", await v.eval(bg));
  const label = await v.eval("document.querySelector('.theme-toggle')?.textContent");
  v.check(label === "☀ Light", "the toggle then offers light", label);
  await v.until("the recorded chart renders", chartDrawn);
  await v.screenshot("cpu-chart-dark", "#cpu-chart");
  await v.click(".theme-toggle");
  v.check((await v.eval(bg)) === LIGHT_BG, "the toggle switches back to light", await v.eval(bg));

  const counts = await v.eval(
    `JSON.stringify([
      document.querySelector('#cpu-chart polyline')?.getAttribute('points')?.split(' ').length,
      [...document.querySelectorAll('#cpu-chart text')].filter((t) => t.textContent === 'forced GC').length,
      document.querySelectorAll('#cpu-table tbody tr').length,
      document.querySelectorAll('.cmd button').length,
    ])`,
  );
  v.check(counts === "[120,4,120,2]", "120 points, 4 forced GCs, 120 table rows, 2 copy buttons", counts);

  await v.run("hover", "#cpu-chart rect");
  await v.until(
    "hovering the chart shows a readout",
    "document.querySelector('#cpu-chart .tip')?.textContent.includes('Go')",
  );

  await v.assertNoErrors();
});
