// `bun run verify live`: Run Go and Run Rust each stream latency in their own
// worker, Go's collections show as dashed lines, and each button stops its
// own run (issue #17, issue #19).

import { verify } from "../harness.ts";

const points = (lang: string): string =>
  `(document.querySelector('#live-chart .${lang}-line')?.getAttribute('points') ?? '').split(' ').filter(Boolean).length`;
const text = (selector: string): string => `document.querySelector('#live-chart ${selector}')?.textContent`;

await verify("live", async (v) => {
  await v.open();
  v.check((await v.eval(text(".run-go"))) === "Run Go", "the Go button reads Run Go");
  v.check((await v.eval(text(".run-rust"))) === "Run Rust", "the Rust button reads Run Rust");

  await v.click("#live-chart .run-go");
  await v.click("#live-chart .run-rust");
  await v.until("Go streams samples", `${points("go")} > 20`, 60_000);
  await v.until("Rust streams samples", `${points("rust")} > 20`, 60_000);
  await v.until("a Go collection is marked", "document.querySelectorAll('#live-chart .gc line').length > 0", 60_000);

  const stats = await v.eval(text(".stats"));
  v.check(
    typeof stats === "string" && /^Go [\d.]+ ms · Rust [\d.]+ ms · \d+ Go GCs in view$/u.test(stats),
    "the status line reads Go, Rust and GC count",
    stats,
  );
  await v.screenshot("running", "#live-chart");

  await v.click("#live-chart .run-go");
  await v.until("Stop Go leaves Rust running", `${text(".stats")}?.startsWith('Rust ') && ${points("go")} === 0`);
  await v.click("#live-chart .run-rust");
  await v.until("stopping both ends the run", `${text(".stats")} === 'Stopped.'`);

  await v.assertNoErrors();
});
