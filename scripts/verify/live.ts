// `bun run verify live`: Start runs both WASM builds in workers and streams
// latency for Go and Rust, Go's collections show as dashed lines, and Stop
// ends the run (issue #17).

import { verify } from "../harness.ts";

const points = (lang: string): string =>
  `(document.querySelector('#live-chart .${lang}-line')?.getAttribute('points') ?? '').split(' ').filter(Boolean).length`;

await verify("live", async (v) => {
  await v.open();
  v.check(
    (await v.eval("document.querySelector('#live-chart button')?.textContent")) === "Start",
    "the button reads Start",
  );

  await v.click("#live-chart button");
  await v.until("Go streams samples", `${points("go")} > 20`, 60_000);
  await v.until("Rust streams samples", `${points("rust")} > 20`, 60_000);
  await v.until("a Go collection is marked", "document.querySelectorAll('#live-chart .gc line').length > 0", 60_000);

  const stats = await v.eval("document.querySelector('#live-chart .stats')?.textContent");
  v.check(
    typeof stats === "string" && /^Go [\d.]+ ms · Rust [\d.]+ ms · \d+ Go GCs in view$/u.test(stats),
    "the status line reads Go, Rust and GC count",
    stats,
  );
  await v.screenshot("running", "#live-chart");

  await v.click("#live-chart button");
  await v.until("Stop ends the run", "document.querySelector('#live-chart .stats')?.textContent === 'Stopped.'");

  await v.assertNoErrors();
});
