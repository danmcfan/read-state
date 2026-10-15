// `bun run verify layout`: the Go layout toggle refills Go's cache with the
// pointer-free layout mid-run, and Go keeps streaming on it (issue #20).

import { verify } from "../harness.ts";

const goPoints =
  "(document.querySelector('#live-chart .go-line')?.getAttribute('points') ?? '').split(' ').filter(Boolean).length";
const stats = "document.querySelector('#live-chart .stats')?.textContent";
const checked = "document.querySelector('#live-chart input[name=go-layout]:checked')?.value";

await verify("layout", async (v) => {
  await v.open();
  v.check((await v.eval(checked)) === "list", "Go starts on the pointer layout", await v.eval(checked));

  await v.click("#live-chart .run-go");
  await v.until("Go streams samples on the pointer layout", `${goPoints} > 20`, 60_000);
  await v.screenshot("pointers", "#live-chart");

  await v.click("#live-chart input[value=slab]");
  v.check((await v.eval(checked)) === "slab", "the pointer-free option is selected");
  await v.until("switching layout refills Go's cache", `${stats}?.startsWith('Go filling cache')`, 10_000);
  await v.until("Go streams on the pointer-free layout", `${stats}?.startsWith('Go ') && /ms/u.test(${stats})`, 60_000);
  const after = Number(await v.eval(goPoints));
  await v.until("Go keeps adding samples", `${goPoints} > ${String(after + 20)}`, 60_000);
  await v.click("#live-chart .force-gc");
  await v.until("a few more batches after Force GC", `${goPoints} > ${String(after + 40)}`, 60_000);
  await v.screenshot("pointer-free", "#live-chart");

  await v.click("#live-chart .run-go");
  await v.until("Stop Go ends the run", `${stats} === 'Stopped.'`);
  await v.assertNoErrors();
});
