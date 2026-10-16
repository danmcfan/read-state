// `bun run verify live-caption`: the live section's body explains why Go's
// spikes here follow heap growth rather than a two-minute timer, and the
// chart caption stays at two sentences or fewer (issue #34).

import { verify } from "../harness.ts";

const figure = "document.querySelector('#live-chart')?.closest('figure')";

await verify("live-caption", async (v) => {
  await v.open();
  const order = await v.eval(`(() => {
    const figure = ${figure};
    const body = document.querySelector('#live-wasm-gc');
    return Boolean(figure && body && body.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING);
  })()`);
  v.check(order === true, "a body paragraph before the chart explains heap-growth-triggered collections");

  const caption = await v.eval(`${figure}?.querySelector('figcaption')?.textContent?.trim()`);
  const sentences = typeof caption === "string" ? caption.split(/[.!?](?:\\s|$)/u).filter((s) => s.trim()).length : 0;
  v.check(sentences >= 1 && sentences <= 2, "the caption is two sentences or fewer", caption);
  v.check(
    typeof caption === "string" && !/two-minute/u.test(caption),
    "the caption drops the forced-GC caveat",
    caption,
  );

  await v.screenshot("body", "#live-wasm-gc");
  await v.screenshot("caption", "#live-chart");
  await v.assertNoErrors();
});
