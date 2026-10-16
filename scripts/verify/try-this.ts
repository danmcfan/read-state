// `bun run verify try-this`: "Watch it live" shows the chart before any
// control instructions, and a Try this list below it gives every control one
// item that says what to notice (issue #32).

import { verify } from "../harness.ts";

/** The floor: every control the chart had when the list was written, as its Try this item names it. */
const KNOWN_CONTROLS = ["Run Go", "Run Rust", "Force GC", "Cache size", "Batch size", "Read ratio", "Go layout"];

/** The control names rendered in the chart: its buttons (Stop read as Run) and its slider and Go layout labels. */
const renderedControls = `[
  ...[...document.querySelectorAll('#live-chart .live-bar button')].map((b) => b.textContent.trim().replace(/^Stop /, 'Run ')),
  ...[...document.querySelectorAll('#live-chart .slider > span:first-child, #live-chart #go-layout')].map((e) => e.textContent.trim()),
]`;

/** The elements between the "Watch it live" heading and the next heading. */
const section = `(() => {
  const out = [];
  for (let el = document.querySelector('#live')?.nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) out.push(el);
  return out;
})()`;

await verify("try-this", async (v) => {
  await v.open();

  await v.until("the chart controls render", `document.querySelectorAll("#live-chart .live-bar button").length > 0`);
  const rendered = await v.eval(renderedControls);
  const CONTROLS = Array.isArray(rendered)
    ? [...new Set([...KNOWN_CONTROLS, ...rendered.map(String)])]
    : KNOWN_CONTROLS;
  v.check(
    Array.isArray(rendered) && rendered.length >= KNOWN_CONTROLS.length,
    "the chart renders every known control",
    rendered,
  );

  const order = await v.eval(
    `${section}.map((el) => el.matches('figure.chart') ? 'chart' : el.matches('ul.try-this') ? 'try' : el.tagName)`,
  );
  const chartAt = Array.isArray(order) ? order.indexOf("chart") : -1;
  const tryAt = Array.isArray(order) ? order.indexOf("try") : -1;
  v.check(chartAt >= 0 && tryAt > chartAt, "the chart comes before the Try this list", order);

  const before = await v.eval(`${section}.filter((el) => !el.matches('figure.chart')).map((el) => el.textContent)`);
  const beforeChart = Array.isArray(before) && Array.isArray(order) ? before.slice(0, chartAt) : [];
  v.check(
    chartAt > 0 && beforeChart.every((t) => CONTROLS.every((c) => !String(t).includes(c))),
    "nothing above the chart names a control",
    beforeChart,
  );

  const items = await v.eval(`[...document.querySelectorAll('ul.try-this li')].map((li) => li.textContent)`);
  v.check(Array.isArray(items) && items.length === CONTROLS.length, "one Try this item per control", items);
  for (const control of CONTROLS) {
    const matching = Array.isArray(items) ? items.filter((t) => typeof t === "string" && t.includes(control)) : [];
    v.check(matching.length === 1, `exactly one Try this item covers ${control}`, matching);
    v.check(/watch|see|look/iu.test(String(matching[0])), `the ${control} item says what to notice`, matching[0]);
  }

  await v.screenshot("chart", "#live-chart");
  await v.screenshot("try-this", "ul.try-this");
  await v.open("/", "dark");
  await v.screenshot("try-this-dark", "ul.try-this");
  await v.assertNoErrors();
});
