// `bun run verify page`: the article renders its components: the recorded CPU
// chart (with hover readout), its data table and the copy buttons, in light
// and dark themes.

import { verify } from "../harness.ts";

await verify("page", async (v) => {
  const shoot = async (theme: "light" | "dark"): Promise<void> => {
    await v.open("/", theme);
    await v.until("the recorded chart renders", "document.querySelectorAll('#cpu-chart polyline').length === 2");
    await v.screenshot(`cpu-chart-${theme}`, "#cpu-chart");
  };
  await shoot("light");
  await shoot("dark");

  const counts = await v.eval(
    `JSON.stringify([
      document.querySelector('#cpu-chart polyline')?.getAttribute('points')?.split(' ').length,
      [...document.querySelectorAll('#cpu-chart text')].filter((t) => t.textContent === 'forced GC').length,
      document.querySelectorAll('#cpu-table tbody tr').length,
      document.querySelectorAll('.cmd button.copy').length,
    ])`,
  );
  v.check(counts === "[120,4,120,3]", "120 points, 4 forced GCs, 120 table rows, 3 copy buttons", counts);

  await v.run("hover", "#cpu-chart rect");
  await v.until(
    "hovering the chart shows a readout",
    "document.querySelector('#cpu-chart .tip')?.textContent.includes('Go')",
  );

  await v.assertNoErrors();
});
