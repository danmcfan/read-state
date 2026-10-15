// `bun run verify try-this`: "Watch it live" shows the chart before any
// control instructions, and a Try this list below it gives every control one
// item that says what to notice (issue #32).

import { verify } from "../harness.ts";

/** Every control on the live chart, as its Try this item names it. */
const CONTROLS = ["Run Go", "Run Rust", "Force GC", "Cache size", "Batch size", "Read ratio", "Go layout"];

/** The elements between the "Watch it live" heading and the next heading. */
const section = `(() => {
  const out = [];
  for (let el = document.querySelector('#live')?.nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) out.push(el);
  return out;
})()`;

await verify("try-this", async (v) => {
  await v.open();

  const order = await v.eval(
    `${section}.map((el) => el.matches('figure.chart') ? 'chart' : el.matches('ul.try-this') ? 'try' : el.tagName)`,
  );
  v.check(
    Array.isArray(order) && order.join(",") === "P,chart,H3,try",
    "intro, chart, then the Try this list",
    order,
  );

  const intro = await v.eval(`${section}[0]?.textContent ?? ''`);
  v.check(
    typeof intro === "string" && CONTROLS.every((c) => !intro.includes(c)),
    "the intro above the chart names no control",
    intro,
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
